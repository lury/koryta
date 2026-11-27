/**
 * The transaction the editorial writes (revisions, publication, merge and
 * split, declarations) run in, and the few statements every one of them
 * needs: a whole document stored after the schema check, a top-level patch
 * with `UPDATE … RETURNING`, an audit row. Everything else is the SQL of its
 * use case, in the module of that use case (decision on 2026-11-26: native
 * Postgres, no document-store adapter).
 *
 * What the Cloud Functions triggers did after a write runs in the same
 * transaction: each write here logs what it changed, and `editorialTx` hands
 * the log to `afterWrites` (writeEffects.ts) before it commits.
 */
import { createError } from "h3";
import type postgres from "postgres";
import type { ZodType } from "zod/v4";
import { useDb, type Db } from "./client";
import { collectionTables, type Collection } from "./collections";
import { newDocId } from "./ids";
import { emptyReport, normalizeDocument } from "./normalize";
import { textArray } from "./textArray";
import { afterWrites, type WrittenDoc } from "./writeEffects";
import { documentSchemas } from "../../shared/documents";
import type { AuditEntry } from "../../shared/audit";

export type Data = Record<string, unknown>;
export type Tx = postgres.TransactionSql;
export type Sql = Db | Tx;

/** What a transaction wrote, for the trigger effects. */
export class WriteLog {
  readonly changes: WrittenDoc[] = [];
  add(collection: Collection, id: string, before?: Data, after?: Data) {
    this.changes.push({ collection, id, before, after });
  }
}

/** Collections whose effects read the document as it was before the write. */
const READ_BEFORE = new Set<Collection>(["edges", "revisions"]);

/** One editorial transaction, with what the triggers did after its writes.
 * Read committed: the writes lock what they read (`FOR UPDATE`), and the
 * constraints refuse the rest. */
export async function editorialTx<T>(
  fn: (tx: Tx, log: WriteLog) => Promise<T>,
): Promise<T> {
  let result: T;
  await useDb().begin(async (tx) => {
    const log = new WriteLog();
    result = await fn(tx, log);
    await afterWrites(tx, log.changes, new Date().toISOString());
  });
  return result!;
}

export function tableOf(collection: Collection) {
  return collectionTables[collection];
}

const report = emptyReport();

/** The document as it is stored: normalised as the migration normalises it,
 * then checked against its collection's schema; a 400 when it does not fit.
 * A node's `stats` is left out of the check: the views derive it. */
export function storable(collection: Collection, id: string, doc: Data): Data {
  const plain = JSON.parse(JSON.stringify(doc)) as Data;
  const schema = (documentSchemas as Record<string, ZodType | undefined>)[
    collection
  ];
  if (!schema) return plain;
  const data = normalizeDocument(collection, id, plain, report);
  const { stats: _, ...checked } = data;
  const parsed = schema.safeParse(collection === "nodes" ? checked : data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw createError({
      statusCode: 400,
      message: `${collection}/${id}: ${issue?.path.join(".") || "(document)"} ${issue?.message ?? "invalid"}`,
    });
  }
  return data;
}

/** One document by id, or undefined. `lock` takes its row for the rest of the
 * transaction. */
export async function readDoc(
  sql: Sql,
  collection: Collection,
  id: string,
  lock = false,
): Promise<Data | undefined> {
  const t = sql(tableOf(collection));
  const [row] = lock
    ? await sql<
        { data: Data }[]
      >`SELECT data FROM ${t} WHERE id = ${id} FOR UPDATE`
    : await sql<{ data: Data }[]>`SELECT data FROM ${t} WHERE id = ${id}`;
  return row?.data;
}

/** The documents of `ids` that exist, by id. */
export async function readDocs(
  sql: Sql,
  collection: Collection,
  ids: Iterable<string>,
): Promise<Map<string, Data>> {
  const wanted = [...new Set(ids)].filter(Boolean);
  if (wanted.length === 0) return new Map();
  const rows = await sql<{ id: string; data: Data }[]>`
    SELECT id, data FROM ${sql(tableOf(collection))}
    WHERE id = ANY(${textArray(wanted)}::text[])`;
  return new Map(rows.map((row) => [row.id, row.data]));
}

/** Stores `data` as the whole document `id`, replacing what is there; with
 * `create`, a 409 when the id is taken. What is stored comes back. */
export async function storeDoc(
  tx: Tx,
  log: WriteLog,
  collection: Collection,
  id: string,
  data: Data,
  options: { create?: boolean } = {},
): Promise<Data> {
  const t = tx(tableOf(collection));
  const doc = storable(collection, id, data);
  const before = READ_BEFORE.has(collection)
    ? await readDoc(tx, collection, id, true)
    : undefined;
  if (options.create) {
    const rows = await tx`
      INSERT INTO ${t} (id, data) VALUES (${id}, ${tx.json(doc as never)})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (rows.length === 0) {
      throw createError({
        statusCode: 409,
        message: `${collection}/${id} already exists`,
      });
    }
  } else {
    await tx`
      INSERT INTO ${t} (id, data) VALUES (${id}, ${tx.json(doc as never)})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = clock_timestamp()`;
  }
  log.add(collection, id, before, doc);
  return doc;
}

/** Sets the top-level fields of `set` and removes those of `unset` on an
 * existing document, checked against its schema after. The document as it is
 * now, or undefined when there is none. */
export async function patchDoc(
  tx: Tx,
  log: WriteLog,
  collection: Collection,
  id: string,
  set: Data,
  unset: string[] = [],
): Promise<Data | undefined> {
  const t = tx(tableOf(collection));
  const before = READ_BEFORE.has(collection)
    ? await readDoc(tx, collection, id, true)
    : undefined;
  const fields = JSON.parse(JSON.stringify(set)) as Data;
  const [row] = await tx<{ data: Data }[]>`
    UPDATE ${t}
    SET data = (data || ${tx.json(fields as never)}::jsonb) - ${textArray(unset)}::text[],
        updated_at = clock_timestamp()
    WHERE id = ${id} RETURNING data`;
  if (!row) return undefined;
  storable(collection, id, row.data);
  log.add(collection, id, before, row.data);
  return row.data;
}

/** Files one administrator decision (shared/audit.ts), in the transaction of
 * the change it describes. `at` is stamped here, so every row is dated by the
 * same clock. */
export async function recordAuditPg(
  tx: Tx,
  entry: Omit<AuditEntry, "at">,
): Promise<void> {
  const id = newDocId();
  const doc = storable("audit", id, {
    ...entry,
    at: new Date().toISOString(),
  });
  await tx`INSERT INTO audit (id, data) VALUES (${id}, ${tx.json(doc as never)})`;
  console.info(
    `Audit ${entry.action} ${entry.collection}/${entry.target_id}` +
      (entry.revision_id ? ` revision=${entry.revision_id}` : "") +
      ` by=${entry.user}`,
  );
}

/** A stored instant as a Date: the ISO string the field holds, or a
 * Firestore-era `{_seconds}`. Null for anything else. */
export function instantOf(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  if (value && typeof value === "object") {
    const obj = value as { toDate?: () => Date; _seconds?: number };
    if (typeof obj.toDate === "function") return obj.toDate();
    if (typeof obj._seconds === "number") return new Date(obj._seconds * 1000);
  }
  return null;
}
