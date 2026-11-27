/**
 * The review queue and the revision histories in SQL: the queue's filters,
 * order and count as one statement each, the targets, approved revisions and
 * relation ends a page of rows is described against as one read each
 * (`describeRows` in server/utils/revisionQueue.ts says what a row means).
 *
 * The queue's scan of what its proposals are about (`published`, grouping by
 * entry) is a join here, so it is read per request: there is nothing left to
 * keep between requests, and a decision shows on the next read.
 */
import { generateEntityUrl } from "../../shared/slugs";
import {
  approvedRevisionId,
  pageIsPublic,
  type Edge,
} from "../../shared/model";
import { normalizeUpdateTime } from "../../shared/revisions";
import {
  relationSubject,
  type Proposal,
  type StoredStatusFilter,
} from "../../shared/proposals";
import {
  describeRows,
  nodeTypeOf,
  readAuthors,
  targetIdOf,
  targetKey,
  type ApprovedRevision,
  type AuthorInfo,
  type DescribeOptions,
  type EndpointInfo,
  type RevisionRow,
  type TargetInfo,
} from "../utils/revisionQueue";
import { revisionCollection } from "../../shared/model";
import { useDb } from "./client";
import { readDocs, type Data, type Sql } from "./editorial";
import { textArray } from "./textArray";

type Fragment = ReturnType<Sql>;

/** Rows described as the queue describes them, the reads batched over the
 * rows given. */
export async function describeRevisionsPg(
  rows: RevisionRow[],
  options: DescribeOptions,
): Promise<Proposal[]> {
  if (rows.length === 0) return [];
  const sql = useDb();

  const wanted = { nodes: new Set<string>(), edges: new Set<string>() };
  for (const row of rows) {
    const id = targetIdOf(row);
    if (id) wanted[revisionCollection(row.data)].add(id);
  }
  const [nodes, edges] = await Promise.all([
    readDocs(sql, "nodes", wanted.nodes),
    readDocs(sql, "edges", wanted.edges),
  ]);
  const targets = new Map<string, TargetInfo>();
  for (const [collection, ids, found] of [
    ["nodes", wanted.nodes, nodes],
    ["edges", wanted.edges, edges],
  ] as const) {
    for (const id of ids) {
      const data = found.get(id);
      targets.set(targetKey(collection, id), {
        exists: data !== undefined,
        data: data ?? {},
        approvedId: approvedRevisionId(data?.revision_id),
      });
    }
  }

  const endIds = new Set<string>();
  for (const row of rows) {
    if (revisionCollection(row.data) !== "edges") continue;
    const id = targetIdOf(row);
    const stored = (id && targets.get(targetKey("edges", id))?.data) || {};
    const proposed = (row.data.data ?? {}) as Data;
    for (const end of ["source", "target"] as const) {
      const node = stringField(proposed, end) ?? stringField(stored, end);
      if (node) endIds.add(node);
    }
  }
  const approvedIds = [...targets.values()].flatMap((t) =>
    t.approvedId ? [t.approvedId] : [],
  );
  const [approvedDocs, endDocs, authors] = await Promise.all([
    readDocs(sql, "revisions", approvedIds),
    readDocs(sql, "nodes", endIds),
    options.withAuthors
      ? readAuthors(rows.map((row) => row.data.update_user))
      : Promise.resolve(new Map<string, AuthorInfo>()),
  ]);
  const approved = new Map<string, ApprovedRevision>();
  for (const [id, data] of approvedDocs) {
    approved.set(id, {
      data: (data.data ?? {}) as Data,
      changedAt:
        normalizeUpdateTime(data.review_time) ??
        normalizeUpdateTime(data.update_time),
    });
  }

  return describeRows(rows, {
    targets,
    approved,
    endpoints: endpointsOf(endDocs),
    authors: options.withAuthors ? authors : null,
    allChanges: options.allChanges === true,
  });
}

/** Node documents as the far end of a relation. */
export function endpointsOf(
  docs: Map<string, Data>,
): Map<string, EndpointInfo> {
  const endpoints = new Map<string, EndpointInfo>();
  for (const [id, data] of docs) {
    const name = stringField(data, "name") ?? null;
    const type = nodeTypeOf(data);
    endpoints.set(id, {
      id,
      name,
      type,
      path: type ? generateEntityUrl(type, id, name ?? undefined) : null,
      published: pageIsPublic(data),
    });
  }
  return endpoints;
}

function stringField(data: Data, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Revisions by id, in the order asked, those that exist. */
export async function revisionRowsPg(ids: string[]): Promise<RevisionRow[]> {
  const found = await readDocs(useDb(), "revisions", ids);
  return ids.flatMap((id) => {
    const data = found.get(id);
    return data ? [{ id, data }] : [];
  });
}

/** One revision document, or undefined. */
export async function revisionPg(id: string): Promise<Data | undefined> {
  return (await readDocs(useDb(), "revisions", [id])).get(id);
}

/** Every revision of `nodeId` under either spelling: those filed as
 * `node_id` first, then the older `nodeId` ones, each in id order. */
export async function revisionRowsOfNodePg(
  nodeId: string,
): Promise<RevisionRow[]> {
  return useDb()<RevisionRow[]>`
    SELECT id, data FROM revisions
    WHERE node_id = ${nodeId}
       OR (data -> 'nodeId') = to_jsonb(${nodeId}::text)
    ORDER BY (data -> 'node_id') = to_jsonb(${nodeId}::text) DESC NULLS LAST, id`;
}

export type QueueFilters = {
  status: StoredStatusFilter;
  automatic: "true" | "false" | "all";
};

/** The stored-status and automatic clauses of the queue. A revision without
 * `update_time` is in no ordered list. */
function queueWhere(sql: Sql, filters: QueueFilters): Fragment {
  const automatic =
    filters.automatic === "all"
      ? sql`true`
      : sql`(data -> 'update_automatic') = ${filters.automatic === "true" ? sql`'true'::jsonb` : sql`'false'::jsonb`}`;
  const status =
    filters.status === "all"
      ? sql`true`
      : sql`(data -> 'status') = to_jsonb(${filters.status}::text)`;
  return sql`${automatic} AND ${status} AND update_time IS NOT NULL`;
}

/** One page of the aggregate queue, newest first, and how many match. Leaving
 * an author out also leaves out the revisions that name nobody, and orders
 * ties by the author, then id. */
export async function queuePagePg(
  filters: QueueFilters & { excludeAuthor?: string },
  offset: number,
  limit: number,
): Promise<{ rows: RevisionRow[]; total: number }> {
  const sql = useDb();
  const where = filters.excludeAuthor
    ? sql`${queueWhere(sql, filters)}
        AND jsonb_typeof(data -> 'update_user') <> 'null'
        AND (data -> 'update_user') <> to_jsonb(${filters.excludeAuthor}::text)`
    : queueWhere(sql, filters);
  const order = filters.excludeAuthor
    ? sql`update_time DESC, jsonb_text(data -> 'update_user') COLLATE "C" ASC, id ASC`
    : sql`update_time DESC, id DESC`;
  const [rows, [count]] = await Promise.all([
    sql<RevisionRow[]>`
      SELECT id, data FROM revisions WHERE ${where}
      ORDER BY ${order} OFFSET ${offset} LIMIT ${limit}`,
    sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM revisions WHERE ${where}`,
  ]);
  return { rows, total: count?.n ?? 0 };
}

/** One author's newest revisions, at most `cap`. */
export async function authorRevisionsPg(
  uid: string,
  cap: number,
): Promise<RevisionRow[]> {
  return useDb()<RevisionRow[]>`
    SELECT id, data FROM revisions
    WHERE (data -> 'update_user') = to_jsonb(${uid}::text) AND update_time IS NOT NULL
    ORDER BY update_time DESC, id DESC LIMIT ${cap}`;
}

/** One revision of a scan, reduced to what the queue filters and groups by. */
export type QueuedRevision = {
  id: string;
  /** The entry it is about - `ProposalSubject.id`. */
  subjectId: string;
  /** Whether that entry is live. */
  published: boolean;
  /** Who filed it; null on the few written before `update_user` was. */
  updateUser: string | null;
};

type ScanRow = {
  id: string;
  edge: boolean;
  target_id: string;
  update_user: string | null;
  source: string | null;
  target: string | null;
};

/** Every revision the queue's filters match, newest first, at most `cap`,
 * with the entry each is about and whether it is live. A relation revision
 * that names neither end is read off its stored edge. */
export async function scanQueuePg(
  filters: QueueFilters,
  cap: number,
): Promise<{ rows: QueuedRevision[]; truncated: boolean }> {
  const sql = useDb();
  const scanned = await sql<ScanRow[]>`
    WITH r AS (
      SELECT id, data, update_time FROM revisions WHERE ${queueWhere(sql, filters)}
      ORDER BY update_time DESC, id DESC LIMIT ${cap}
    ), x AS (
      SELECT id, update_time,
        CASE WHEN (data -> 'collection') IN ('"edges"'::jsonb, '"nodes"'::jsonb)
               THEN data -> 'collection' = '"edges"'::jsonb
             ELSE jsonb_truthy(data #> '{data,source}') AND jsonb_truthy(data #> '{data,target}')
        END AS edge,
        coalesce(nullif(jsonb_text(data -> 'node_id'), ''), nullif(jsonb_text(data -> 'nodeId'), ''), '') AS target_id,
        nullif(jsonb_text(data -> 'update_user'), '') AS update_user,
        nullif(jsonb_text(data #> '{data,source}'), '') AS source,
        nullif(jsonb_text(data #> '{data,target}'), '') AS target
      FROM r
    )
    SELECT x.id, x.edge, x.target_id, x.update_user,
      CASE WHEN x.edge THEN coalesce(x.source, nullif(jsonb_text(e.data -> 'source'), '')) END AS source,
      CASE WHEN x.edge THEN coalesce(x.target, nullif(jsonb_text(e.data -> 'target'), '')) END AS target
    FROM x LEFT JOIN edges e
      ON x.edge AND (x.source IS NULL OR x.target IS NULL) AND e.id = x.target_id
    ORDER BY x.update_time DESC, x.id DESC`;

  const nodeIds = new Set<string>();
  for (const row of scanned) {
    if (!row.edge) nodeIds.add(row.target_id);
    else for (const id of [row.source, row.target]) if (id) nodeIds.add(id);
  }
  const nodes = await sql<{ id: string; data: Data }[]>`
    SELECT id, jsonb_build_object('type', data -> 'type', 'published', data -> 'published',
      'deleted', data -> 'deleted') AS data
    FROM nodes WHERE id = ANY(${textArray([...nodeIds].filter(Boolean))}::text[])`;
  const byId = new Map(nodes.map((n) => [n.id, n.data]));
  const end = (id: string | null) => {
    const data = id ? byId.get(id) : undefined;
    return id && data
      ? { id, type: nodeTypeOf(data), published: pageIsPublic(data) }
      : undefined;
  };

  const rows = scanned.map((row): QueuedRevision => {
    const { id, update_user: updateUser } = row;
    if (!row.edge) {
      const data = byId.get(row.target_id);
      return {
        id,
        subjectId: row.target_id,
        published: data ? pageIsPublic(data) : false,
        updateUser,
      };
    }
    const subject = relationSubject(end(row.source), end(row.target));
    return subject
      ? { id, subjectId: subject.id, published: subject.published, updateUser }
      : { id, subjectId: row.target_id, published: false, updateUser };
  });
  return { rows, truncated: scanned.length >= cap };
}

/** What one user proposed, newest first, described without authors, at most
 * `cap` scanned (`scanMyProposals`); `nodeId` narrows it to one entry. */
export async function scanMyProposalsPg(
  uid: string,
  cap: number,
  nodeId?: string,
): Promise<{ proposals: Proposal[]; truncated: boolean }> {
  const scanned = await authorRevisionsPg(uid, cap);
  const mine = scanned
    .filter((row) => row.data.update_automatic !== true)
    .filter((row) => !nodeId || revisionNodeId(row) === nodeId);
  return {
    proposals: await describeRevisionsPg(mine, { withAuthors: false }),
    truncated: scanned.length >= cap,
  };
}

/** The target a revision names, by either spelling. */
function revisionNodeId(row: RevisionRow): string | undefined {
  const { node_id: underscore, nodeId: camel } = row.data;
  if (typeof underscore === "string") return underscore;
  return typeof camel === "string" ? camel : undefined;
}

/** Every edge with `nodeId` at either end: those it starts first, then those
 * it ends, each in id order. */
export async function edgesOfNodePg(
  nodeId: string,
): Promise<(Edge & { id: string })[]> {
  const rows = await useDb()<{ id: string; data: Edge }[]>`
    SELECT id, data FROM edges WHERE source = ${nodeId} OR target = ${nodeId}
    ORDER BY source = ${nodeId} DESC, id`;
  return rows.map(({ id, data }) => ({ ...data, id }));
}

/** The revisions filed under these edges (`node_id`), in id order. */
export async function revisionRowsOfEdgesPg(
  edgeIds: string[],
): Promise<RevisionRow[]> {
  if (edgeIds.length === 0) return [];
  return useDb()<RevisionRow[]>`
    SELECT id, data FROM revisions
    WHERE node_id = ANY(${textArray(edgeIds)}::text[])
      AND jsonb_typeof(data -> 'node_id') = 'string'
    ORDER BY id`;
}
