import { useDb, type Db } from "./client";
import { servedDoc, toRow, type Fragment, type NodeRow } from "./nodes";

/** A row a pass of /api/search reads, with whether it was merged away: the
 * route drops those after the window is cut, as it did on Firestore. */
export type SearchRow = { node: NodeRow; deleted: boolean };

/** Whether `chunk` is one of the chunks `generateChunksLower` gives the
 * node's name, over the columns of 0101_a_search.sql. */
function chunkMatch(sql: Db, chunk: string): Fragment {
  // Every name carries the empty chunk: no query is the top of the list.
  if (chunk === "") return sql`n.search_whole IS NOT NULL`;
  if (chunk.startsWith("@")) {
    const town = chunk.slice(1);
    if (town === "" || town.includes(" ")) return sql`false`;
    return sql`n.search_town LIKE ${"% " + town + "%"}`;
  }
  const whole = sql`n.search_whole LIKE ${chunk + "%"}`;
  // A chunk with a space in it is a prefix of the whole name only.
  if (chunk.includes(" ")) return whole;
  return sql`(${whole} OR n.search_words LIKE ${"% " + chunk + "%"})`;
}

/** The Firestore query `nameChunksLower array-contains chunk`, `type in`
 * person, place, region, ordered by `stats.nodeGroupSize` (node_derived,
 * else the document's own) descending and then by id, as Firestore breaks
 * ties. A node without the field comes last:
 * Firestore's `orderBy` left it out, which on a database the nightly batch
 * has not run over would have been every node. */
export async function searchChunk(
  chunk: string,
  limit: number,
): Promise<SearchRow[]> {
  const sql = useDb();
  const rows = await sql<
    { id: string; deleted: boolean; doc: Record<string, unknown> }[]
  >`
    WITH hits AS MATERIALIZED (
      SELECT n.id, coalesce(d.node_group_size, search_rank(n.data)) AS rank
      FROM nodes n LEFT JOIN node_derived d ON d.id = n.id
      WHERE n.type IN ('person', 'place', 'region')
        AND ${chunkMatch(sql, chunk)}
      ORDER BY rank DESC NULLS LAST, n.id DESC
      LIMIT ${limit})
    SELECT n.id, n.deleted, ${servedDoc(sql)} AS doc
    FROM hits JOIN nodes n ON n.id = hits.id LEFT JOIN node_stats s ON s.id = n.id LEFT JOIN node_derived d ON d.id = n.id
    ORDER BY hits.rank DESC NULLS LAST, n.id DESC`;
  return rows.map((r) => ({ node: toRow(r.id, r.doc), deleted: r.deleted }));
}

/** The companies a KRS number names, five at most, by id. */
export async function searchKrs(krs: string): Promise<SearchRow[]> {
  const sql = useDb();
  const rows = await sql<
    { id: string; deleted: boolean; doc: Record<string, unknown> }[]
  >`
    SELECT n.id, n.deleted, ${servedDoc(sql)} AS doc
    FROM nodes n LEFT JOIN node_stats s ON s.id = n.id LEFT JOIN node_derived d ON d.id = n.id
    WHERE n.type = 'place' AND n.data ->> 'krsNumber' = ${krs}
      AND jsonb_typeof(n.data -> 'krsNumber') = 'string'
    ORDER BY n.id LIMIT 5`;
  return rows.map((r) => ({ node: toRow(r.id, r.doc), deleted: r.deleted }));
}
