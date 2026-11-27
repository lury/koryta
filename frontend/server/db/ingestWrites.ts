/**
 * The reads and writes the ingest endpoints (person, company) share, set-based:
 * every lookup a request needs in one statement, and every revision it writes
 * with its target in one statement a table, inside the request's
 * `editorialTx`.
 */
import type { Revision } from "../../shared/model";
import {
  nodeOwnedFields,
  sanitizeFirestoreData,
  withSeededNodeStats,
  type RevisionWriteOptions,
} from "../utils/revisions";
import {
  storable,
  tableOf,
  type Data,
  type Sql,
  type Tx,
  type WriteLog,
} from "./editorial";
import { newDocId } from "./ids";
import { revisionPath, type RevisionTarget } from "./revisionWrites";
import { textArray } from "./textArray";

export type RevisionWrite = {
  target: RevisionTarget;
  data: Data;
  options?: RevisionWriteOptions;
};

export type StoredDoc = { id: string; data: Data };

/** Files each revision and writes its data onto its target, as
 * `createRevisionPg` does one at a time: two statements a collection for the
 * whole request. The revision ids, in the order of `writes`. A target named
 * twice keeps the last write, as a batch's second `set` did. */
export async function createRevisionsPg(
  tx: Tx,
  log: WriteLog,
  user: { uid: string },
  writes: RevisionWrite[],
): Promise<string[]> {
  if (writes.length === 0) return [];
  const now = new Date().toISOString();
  const revisions: StoredDoc[] = [];
  const targets = {
    nodes: new Map<string, Data>(),
    edges: new Map<string, Data>(),
  };
  for (const { target, data, options = {} } of writes) {
    const { automatic = false, approve = false } = options;
    const id = newDocId();
    const revision: Revision & Data = {
      node_id: target.id,
      data: sanitizeFirestoreData(data),
      update_time: now,
      update_user: user.uid,
      collection: target.collection,
      status: approve ? "approved" : "pending",
      ...(approve ? { review_user: user.uid, review_time: now } : {}),
      update_automatic: automatic,
    } as Revision & Data;
    revisions.push({ id, data: storable("revisions", id, revision) });
    const written: Data = {
      ...(revision.data as Data),
      ...nodeOwnedFields(options.stored ?? {}),
    };
    if (options.published !== undefined) written.published = options.published;
    if (approve) written.revision_id = revisionPath(id);
    targets[target.collection].set(
      target.id,
      storable(
        target.collection,
        target.id,
        target.collection === "edges" ? written : withSeededNodeStats(written),
      ),
    );
  }

  await tx`
    INSERT INTO revisions (id, data)
    SELECT x.id, x.data FROM jsonb_to_recordset(${tx.json(revisions as never)}) AS x(id text, data jsonb)`;
  for (const row of revisions)
    log.add("revisions", row.id, undefined, row.data);

  for (const collection of ["nodes", "edges"] as const) {
    const rows = [...targets[collection]].map(([id, data]) => ({ id, data }));
    if (rows.length === 0) continue;
    const table = tx(tableOf(collection));
    const before = new Map(
      (
        await tx<StoredDoc[]>`
          SELECT id, data FROM ${table}
          WHERE id = ANY(${textArray(rows.map((r) => r.id))}::text[]) FOR UPDATE`
      ).map((row) => [row.id, row.data]),
    );
    await tx`
      INSERT INTO ${table} (id, data)
      SELECT x.id, x.data FROM jsonb_to_recordset(${tx.json(rows as never)}) AS x(id text, data jsonb)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = clock_timestamp()`;
    for (const row of rows)
      log.add(collection, row.id, before.get(row.id), row.data);
  }
  return revisions.map((row) => row.id);
}

export type EdgeKey = { source: string; target: string; type: string };

export const edgeKey = (edge: EdgeKey) =>
  `${edge.source}\u0000${edge.target}\u0000${edge.type}`;

/** Every stored edge (removed ones too) of each (source, target, type), by
 * `edgeKey`, in id order. */
export async function edgesOfPairsPg(
  sql: Sql,
  pairs: EdgeKey[],
): Promise<Map<string, StoredDoc[]>> {
  const out = new Map<string, StoredDoc[]>();
  const unique = new Map(pairs.map((pair) => [edgeKey(pair), pair]));
  for (const key of unique.keys()) out.set(key, []);
  if (unique.size === 0) return out;
  const list = [...unique.values()];
  const rows = await sql<(StoredDoc & EdgeKey)[]>`
    SELECT e.id, e.data, e.source, e.target, e.type
    FROM unnest(${textArray(list.map((p) => p.source))}::text[],
                ${textArray(list.map((p) => p.target))}::text[],
                ${textArray(list.map((p) => p.type))}::text[]) AS p(source, target, type)
    JOIN edges e ON e.source = p.source AND e.target = p.target AND e.type = p.type
    ORDER BY e.id`;
  for (const row of rows) {
    out.get(edgeKey(row))?.push({ id: row.id, data: row.data });
  }
  return out;
}

/** The first place node (by id) of each KRS number. */
export async function placesByKrsPg(
  sql: Sql,
  krss: string[],
): Promise<Map<string, StoredDoc>> {
  const unique = [...new Set(krss.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await sql<(StoredDoc & { krs: string })[]>`
    SELECT DISTINCT ON (data ->> 'krsNumber') data ->> 'krsNumber' AS krs, id, data
    FROM nodes
    WHERE type = 'place' AND data ->> 'krsNumber' = ANY(${textArray(unique)}::text[])
      AND jsonb_typeof(data -> 'krsNumber') = 'string'
    ORDER BY data ->> 'krsNumber', id`;
  return new Map(rows.map(({ krs, id, data }) => [krs, { id, data }]));
}

/** Which of `ids` name a node. */
export async function existingNodeIdsPg(
  sql: Sql,
  ids: string[],
): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM nodes WHERE id = ANY(${textArray(unique)}::text[])`;
  return new Set(rows.map((row) => row.id));
}

/** The region node of each TERYT code a request names, the way the ingest
 * resolves one: the exact code, then the powiat above a longer one; for
 * each, the node `teryt<code>`, else the first node (by id) whose `teryt` is
 * the code. Codes with no node are absent. */
export async function regionsByTerytPg(
  sql: Sql,
  codes: string[],
): Promise<Map<string, string>> {
  const candidatesOf = (code: string) =>
    code.length > 4 ? [code, code.slice(0, 4)] : [code];
  const all = [...new Set(codes.filter(Boolean).flatMap(candidatesOf))];
  if (all.length === 0) return new Map();
  const [byId, byField] = await Promise.all([
    existingNodeIdsPg(
      sql,
      all.map((code) => `teryt${code}`),
    ),
    sql<{ teryt: string; id: string }[]>`
      SELECT DISTINCT ON (jsonb_text(data -> 'teryt')) jsonb_text(data -> 'teryt') AS teryt, id
      FROM nodes WHERE data ? 'teryt' AND jsonb_text(data -> 'teryt') = ANY(${textArray(all)}::text[])
      ORDER BY jsonb_text(data -> 'teryt'), id`,
  ]);
  const field = new Map(byField.map((row) => [row.teryt, row.id]));
  const out = new Map<string, string>();
  for (const code of new Set(codes.filter(Boolean))) {
    for (const candidate of candidatesOf(code)) {
      const id = byId.has(`teryt${candidate}`)
        ? `teryt${candidate}`
        : field.get(candidate);
      if (id) {
        out.set(code, id);
        break;
      }
    }
  }
  return out;
}
