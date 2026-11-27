import { useDb } from "./client";
import { byId, type EdgeDoc } from "./edges";

/** The reads the article, topic and node-detail routes make, on Postgres.
 * Documents come back as stored (`data`), as `doc.data()` gave them: no
 * derived stats laid over them, since none of these callers reads them. */

export type Doc = Record<string, unknown>;

/** Stored documents by id; ids with no document are absent. */
export async function readNodeDocs(ids: string[]): Promise<Map<string, Doc>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const sql = useDb();
  const rows = await sql<EdgeDoc[]>`
    SELECT id, data FROM nodes WHERE id = ANY(${wanted}::text[])`;
  return new Map(rows.map((r) => [r.id, r.data]));
}

/** How many `merged_into` pointers a page load follows. Merges are resolved
 * on the way in, so a chain should never form; this stops a cycle (two pages
 * merged into each other by two admins racing) from hanging a page load. */
export const MAX_MERGE_HOPS = 8;

/** `resolveMergedNode` (server/utils/merge.ts) on Postgres: the page, or the
 * page it was merged into, following at most `maxHops` pointers. */
export async function resolveMergedNodeDoc(
  id: string,
  maxHops: number = MAX_MERGE_HOPS,
): Promise<{ id: string; data: Doc | undefined }> {
  let current = id;
  const seen = new Set([id]);
  for (let hop = 0; hop <= maxHops; hop++) {
    const data = (await readNodeDocs([current])).get(current);
    if (!data || hop === maxHops) return { id: current, data };
    const next = data.merged_into;
    if (typeof next !== "string" || !next || seen.has(next))
      return { id: current, data };
    seen.add(next);
    current = next;
  }
  return { id: current, data: undefined };
}

/** The edges leaving the node by id, then those arriving by id, a self-edge once. */
export async function readEdgesOfNode(
  nodeId: string,
  type?: string,
): Promise<(Doc & { id: string })[]> {
  const sql = useDb();
  const typed = type ? sql`AND type = ${type}` : sql``;
  const rows = await sql<(EdgeDoc & { outgoing: boolean })[]>`
    SELECT id, data, source = ${nodeId} AS outgoing FROM edges
    WHERE (source = ${nodeId} OR target = ${nodeId}) ${typed}`;
  return rows
    .sort((a, b) => Number(b.outgoing) - Number(a.outgoing) || byId(a.id, b.id))
    .map((r) => ({ ...r.data, id: r.id }));
}

/** Edges leaving `source`, by id. */
export async function readEdgesFrom(
  source: string,
  type: string,
): Promise<(Doc & { id: string })[]> {
  const sql = useDb();
  const rows = await sql<EdgeDoc[]>`
    SELECT id, data FROM edges WHERE source = ${source} AND type = ${type}
    ORDER BY id`;
  return rows.map((r) => ({ ...r.data, id: r.id }));
}

/** Edges arriving at `target`, by id. */
export async function readEdgesTo(
  target: string,
  type: string,
): Promise<(Doc & { id: string })[]> {
  const sql = useDb();
  const rows = await sql<EdgeDoc[]>`
    SELECT id, data FROM edges WHERE target = ${target} AND type = ${type}
    ORDER BY id`;
  return rows.map((r) => ({ ...r.data, id: r.id }));
}

/** Every edge of a type, by id. */
export async function readEdgesOfType(
  type: string,
): Promise<(Doc & { id: string })[]> {
  const sql = useDb();
  const rows = await sql<EdgeDoc[]>`
    SELECT id, data FROM edges WHERE type = ${type} ORDER BY id`;
  return rows.map((r) => ({ ...r.data, id: r.id }));
}

/** Every node of a type, merged-away ones too, by id. */
export async function readNodeDocsOfType(
  type: string,
): Promise<(Doc & { id: string })[]> {
  const sql = useDb();
  const rows = await sql<EdgeDoc[]>`
    SELECT id, data FROM nodes WHERE type = ${type} ORDER BY id`;
  return rows.map((r) => ({ ...r.data, id: r.id }));
}

/** Edges whose `references` cite any of the articles, by id: what
 * `array-contains-any` found in thirty-id chunks. */
export async function readEdgesCiting(
  articleIds: string[],
): Promise<(Doc & { id: string })[]> {
  if (articleIds.length === 0) return [];
  const sql = useDb();
  const rows = await sql<EdgeDoc[]>`
    SELECT id, data FROM edges
    WHERE jsonb_typeof(data -> 'references') = 'array'
      AND data -> 'references' ?| ${articleIds}::text[]
    ORDER BY id`;
  return rows.map((r) => ({ ...r.data, id: r.id }));
}

/** Edges with an end on any of the nodes, by id. */
export async function readEdgesTouchingAny(
  ids: string[],
  type: string,
): Promise<(Doc & { id: string })[]> {
  if (ids.length === 0) return [];
  const sql = useDb();
  const rows = await sql<EdgeDoc[]>`
    SELECT id, data FROM edges
    WHERE (source = ANY(${ids}::text[]) OR target = ANY(${ids}::text[]))
      AND type = ${type}
    ORDER BY id`;
  return rows.map((r) => ({ ...r.data, id: r.id }));
}

/** The newest revision of a node, as /api/nodes/[id] with `latest` reads it.
 * Firestore breaks a tie on `update_time` by id in the same direction. */
export async function readLatestRevision(
  nodeId: string,
): Promise<Doc | undefined> {
  const sql = useDb();
  const [row] = await sql<{ data: Doc }[]>`
    SELECT data FROM revisions
    WHERE node_id = ${nodeId} AND update_time IS NOT NULL
    ORDER BY update_time DESC, id DESC LIMIT 1`;
  return row?.data;
}

/** A page of the collection by id, as Firestore's offset and limit read an
 * unordered query. */
export async function readPage(
  table: "nodes" | "notes",
  options: { type?: string; limit?: number; page?: number },
): Promise<Doc[]> {
  const sql = useDb();
  const typed = options.type ? sql`WHERE type = ${options.type}` : sql``;
  const limit = options.limit ?? null;
  const offset = limit ? ((options.page ?? 1) - 1) * limit : 0;
  const rows = await sql<{ data: Doc }[]>`
    SELECT data FROM ${sql(table)} ${typed}
    ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
  return rows.map((r) => r.data);
}

/** Stored documents of a small collection with `field = value`. */
export async function readWhere(
  table: "stats" | "article_pages",
  field: string,
  value: string,
): Promise<(Doc & { id: string })[]> {
  const sql = useDb();
  const rows = await sql<EdgeDoc[]>`
    SELECT id, data FROM ${sql(table)} WHERE data ->> ${field} = ${value}
    ORDER BY id`;
  return rows.map((r) => ({ ...r.data, id: r.id }));
}

/** Captures of `/api/pages`, newest first: status and url optional. */
export async function readCaptures(options: {
  status?: string;
  normalizedUrl?: string;
  limit: number;
}): Promise<EdgeDoc[]> {
  const sql = useDb();
  const where = [sql`jsonb_typeof(data -> 'capturedAt') IS NOT NULL`];
  if (options.status)
    where.push(sql`data -> 'status' = to_jsonb(${options.status}::text)`);
  if (options.normalizedUrl)
    where.push(
      sql`data -> 'normalizedUrl' = to_jsonb(${options.normalizedUrl}::text)`,
    );
  const filter = where.reduce((all, part) => sql`${all} AND ${part}`);
  return sql<EdgeDoc[]>`
    SELECT id, data FROM article_pages WHERE ${filter}
    ORDER BY data ->> 'capturedAt' DESC, id DESC LIMIT ${options.limit}`;
}

/** One stored document of a collection. */
export async function readDoc(
  table: "article_pages",
  id: string,
): Promise<Doc | undefined> {
  const sql = useDb();
  const [row] = await sql<{ data: Doc }[]>`
    SELECT data FROM ${sql(table)} WHERE id = ${id}`;
  return row?.data;
}

/** Every note, by id. */
export async function readNotes(): Promise<EdgeDoc[]> {
  const sql = useDb();
  return sql<EdgeDoc[]>`SELECT id, data FROM notes ORDER BY id`;
}
