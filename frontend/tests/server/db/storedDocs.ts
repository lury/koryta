import type postgres from "postgres";
import { collectionTables } from "~~/server/db/collections";

/** Documents keyed by path (`<collection>/<id>`, `undefined` for none), as
 * the handler tests arrange them. */
export type StoredDocs = Record<string, Record<string, unknown> | undefined>;

/** Every table emptied, then the documents written to theirs: a test
 * arranges `stored`, then syncs it before the call. */
export async function syncStored(
  sql: postgres.Sql,
  stored: StoredDocs,
): Promise<void> {
  await sql.unsafe(`TRUNCATE ${Object.values(collectionTables).join(", ")}`);
  for (const [path, data] of Object.entries(stored)) {
    if (data === undefined) continue;
    const at = path.indexOf("/");
    const collection = path.slice(0, at) as keyof typeof collectionTables;
    const table = collectionTables[collection] as string | undefined;
    if (!table) throw new Error(`no table for ${path}`);
    await sql`INSERT INTO ${sql(table)} (id, data)
      VALUES (${path.slice(at + 1)}, ${sql.json(JSON.parse(JSON.stringify(data)))})`;
  }
}

/** One document as stored now, or undefined. */
export async function readStored(
  sql: postgres.Sql,
  path: string,
): Promise<Record<string, unknown> | undefined> {
  const at = path.indexOf("/");
  const table =
    collectionTables[path.slice(0, at) as keyof typeof collectionTables];
  const [row] = await sql<{ data: Record<string, unknown> }[]>`
    SELECT data FROM ${sql(table)} WHERE id = ${path.slice(at + 1)}`;
  return row?.data;
}
