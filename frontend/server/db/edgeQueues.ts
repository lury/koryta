import { useDb } from "./client";
import type { Data } from "./editorial";
import { textArray } from "./textArray";

/** The edge review queues on Postgres: the relations nobody has reviewed yet
 * (/api/edges/pending) and the unpublished ones (/api/edges/unpublished). */

export type EdgeRow = { id: string; data: Data };

/** Up to 50 edges whose `revision_id` is stored as null, by id, as
 * Firestore's `== null` read them (an edge without the field is not one). */
export async function edgesWithNullRevisionPg(): Promise<EdgeRow[]> {
  return useDb()<EdgeRow[]>`
    SELECT id, data FROM edges WHERE data -> 'revision_id' = 'null'::jsonb
    ORDER BY id LIMIT 50`;
}

/** The names of the nodes of `ids` that have one, by id. */
export async function nodeNamesPg(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await useDb()<{ id: string; name: string }[]>`
    SELECT id, data ->> 'name' AS name FROM nodes
    WHERE id = ANY(${textArray(ids)}::text[]) AND jsonb_truthy(data -> 'name')`;
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Every revision whose `node_id` is one of `ids`, `{id, ...data}`, by id. */
export async function revisionsForNodesPg(
  ids: string[],
): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const id of ids) out[id] = [];
  if (ids.length === 0) return out;
  const rows = await useDb()<{ id: string; data: Data; node_id: string }[]>`
    SELECT id, data, node_id FROM revisions
    WHERE node_id = ANY(${textArray(ids)}::text[])
      AND jsonb_typeof(data -> 'node_id') = 'string'
    ORDER BY id`;
  for (const row of rows) out[row.node_id]?.push({ id: row.id, ...row.data });
  return out;
}

/** The next `limit` edges stored with `published: false` after `cursor`, by
 * id. */
export async function unpublishedEdgePagePg(
  cursor: string | null,
  limit: number,
): Promise<EdgeRow[]> {
  const sql = useDb();
  return sql<EdgeRow[]>`
    SELECT id, data FROM edges
    WHERE data -> 'published' = 'false'::jsonb
      ${cursor === null ? sql`` : sql`AND id > ${cursor}`}
    ORDER BY id LIMIT ${limit}`;
}
