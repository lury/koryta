/**
 * Revisions, their approval and the publication of edges, in SQL. The rules
 * (which fields a document owns, which revision publishing an edge adopts,
 * what an automatic rule may put live) are the ones server/utils/revisions.ts
 * and edgePublication.ts describe at length; their pure parts are imported
 * from there, the reads and writes are here.
 *
 * Every write takes the transaction of its caller (`editorialTx`), so a
 * revision, the target it is applied to and the audit row describing it
 * commit together.
 */
import { createError } from "h3";
import type { Edge, Revision } from "../../shared/model";
import { approvedRevisionId, revisionCollection } from "../../shared/model";
import { latestPublishableRevision } from "../../shared/revisions";
import {
  nodeOwnedFields,
  sanitizeFirestoreData,
  withSeededNodeStats,
  type RevisionWriteOptions,
} from "../utils/revisions";
import {
  publishCandidateRevision,
  settledEdgeRefusal,
  waitingEdgeRefusal,
  type EdgeEndpoints,
} from "../utils/edgePublication";
import {
  patchDoc,
  recordAuditPg,
  storeDoc,
  type Data,
  type Sql,
  type Tx,
  type WriteLog,
} from "./editorial";
import { newDocId } from "./ids";
import { textArray } from "./textArray";

export type StoredRevision = Revision & { id: string };
export type RevisionTarget = { collection: "nodes" | "edges"; id: string };

/** A revision's `revision_id` pointer, as the migration stores a reference. */
export function revisionPath(id: string): string {
  return `revisions/${id}`;
}

/** The document a revision describes; a 422 when it names none. */
export function revisionTarget(revision: {
  id?: string;
  collection?: unknown;
  data?: unknown;
  node_id?: string;
  nodeId?: string;
}): RevisionTarget {
  const id = revision.node_id ?? revision.nodeId;
  if (!id) {
    throw createError({
      statusCode: 422,
      message: `Rewizja ${revision.id ?? "?"} nie wskazuje żadnego dokumentu.`,
    });
  }
  return { collection: revisionCollection(revision), id };
}

/** Every revision filed under `nodeId`, by either spelling, in id order. */
export async function nodeRevisionsPg(
  sql: Sql,
  nodeId: string,
): Promise<StoredRevision[]> {
  const rows = await sql<{ id: string; data: Revision }[]>`
    SELECT id, data FROM revisions
    WHERE node_id = ${nodeId}
       OR (data -> 'nodeId') = to_jsonb(${nodeId}::text)
    ORDER BY id`;
  return rows.map(({ id, data }) => ({ ...data, id }));
}

/** The newest revision a page goes live with when nobody picked one
 * (`latestPublishableRevision`). */
export async function latestApplicableRevisionPg(
  sql: Sql,
  nodeId: string,
): Promise<StoredRevision | null> {
  return latestPublishableRevision(await nodeRevisionsPg(sql, nodeId));
}

/** Revisions whose `node_id` is one of `ids`, newest first, by edge id. */
export async function edgeRevisionsForManyPg(
  sql: Sql,
  ids: string[],
): Promise<Map<string, StoredRevision[]>> {
  const result = new Map<string, StoredRevision[]>();
  for (const id of ids) result.set(id, []);
  if (ids.length === 0) return result;
  const rows = await sql<{ id: string; data: Revision }[]>`
    SELECT id, data FROM revisions
    WHERE node_id = ANY(${textArray(ids)}::text[])
      AND jsonb_typeof(data -> 'node_id') = 'string'`;
  for (const { id, data } of rows) {
    result.get(data.node_id!)?.push({ ...data, id });
  }
  for (const revisions of result.values()) {
    revisions.sort((a, b) => revisionTime(b) - revisionTime(a));
  }
  return result;
}

function revisionTime(revision: Revision): number {
  const value = revision.update_time as unknown;
  if (typeof value === "string") return Date.parse(value) || 0;
  if (value && typeof value === "object" && "_seconds" in value) {
    return (value as { _seconds: number })._seconds * 1000;
  }
  return 0;
}

/** Whether both ends of each edge are live, read in one statement. */
export async function resolveEdgeEndpointsPg(
  sql: Sql,
  edges: Pick<Edge, "id" | "source" | "target">[],
): Promise<Map<string, EdgeEndpoints>> {
  const ids = [
    ...new Set(edges.flatMap((e) => [e.source, e.target]).filter(Boolean)),
  ];
  const rows = ids.length
    ? await sql<{ id: string; name: string | null; published: boolean }[]>`
        SELECT id, jsonb_text(data -> 'name') AS name, is_approved AS published
        FROM nodes WHERE id = ANY(${textArray(ids)}::text[])`
    : [];
  const nodes = new Map(rows.map((row) => [row.id, row]));
  const result = new Map<string, EdgeEndpoints>();
  for (const edge of edges) {
    if (!edge.id) continue;
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    const sourcePublished = source?.published === true;
    const targetPublished = target?.published === true;
    const blockedBy: { id: string; name: string | null }[] = [];
    if (!sourcePublished) {
      blockedBy.push({ id: edge.source, name: source?.name ?? null });
    }
    if (!targetPublished && edge.target !== edge.source) {
      blockedBy.push({ id: edge.target, name: target?.name ?? null });
    }
    result.set(edge.id, {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceName: source?.name ?? null,
      targetName: target?.name ?? null,
      sourcePublished,
      targetPublished,
      publishable: sourcePublished && targetPublished,
      blockedBy,
    });
  }
  return result;
}

/** The target a revision write leaves behind, bar its pointer: the revision's
 * data under what the document owns (`nodeOwnedFields`), visibility when the
 * caller decides it, a node's counters seeded. */
function targetData(
  target: RevisionTarget,
  data: Data,
  options: RevisionWriteOptions,
): Data {
  const out: Data = { ...data, ...nodeOwnedFields(options.stored ?? {}) };
  if (options.published !== undefined) out.published = options.published;
  return target.collection === "edges" ? out : withSeededNodeStats(out);
}

/** Files a revision of `target` and writes its data onto the target:
 * approved and pointed at when `approve`. */
export async function createRevisionPg(
  tx: Tx,
  log: WriteLog,
  user: { uid: string },
  target: RevisionTarget,
  data: Data,
  options: RevisionWriteOptions = {},
): Promise<{ revisionId: string }> {
  const { automatic = false, approve = false } = options;
  const revisionId = newDocId();
  const now = new Date().toISOString();
  const revision: Data = {
    node_id: target.id,
    data: sanitizeFirestoreData(data),
    update_time: now,
    update_user: user.uid,
    collection: target.collection,
    status: approve ? "approved" : "pending",
    ...(approve ? { review_user: user.uid, review_time: now } : {}),
    update_automatic: automatic,
  };
  await storeDoc(tx, log, "revisions", revisionId, revision);
  const written = targetData(target, revision.data as Data, options);
  if (approve) written.revision_id = revisionPath(revisionId);
  await storeDoc(tx, log, target.collection, target.id, written);
  return { revisionId };
}

/** Makes `revision` the one its target points at (`applyRevision`): its data
 * over the target, what the target owns carried across, the revision marked
 * approved, the approval audited, and a change of visibility audited after it.
 * A removal ignores `publish`. */
export async function applyRevisionPg(
  tx: Tx,
  log: WriteLog,
  revisionId: string,
  revision: Revision,
  user: { uid: string },
  publish?: boolean,
): Promise<{ target: RevisionTarget; published: boolean; before: Data }> {
  const target = revisionTarget({ ...revision, id: revisionId });
  const [row] = await tx<{ data: Data }[]>`
    SELECT data FROM ${tx(target.collection)} WHERE id = ${target.id} FOR UPDATE`;
  const stored = row?.data ?? {};
  const removal = (revision.data as { deleted?: unknown }).deleted === true;
  const visibility = removal ? undefined : publish;
  const published = visibility ?? stored.published === true;
  const written: Data = {
    ...(revision.data as Data),
    ...nodeOwnedFields(stored),
    revision_id: revisionPath(revisionId),
    published,
  };
  await storeDoc(
    tx,
    log,
    target.collection,
    target.id,
    target.collection === "nodes" ? withSeededNodeStats(written) : written,
  );
  await approveRevisionRow(tx, log, revisionId, user.uid);
  await recordAuditPg(tx, {
    action: "approve",
    collection: target.collection,
    target_id: target.id,
    revision_id: revisionId,
    user: user.uid,
  });
  if (visibility !== undefined && visibility !== (stored.published === true)) {
    await recordAuditPg(tx, {
      action: visibility ? "publish" : "unpublish",
      collection: target.collection,
      target_id: target.id,
      revision_id: revisionId,
      user: user.uid,
    });
  }
  console.info(
    `Approved revision=${revisionId} target=${target.collection}/${target.id} published=${published} by=${user.uid}`,
  );
  return { target, published, before: stored };
}

/** Marks a revision approved by `uid` now, dropping any rejection reason. */
async function approveRevisionRow(
  tx: Tx,
  log: WriteLog,
  revisionId: string,
  uid: string,
): Promise<void> {
  const done = await patchDoc(
    tx,
    log,
    "revisions",
    revisionId,
    {
      status: "approved",
      review_user: uid,
      review_time: new Date().toISOString(),
    },
    ["reject_reason"],
  );
  if (!done) {
    throw createError({
      statusCode: 404,
      message: `Nie ma rewizji o id=${revisionId}`,
    });
  }
}

/** Publishes one edge and, when it points at no revision, adopts the newest
 * un-rejected one it holds (`publishCandidateRevision`). `revisions` newest
 * first. */
export async function publishEdgePg(
  tx: Tx,
  log: WriteLog,
  edgeId: string,
  stored: Data,
  revisions: StoredRevision[],
  user: { uid: string },
  audit = true,
): Promise<{ approvedRevision: string | null }> {
  const update: Data = { published: true };
  let approvedRevision: string | null = null;
  const candidate = approvedRevisionId(stored.revision_id)
    ? undefined
    : publishCandidateRevision(revisions, stored);
  if (candidate) {
    await approveRevisionRow(tx, log, candidate.id, user.uid);
    update.revision_id = revisionPath(candidate.id);
    approvedRevision = candidate.id;
    if (audit) {
      await recordAuditPg(tx, {
        action: "approve",
        collection: "edges",
        target_id: edgeId,
        revision_id: candidate.id,
        user: user.uid,
      });
    }
  }
  if (!(await patchDoc(tx, log, "edges", edgeId, update))) {
    throw createError({
      statusCode: 404,
      message: `Nie ma krawędzi ${edgeId}`,
    });
  }
  if (audit) {
    await recordAuditPg(tx, {
      action: "publish",
      collection: "edges",
      target_id: edgeId,
      ...(approvedRevision ? { revision_id: approvedRevision } : {}),
      user: user.uid,
    });
  }
  return { approvedRevision };
}

/** Puts live an edge still waiting for its first review where
 * `waitingEdgeRefusal` finds nothing against it (`approveWaitingEdge`). */
export async function approveWaitingEdgePg(
  tx: Tx,
  log: WriteLog,
  edgeId: string,
  stored: Data,
  user: { uid: string },
  revisions?: StoredRevision[],
): Promise<boolean> {
  if (settledEdgeRefusal(stored)) return false;
  const all =
    revisions ?? (await edgeRevisionsForManyPg(tx, [edgeId])).get(edgeId)!;
  if (waitingEdgeRefusal(stored, all)) return false;
  await publishEdgePg(tx, log, edgeId, stored, all.slice(0, 1), user, false);
  return true;
}

/** Takes every live edge of a node off the site, audited one by one, as the
 * node goes off it (`cascadeUnpublishEdges`). The ids it hid. */
export async function cascadeUnpublishEdgesPg(
  tx: Tx,
  log: WriteLog,
  nodeId: string,
  user: { uid: string },
): Promise<string[]> {
  const live = await tx<{ id: string; data: Data }[]>`
    SELECT id, data FROM edges
    WHERE (source = ${nodeId} OR target = ${nodeId}) AND is_approved
    ORDER BY id FOR UPDATE`;
  if (live.length === 0) return [];
  const ids = live.map((edge) => edge.id);
  const after = await tx<{ id: string; data: Data }[]>`
    UPDATE edges SET data = data || '{"published": false}'::jsonb,
      updated_at = clock_timestamp()
    WHERE id = ANY(${textArray(ids)}::text[]) RETURNING id, data`;
  const byId = new Map(after.map((row) => [row.id, row.data]));
  for (const edge of live) {
    log.add("edges", edge.id, edge.data, byId.get(edge.id));
    await recordAuditPg(tx, {
      action: "unpublish",
      collection: "edges",
      target_id: edge.id,
      user: user.uid,
    });
  }
  console.info(
    `Unpublished ${ids.length} edge(s) alongside node=${nodeId} by=${user.uid}`,
  );
  return ids;
}
