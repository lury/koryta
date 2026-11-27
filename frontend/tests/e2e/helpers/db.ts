import postgres from "postgres";
import {
  collectionTables,
  opsCollectionTables,
} from "../../../server/db/collections";
import { afterWrites, type WrittenDoc } from "../../../server/db/writeEffects";

/** The Postgres the dev server under test reads (DATABASE_URL, as
 * scripts/seed-emulator.ts seeds it). The specs arrange documents straight
 * in their tables and read back what the app wrote; a write to nodes or
 * edges also refreshes what the app's own writes refresh (writeEffects.ts),
 * so a seeded page shows in the lists the way a saved one does. */

type Doc = Record<string, unknown>;
/** A document read back: the specs assert on its fields as they find them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stored = Record<string, any>;

/** A spec's collection name, or a table of the ops schema. */
export type Table =
  keyof typeof collectionTables | keyof typeof opsCollectionTables;

let pool: postgres.Sql | undefined;

export function sql(): postgres.Sql {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set: the e2e specs seed the Postgres the dev server reads",
    );
  }
  pool = postgres(url, { max: 2, onnotice: () => {} });
  return pool;
}

function tableOf(name: Table): string {
  return (
    (collectionTables as Record<string, string>)[name] ??
    (opsCollectionTables as Record<string, string>)[name]!
  );
}

function plain(data: Doc): Doc {
  return JSON.parse(JSON.stringify(data)) as Doc;
}

/** Writes each document whole (or, with `merge`, its fields over the stored
 * ones), in one transaction with the effects of the app's own writes. */
export async function putDocs(
  name: Table,
  docs: Record<string, Doc>,
  options: { merge?: boolean } = {},
): Promise<void> {
  const table = tableOf(name);
  await sql().begin(async (tx) => {
    const changes: WrittenDoc[] = [];
    for (const [id, data] of Object.entries(docs)) {
      const [before] = await tx<{ data: Doc }[]>`
        SELECT data FROM ${tx(table)} WHERE id = ${id} FOR UPDATE`;
      const [after] = await tx<{ data: Doc }[]>`
        INSERT INTO ${tx(table)} AS t (id, data)
        VALUES (${id}, ${tx.json(plain(data) as never)})
        ON CONFLICT (id) DO UPDATE SET
          data = ${options.merge ? tx`jsonb_merge_deep(t.data, EXCLUDED.data)` : tx`EXCLUDED.data`},
          updated_at = clock_timestamp()
        RETURNING data`;
      changes.push({
        collection: name,
        id,
        before: before?.data,
        after: after!.data,
      });
    }
    await afterWrites(tx, changes, new Date().toISOString());
  });
}

export async function putDoc(
  name: Table,
  id: string,
  data: Doc,
  options: { merge?: boolean } = {},
): Promise<void> {
  await putDocs(name, { [id]: data }, options);
}

/** A stored document, or undefined. */
export async function readDoc<T = Stored>(
  name: Table,
  id: string,
): Promise<T | undefined> {
  const table = tableOf(name);
  const [row] = await sql()<{ data: T }[]>`
    SELECT data FROM ${sql()(table)} WHERE id = ${id}`;
  return row?.data;
}

/** The documents holding every field of `match` (`@>`), by id. */
export async function readDocs<T = Stored>(
  name: Table,
  match: Doc,
): Promise<{ id: string; data: T }[]> {
  const table = tableOf(name);
  return [
    ...(await sql()<{ id: string; data: T }[]>`
      SELECT id, data FROM ${sql()(table)}
      WHERE data @> ${sql().json(plain(match) as never)} ORDER BY id`),
  ];
}

/** Deletes the documents, with the effects of the app's own deletes. */
export async function deleteDocs(name: Table, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const table = tableOf(name);
  await sql().begin(async (tx) => {
    const gone = await tx<{ id: string; data: Doc }[]>`
      DELETE FROM ${tx(table)} WHERE id = ANY(${ids}::text[])
      RETURNING id, data`;
    await afterWrites(
      tx,
      gone.map((row) => ({
        collection: name,
        id: row.id,
        before: row.data,
        after: undefined,
      })),
      new Date().toISOString(),
    );
  });
}

/** Deletes every document whose id starts with `prefix`: what an earlier run
 * of the spec left behind. */
export async function deleteByPrefix(
  name: Table,
  prefix: string,
): Promise<void> {
  const table = tableOf(name);
  const rows = await sql()<{ id: string }[]>`
    SELECT id FROM ${sql()(table)} WHERE starts_with(id, ${prefix})`;
  await deleteDocs(
    name,
    rows.map((row) => row.id),
  );
}

/** An instant as the tables store one. */
export function at(ms: number = Date.now()): string {
  return new Date(ms).toISOString();
}
