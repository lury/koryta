import { useDb } from "./client";
import { servedDoc } from "./nodes";
import type { Company, Person } from "../../shared/model";

/** The lists of edges the home page, the company and person pages and the
 * publish dialog read (homeTimeline, recentEmployments, serviceMilestones,
 * successions, byReference, byNode), on Postgres. Each answers in the order
 * the Firestore query it replaces did. Ids are passed as plain arrays: a
 * `sql.array` in a connection's first query reaches Postgres malformed. */

/** An edge or node document with its id spread in, as the Firestore paths
 * build it from a snapshot. Its fields are as loosely typed as
 * `doc.data()`, so a caller casts it to the shape it reads, as it does there. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithId = { id: string; [field: string]: any };

type Row = { id: string; data: Record<string, unknown> };

const spread = (rows: Row[]): WithId[] =>
  rows.map((row) => ({ ...row.data, id: row.id }));

/** Where a scan of employments resumes, as `startAfter(start_date, id)`. */
export type EmploymentCursor = { startDate: string; id: string };

/** One page of published `employed` edges, deleted ones too, ordered as the
 * Firestore index `(type, published, start_date desc, __name__ desc)` orders
 * them: string dates newest first in byte order, then a date of any other
 * kind (an explicit null), which Firestore ranks below every string. An edge
 * without the field is in no such index and so in no page. */
export async function readEmployedPage(
  cursor: EmploymentCursor | null,
  limit: number,
): Promise<WithId[]> {
  const sql = useDb();
  const start = sql`jsonb_text(data -> 'start_date')`;
  const after = cursor
    ? sql`AND (${start} IS NULL
        OR ${start} COLLATE "C" < ${cursor.startDate}
        OR (${start} = ${cursor.startDate} AND id < ${cursor.id}))`
    : sql``;
  const rows = await sql<Row[]>`
    SELECT id, data FROM edges
    WHERE type = 'employed' AND data -> 'published' = 'true'::jsonb
      AND data ? 'start_date' ${after}
    ORDER BY ${start} COLLATE "C" DESC NULLS LAST, id DESC
    LIMIT ${limit}`;
  return spread(rows);
}

/** Every published, live `employed` edge with a dated start and both ends,
 * newest first: what homeTimeline and serviceMilestones keep of their scan
 * of the pages above. `limit` stands for their MAX_SCAN. The WHERE and the
 * ORDER BY are those of edges_live_published_employments, word for word. */
export async function readPublishedEmployments(
  limit: number,
): Promise<WithId[]> {
  const sql = useDb();
  const rows = await sql<Row[]>`
    SELECT id, data FROM edges
    WHERE type = 'employed' AND data -> 'published' = 'true'::jsonb
      AND jsonb_text(data -> 'start_date') IS NOT NULL
      AND NOT deleted AND coalesce(source, '') <> '' AND coalesce(target, '') <> ''
    ORDER BY jsonb_text(data -> 'start_date') COLLATE "C" DESC, id DESC
    LIMIT ${limit}`;
  return spread(rows);
}

/** Node documents by id, as `getAll` hands them back: removed pages too,
 * absent ids left out. With `fields`, only those paths (a field mask). */
export async function readNodeDocs(
  ids: Iterable<string>,
  fields?: string[],
): Promise<Map<string, WithId>> {
  const wanted = [...new Set(ids)].filter(Boolean);
  const nodes = new Map<string, WithId>();
  if (wanted.length === 0) return nodes;
  const sql = useDb();
  // A mask that leaves `stats` out needs the stored document alone: the
  // join of node_stats was a scan of it for homeTimeline's 34 thousand ends.
  const rows =
    fields && !fields.some((f) => f === "stats" || f.startsWith("stats."))
      ? await sql<Row[]>`
          SELECT n.id, n.data FROM nodes n WHERE n.id = ANY(${wanted}::text[])`
      : await sql<Row[]>`
          SELECT n.id, ${servedDoc(sql)} AS data
          FROM nodes n LEFT JOIN node_stats s ON s.id = n.id LEFT JOIN node_derived d ON d.id = n.id
          WHERE n.id = ANY(${wanted}::text[])`;
  const byId = new Map(rows.map((row) => [row.id, row.data]));
  for (const id of wanted) {
    const data = byId.get(id);
    if (!data) continue;
    nodes.set(id, { ...(fields ? masked(data, fields) : data), id });
  }
  return nodes;
}

/** The fields of `data` a Firestore field mask would keep. */
function masked(
  data: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const path = field.split(".");
    let from: unknown = data;
    for (const key of path) {
      from =
        from && typeof from === "object"
          ? (from as Record<string, unknown>)[key]
          : undefined;
    }
    if (from === undefined) continue;
    let into = out;
    for (const key of path.slice(0, -1)) {
      into = (into[key] ??= {}) as Record<string, unknown>;
    }
    into[path.at(-1)!] = from;
  }
  return out;
}

/** A post the home timeline counts: who held it, when, the parties of the
 * person and the categories of the employer as stored, and the region the
 * employer is seated in. */
export type TimelinePost = {
  person: string;
  start: string;
  end: string | null;
  parties: Person["parties"];
  categories: Company["categories"];
  /** The most specific region with a published seat edge to the employer,
   * the first by id among equals; null when none. */
  seatTeryt: string | null;
  seatName: string | null;
};

/** The newest `limit` posts of readPublishedEmployments whose person and
 * employer are both published pages (`pageIsPublic`, the `is_approved`
 * column), with what
 * homeTimeline reads of them. It read the edge documents, every node
 * document at their ends and every region's served statistics to find the
 * seats, 3.9 s on the first request at x50. */
export async function readTimelinePosts(
  limit: number,
): Promise<TimelinePost[]> {
  const sql = useDb();
  return sql<TimelinePost[]>`
    WITH posts AS MATERIALIZED (
      SELECT id, source, target, jsonb_text(data -> 'start_date') AS start,
        jsonb_text(data -> 'end_date') AS "end"
      FROM edges
      WHERE type = 'employed' AND data -> 'published' = 'true'::jsonb
        AND jsonb_text(data -> 'start_date') IS NOT NULL
        AND NOT deleted AND coalesce(source, '') <> '' AND coalesce(target, '') <> ''
      ORDER BY jsonb_text(data -> 'start_date') COLLATE "C" DESC, id DESC
      LIMIT ${limit})
    SELECT p.source AS person, p.start, p."end", pn.data -> 'parties' AS parties,
      en.data -> 'categories' AS categories, seat.teryt AS "seatTeryt", seat.name AS "seatName"
    FROM posts p
    JOIN nodes pn ON pn.id = p.source AND pn.type = 'person' AND pn.is_approved
    JOIN nodes en ON en.id = p.target AND en.is_approved
    LEFT JOIN LATERAL (
      SELECT r.data ->> 'teryt' AS teryt, jsonb_text(r.data -> 'name') AS name
      FROM edges e JOIN nodes r ON r.id = e.source AND r.type = 'region'
      WHERE e.target = p.target AND e.type = 'seat' AND NOT e.deleted AND e.is_approved
        AND jsonb_typeof(r.data -> 'teryt') = 'string' AND r.data ->> 'teryt' <> ''
      ORDER BY length(r.data ->> 'teryt') DESC, r.id
      LIMIT 1) seat ON true
    ORDER BY p.start COLLATE "C" DESC, p.id DESC`;
}

/** The two-digit regions' names by teryt, the last by id winning. */
export async function readWojewodztwoNames(): Promise<Map<string, string>> {
  const sql = useDb();
  const rows = await sql<{ teryt: string; name: string }[]>`
    SELECT data ->> 'teryt' AS teryt, data ->> 'name' AS name FROM nodes
    WHERE type = 'region' AND jsonb_typeof(data -> 'teryt') = 'string'
      AND length(data ->> 'teryt') = 2 AND jsonb_typeof(data -> 'name') = 'string'
    ORDER BY id`;
  return new Map(rows.map((r) => [r.teryt, r.name]));
}

/** `employed` edges arriving at these companies, at most `limit`, by id. */
export async function readEmploymentsAt(
  companyIds: string[],
  limit: number,
): Promise<WithId[]> {
  const sql = useDb();
  const rows = await sql<Row[]>`
    SELECT id, data FROM edges
    WHERE target = ANY(${companyIds}::text[]) AND type = 'employed'
    ORDER BY id LIMIT ${limit}`;
  return spread(rows);
}

/** `employed` edges leaving one person, at most `limit`, by id. */
export async function readEmploymentsOf(
  personId: string,
  limit: number,
): Promise<WithId[]> {
  const sql = useDb();
  const rows = await sql<Row[]>`
    SELECT id, data FROM edges
    WHERE source = ${personId} AND type = 'employed'
    ORDER BY id LIMIT ${limit}`;
  return spread(rows);
}

/** Edges whose `references` hold the article, by id. */
export async function readEdgesCiting(articleId: string): Promise<WithId[]> {
  const sql = useDb();
  const rows = await sql<Row[]>`
    SELECT id, data FROM edges
    WHERE jsonb_typeof(data -> 'references') = 'array'
      AND data -> 'references' ? ${articleId}
    ORDER BY id`;
  return spread(rows);
}

/** The edges leaving a node, then the ones arriving, each by id, a
 * self-edge once. */
export async function readEdgesOfNode(nodeId: string): Promise<WithId[]> {
  const sql = useDb();
  const rows = await sql<Row[]>`
    SELECT id, data FROM (
      SELECT id, data, 0 AS side FROM edges WHERE source = ${nodeId}
      UNION ALL
      SELECT id, data, 1 FROM edges WHERE target = ${nodeId} AND source IS DISTINCT FROM ${nodeId}
    ) e ORDER BY side, id`;
  return spread(rows);
}

/** Every revision filed under these ids in `node_id`, by id. */
export async function readRevisionsOf(ids: string[]): Promise<WithId[]> {
  if (ids.length === 0) return [];
  const sql = useDb();
  const rows = await sql<Row[]>`
    SELECT id, data FROM revisions
    WHERE node_id = ANY(${ids}::text[]) AND jsonb_text(data -> 'node_id') = node_id
    ORDER BY id`;
  return spread(rows);
}

/** Each id's earliest revision by `update_time`, ties by id: the first
 * revision `writtenByImportOrReviewed` asks of, for many ids in one query. */
export async function readFirstRevisions(
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const firsts = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return firsts;
  const sql = useDb();
  const rows = await sql<{ node_id: string; data: Record<string, unknown> }[]>`
    SELECT DISTINCT ON (node_id) node_id, data FROM revisions
    WHERE node_id = ANY(${ids}::text[]) AND jsonb_text(data -> 'node_id') = node_id
      AND update_time IS NOT NULL
    ORDER BY node_id, update_time, id`;
  for (const row of rows) firsts.set(row.node_id, row.data);
  return firsts;
}
