/** The reads of POST /api/ingest/person, inside its transaction. Each lookup
 * is Firestore's equality query of the same name (first match by id), on the
 * column or expression an index serves. */
import type { NodeType } from "../../shared/model";
import { MAX_MERGE_HOPS } from "./graph";
import type { Data, Sql } from "./editorial";
import type { StoredDoc } from "./ingestWrites";
import { textArray } from "./textArray";

/** The fields a person ingest looks a node up by. */
export type LookupField =
  "krsNumber" | "sourceURL" | "teryt" | "rejestrIo" | "name";

function fieldMatch(sql: Sql, field: LookupField, value: string) {
  switch (field) {
    case "krsNumber":
      return sql`data ->> 'krsNumber' = ${value} AND jsonb_typeof(data -> 'krsNumber') = 'string'`;
    case "sourceURL":
      return sql`jsonb_text(data -> 'sourceURL') = ${value}`;
    case "teryt":
      return sql`data ? 'teryt' AND jsonb_text(data -> 'teryt') = ${value}`;
    case "rejestrIo":
      return sql`jsonb_text(data -> 'rejestrIo') = ${value}`;
    case "name":
      return sql`jsonb_text(data -> 'name') = ${value}`;
  }
}

/** The first node (by id) whose `field` is `value`, of `type` when given. */
export async function nodeByFieldPg(
  sql: Sql,
  field: LookupField,
  value: string,
  type?: NodeType,
): Promise<StoredDoc | undefined> {
  const typed = type ? sql`AND type = ${type}` : sql``;
  const [row] = await sql<StoredDoc[]>`
    SELECT id, data FROM nodes WHERE ${fieldMatch(sql, field, value)} ${typed}
    ORDER BY id LIMIT 1`;
  return row;
}

/** One node by id. */
export async function nodePg(
  sql: Sql,
  id: string,
): Promise<StoredDoc | undefined> {
  const [row] = await sql<
    StoredDoc[]
  >`SELECT id, data FROM nodes WHERE id = ${id}`;
  return row;
}

/** The page a node stands for after its merges (`resolveMergedNode`):
 * followed through `merged_into` at most `MAX_MERGE_HOPS` times, stopping at
 * a cycle. Undefined when a page on the way is missing. */
export async function resolveMergedPg(
  sql: Sql,
  id: string,
): Promise<StoredDoc | undefined> {
  let current = id;
  const seen = new Set([id]);
  for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
    const doc = await nodePg(sql, current);
    if (!doc) return undefined;
    const next = doc.data.merged_into;
    if (typeof next !== "string" || !next || seen.has(next)) return doc;
    seen.add(next);
    current = next;
  }
  return nodePg(sql, current);
}

/** Every node born on `birthDate`. */
export async function nodesBornPg(
  sql: Sql,
  birthDate: string,
): Promise<StoredDoc[]> {
  return sql<StoredDoc[]>`
    SELECT id, data FROM nodes WHERE jsonb_text(data -> 'birthDate') = ${birthDate}
    ORDER BY id`;
}

/** The person nodes with one of `words` anywhere in their name, as folded or
 * not: a superset of Firestore's `nameChunksLower array-contains-any`, which
 * Postgres does not store, for the caller to narrow by the name. */
export async function namesakesPg(
  sql: Sql,
  words: string[],
): Promise<StoredDoc[]> {
  if (words.length === 0) return [];
  const patterns = textArray(words.map((word) => `%${word}%`));
  return sql<StoredDoc[]>`
    SELECT id, data FROM nodes
    WHERE type = 'person'
      AND (lower(data ->> 'name') LIKE ANY(${patterns}::text[])
        OR polish_fold(lower(data ->> 'name')) LIKE ANY(${patterns}::text[]))
    ORDER BY id`;
}

/** Every edge leaving `source`, removed ones too, by id. */
export async function edgesFromPg(
  sql: Sql,
  source: string,
): Promise<StoredDoc[]> {
  return sql<StoredDoc[]>`
    SELECT id, data FROM edges WHERE source = ${source} ORDER BY id`;
}

export type { Data };
