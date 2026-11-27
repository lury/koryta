/**
 * Merging two pages and splitting one, in SQL. What a relation becomes
 * (`planEdgeMoves`), what the survivor learns (`carriedFields`) and which
 * votes move (`votesToMove`) are server/utils/merge.ts's rules; the reads and
 * the writes of one merge or split are here, in one transaction.
 */
import { withoutInternalFields } from "../utils/revisions";
import {
  carriedFields,
  countDispositions,
  planEdgeMoves,
  votesToMove,
  type MergePlan,
  type StoredEdgeDoc,
} from "../utils/merge";
import { MAX_MERGE_HOPS } from "./graph";
import {
  patchDoc,
  readDocs,
  recordAuditPg,
  storeDoc,
  type Data,
  type Sql,
  type Tx,
  type WriteLog,
} from "./editorial";
import { createRevisionPg } from "./revisionWrites";
import { textArray } from "./textArray";

export type EdgeRow = { id: string; data: Data };

/** A row in the shape the merge rules read. */
export function edgeDoc(row: EdgeRow): StoredEdgeDoc {
  return { id: row.id, data: () => row.data };
}

/** Every relation with `nodeId` at either end: those it starts first, then
 * those it ends, each in id order (`edgesTouching`); `lock` takes their rows. */
export async function edgesTouchingPg(
  sql: Sql,
  nodeId: string,
  lock = false,
): Promise<EdgeRow[]> {
  return lock
    ? sql<EdgeRow[]>`
        SELECT id, data FROM edges WHERE source = ${nodeId} OR target = ${nodeId}
        ORDER BY source = ${nodeId} DESC, id FOR UPDATE`
    : sql<EdgeRow[]>`
        SELECT id, data FROM edges WHERE source = ${nodeId} OR target = ${nodeId}
        ORDER BY source = ${nodeId} DESC, id`;
}

/** The page a reader ends up on, following `merged_into` (`resolveMergedNode`):
 * its id, and its document when it exists. */
export async function resolveMergedNodePg(
  sql: Sql,
  id: string,
): Promise<{ id: string; data: Data | undefined }> {
  let current = id;
  const seen = new Set([id]);
  for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
    const data = (await readDocs(sql, "nodes", [current])).get(current);
    if (!data) return { id: current, data: undefined };
    const next = data.merged_into;
    if (typeof next !== "string" || !next || seen.has(next)) {
      return { id: current, data };
    }
    seen.add(next);
    current = next;
  }
  return {
    id: current,
    data: (await readDocs(sql, "nodes", [current])).get(current),
  };
}

async function nodeVotesPg(sql: Sql, nodeId: string) {
  const rows = await sql<EdgeRow[]>`
    SELECT id, data FROM votes WHERE node_id = ${nodeId} ORDER BY id`;
  return rows.map(({ id, data }) => ({
    id,
    user: String(data.userUid ?? ""),
    data,
  }));
}

/** What merging `duplicateId` into `survivorId` would do (`planNodeMerge`). */
export async function planNodeMergePg(
  sql: Sql,
  duplicateId: string,
  survivorId: string,
): Promise<MergePlan> {
  const [nodes, duplicateEdges, survivorEdges, duplicateVotes, survivorVotes] =
    await Promise.all([
      readDocs(sql, "nodes", [duplicateId, survivorId]),
      edgesTouchingPg(sql, duplicateId),
      edgesTouchingPg(sql, survivorId),
      nodeVotesPg(sql, duplicateId),
      nodeVotesPg(sql, survivorId),
    ]);
  const duplicate = nodes.get(duplicateId);
  const survivor = nodes.get(survivorId);
  const edges = planEdgeMoves(
    duplicateEdges.map(edgeDoc),
    survivorEdges.map(edgeDoc),
    duplicateId,
    survivorId,
  );
  return {
    duplicate_id: duplicateId,
    survivor_id: survivorId,
    duplicate_name: duplicate?.name as string | undefined,
    survivor_name: survivor?.name as string | undefined,
    edges,
    counts: countDispositions(edges),
    votes: votesToMove(duplicateVotes, survivorVotes, survivorId),
    carried: carriedFields(duplicate ?? {}, survivor ?? {}),
  };
}

/** Re-points one relation's ends from `fromId` to `toId`. */
async function repoint(
  tx: Tx,
  log: WriteLog,
  edgeId: string,
  stored: Data,
  fromId: string,
  toId: string,
): Promise<void> {
  const update: Data = {};
  if (stored.source === fromId) update.source = toId;
  if (stored.target === fromId) update.target = toId;
  await patchDoc(tx, log, "edges", edgeId, update);
}

/** Carries out a merge plan (`applyNodeMerge`): relations moved, collapsed or
 * enriched through approved revisions, what the duplicate knew written onto the
 * survivor, the human votes re-filed, the duplicate put to rest, all audited
 * as one merge. */
export async function applyNodeMergePg(
  tx: Tx,
  log: WriteLog,
  user: { uid: string },
  plan: MergePlan,
  reason: string,
): Promise<void> {
  const edgeIds = [
    ...new Set(
      plan.edges.flatMap((edge) =>
        edge.disposition === "enriched" && edge.duplicate_of
          ? [edge.edge_id, edge.duplicate_of]
          : [edge.edge_id],
      ),
    ),
  ];
  const storedEdges = new Map(
    (
      await tx<EdgeRow[]>`
        SELECT id, data FROM edges WHERE id = ANY(${textArray(edgeIds)}::text[])
        ORDER BY id FOR UPDATE`
    ).map((row) => [row.id, row.data]),
  );
  const moved: string[] = [];
  const collapsed: string[] = [];
  const enriched: string[] = [];

  for (const edge of plan.edges) {
    const stored = storedEdges.get(edge.edge_id);
    if (!stored) continue;

    if (edge.disposition === "moved" || edge.disposition === "review") {
      await repoint(
        tx,
        log,
        edge.edge_id,
        stored,
        plan.duplicate_id,
        plan.survivor_id,
      );
      moved.push(edge.edge_id);
      continue;
    }

    // The survivor's copy learns what this one knew, through an approved
    // revision: it changes what a relation asserts.
    if (edge.disposition === "enriched" && edge.enriches_into) {
      const target = storedEdges.get(edge.duplicate_of ?? "");
      if (target) {
        await createRevisionPg(
          tx,
          log,
          user,
          { collection: "edges", id: edge.duplicate_of! },
          edge.enriches_into,
          { stored: target, approve: true },
        );
        enriched.push(edge.duplicate_of!);
      }
    }

    // `deleted` and `delete_reason` are withheld from `stored` so this
    // revision is the one that states them.
    const {
      deleted: _wasDeleted,
      delete_reason: _oldReason,
      ...carried
    } = stored;
    await createRevisionPg(
      tx,
      log,
      user,
      { collection: "edges", id: edge.edge_id },
      {
        ...withoutInternalFields(stored),
        deleted: true,
        delete_reason:
          edge.disposition === "self"
            ? `Scalenie stron: powiązanie prowadziło samo do siebie. ${reason}`
            : edge.disposition === "enriched"
              ? `Scalenie stron: to samo, pełniej, mówi powiązanie ${edge.duplicate_of}. ${reason}`
              : `Scalenie stron: to samo mówi już powiązanie ${edge.duplicate_of}. ${reason}`,
      },
      // An admin merging two pages *is* the review of what the merge removes.
      { stored: carried, approve: true, published: false },
    );
    collapsed.push(edge.edge_id);
  }

  if (Object.keys(plan.carried).length > 0) {
    const [survivor] = await tx<{ data: Data }[]>`
      SELECT data FROM nodes WHERE id = ${plan.survivor_id} FOR UPDATE`;
    if (survivor) {
      await createRevisionPg(
        tx,
        log,
        user,
        { collection: "nodes", id: plan.survivor_id },
        { ...withoutInternalFields(survivor.data), ...plan.carried },
        { stored: survivor.data, approve: true },
      );
    }
  }

  // Each human vote re-filed under the survivor's id (`${nodeId}_${uid}`),
  // with `nodeId` in its body, and removed from the duplicate.
  for (const vote of plan.votes) {
    const [stored] = await tx<{ data: Data }[]>`
      DELETE FROM votes WHERE id = ${vote.from_id} RETURNING data`;
    if (!stored) continue;
    await storeDoc(tx, log, "votes", vote.to_id, {
      ...stored.data,
      nodeId: plan.survivor_id,
    });
  }

  // The duplicate keeps its document and points at the survivor: its url
  // still resolves, and `pageIsPublic` reads `deleted`.
  await patchDoc(tx, log, "nodes", plan.duplicate_id, {
    deleted: true,
    delete_reason: reason,
    merged_into: plan.survivor_id,
    published: false,
  });

  await recordAuditPg(tx, {
    action: "merge",
    collection: "nodes",
    target_id: plan.duplicate_id,
    user: user.uid,
    reason,
    merge: { into: plan.survivor_id, moved, collapsed, enriched },
  });
}

export { repoint as repointEdgePg };
