import type postgres from "postgres";
import { useDb } from "./client";
import { newDocId } from "./ids";
import { textArray } from "./textArray";

/** The ops statements (server/utils/opsTasks.ts, jobs.ts, jobRequests.ts,
 * qaReleases.ts, /api/admin/searches): the `agent-tasks` database is the
 * `ops` schema. Instants are stored as ISO strings. */

type Data = Record<string, unknown>;
export type Row = { id: string; data: Data };
type Tx = postgres.TransactionSql;

// --- the owner's task list -------------------------------------------------

export async function listTasksPg(sql: Tx | postgres.Sql = useDb()) {
  return sql<Row[]>`SELECT id, data FROM ops.tasks ORDER BY id`;
}

/** A change to the task list, judged against the whole list as it is: the
 * writers take the list's lock in turn, the readers do not wait. */
export async function withTaskListPg<T>(
  fn: (tasks: Row[], tx: Tx) => Promise<T>,
): Promise<T> {
  return useDb().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('ops.tasks'))`;
    return fn(await listTasksPg(tx), tx);
  }) as Promise<T>;
}

/** Writes whole task documents; with `create`, a new id only (false when it
 * is taken). */
export async function storeTasksPg(
  tx: Tx,
  docs: Row[],
  options: { create?: boolean } = {},
): Promise<boolean> {
  if (docs.length === 0) return true;
  const rows = options.create
    ? await tx`
        INSERT INTO ops.tasks (id, data)
        SELECT x.id, x.data FROM jsonb_to_recordset(${tx.json(docs as never)}) AS x(id text, data jsonb)
        ON CONFLICT (id) DO NOTHING RETURNING id`
    : await tx`
        INSERT INTO ops.tasks (id, data)
        SELECT x.id, x.data FROM jsonb_to_recordset(${tx.json(docs as never)}) AS x(id text, data jsonb)
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        RETURNING id`;
  return rows.length === docs.length;
}

// --- job runs ----------------------------------------------------------------

export async function runningRunsPg(): Promise<Row[]> {
  return useDb()<Row[]>`
    SELECT id, data FROM ops.job_runs WHERE data @> '{"state": "running"}' ORDER BY id`;
}

/** The newest `limit` runs by `startedAt`, newest first; a run without one
 * is not among them, as Firestore's `orderBy` left it out. */
export async function newestRunsPg(limit: number): Promise<Row[]> {
  return useDb()<Row[]>`
    SELECT id, data FROM ops.job_runs
    WHERE jsonb_text(data -> 'startedAt') IS NOT NULL
    ORDER BY jsonb_text(data -> 'startedAt') COLLATE "C" DESC, id DESC
    LIMIT ${limit}`;
}

export async function jobRecordsPg(): Promise<Row[]> {
  return useDb()<Row[]>`SELECT id, data FROM ops.jobs ORDER BY id`;
}

export async function runsByIdPg(ids: string[]): Promise<Row[]> {
  if (ids.length === 0) return [];
  return useDb()<Row[]>`
    SELECT id, data FROM ops.job_runs WHERE id = ANY(${textArray(ids)}::text[])`;
}

export async function readRunPg(id: string): Promise<Data | undefined> {
  const [row] = await useDb()<{ data: Data }[]>`
    SELECT data FROM ops.job_runs WHERE id = ${id}`;
  return row?.data;
}

export async function runsOfNodePg(nodeId: string): Promise<Row[]> {
  const sql = useDb();
  return sql<Row[]>`
    SELECT id, data FROM ops.job_runs
    WHERE data @> ${sql.json({ request: { nodeId } })} ORDER BY id`;
}

/** Queues a run unless `max` are waiting already: the count and the insert
 * under one lock, so two requests cannot both take the last place. The
 * number waiting when it was refused, or null when it was queued. */
export async function queueRunPg(
  id: string,
  doc: Data,
  max: number,
): Promise<number | null> {
  return useDb().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('ops.job_runs queued'))`;
    const [row] = await tx<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM ops.job_runs
      WHERE data @> '{"state": "queued"}'`;
    const waiting = row?.waiting ?? 0;
    if (waiting >= max) return waiting;
    await tx`INSERT INTO ops.job_runs (id, data) VALUES (${id}, ${tx.json(doc as never)})`;
    return null;
  }) as Promise<number | null>;
}

/** Notes the runner's start on a run; false when the run is gone. */
export async function setRunDispatchPg(
  id: string,
  dispatch: object,
): Promise<boolean> {
  const sql = useDb();
  const rows = await sql`
    UPDATE ops.job_runs
    SET data = data || jsonb_build_object('dispatch', ${sql.json(dispatch as never)}::jsonb),
        updated_at = now()
    WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

// --- captures (`articlePages`) ---------------------------------------------------

/** The newest captures by `capturedAt`, newest first, of one status or all;
 * with `since`, from then on only. */
export async function capturesPg(options: {
  status?: string;
  since?: string;
  limit: number;
}): Promise<Row[]> {
  const sql = useDb();
  return sql<Row[]>`
    SELECT id, data FROM article_pages
    WHERE jsonb_text(data -> 'capturedAt') IS NOT NULL
      ${options.status ? sql`AND data @> ${sql.json({ status: options.status })}` : sql``}
      ${options.since ? sql`AND jsonb_text(data -> 'capturedAt') COLLATE "C" >= ${options.since}` : sql``}
    ORDER BY jsonb_text(data -> 'capturedAt') COLLATE "C" DESC, id DESC
    LIMIT ${options.limit}`;
}

/** How many captures of each status came in from `since` on. */
export async function captureCountsPg(
  since: string,
): Promise<Map<string, number>> {
  const rows = await useDb()<{ status: string; n: number }[]>`
    SELECT jsonb_text(data -> 'status') AS status, count(*)::int AS n
    FROM article_pages
    WHERE jsonb_text(data -> 'capturedAt') COLLATE "C" >= ${since}
      AND jsonb_text(data -> 'status') IS NOT NULL
    GROUP BY 1`;
  return new Map(rows.map((row) => [row.status, row.n]));
}

export async function readCapturePg(id: string): Promise<Data | undefined> {
  const [row] = await useDb()<{ data: Data }[]>`
    SELECT data FROM article_pages WHERE id = ${id}`;
  return row?.data;
}

// --- the search log ------------------------------------------------------------------

/** Keeps one settled search under a new id (`/api/search/log`). */
export async function recordSearchPg(entry: Data): Promise<void> {
  await useDb()`
    INSERT INTO ops.search_queries (id, data) VALUES (${newDocId()}, ${useDb().json(entry as never)})`;
}

/** The newest `limit` searches from `since` on, newest first. */
export async function searchesSincePg(
  since: string,
  limit: number,
): Promise<Data[]> {
  const rows = await useDb()<{ data: Data }[]>`
    SELECT data FROM ops.search_queries
    WHERE (data ->> 'at') COLLATE "C" >= ${since}
    ORDER BY (data ->> 'at') COLLATE "C" DESC, id DESC
    LIMIT ${limit}`;
  return rows.map((row) => row.data);
}

// --- the QA changelog's rollouts ----------------------------------------------------

/** Adds the entries of `added` the record of `backend` does not date yet,
 * keeping every date already there; the record as it then stands. One
 * statement, so the instances of one rollout starting together agree on
 * whose start dates the new entries. */
export async function recordQaReleasesPg(
  backend: string,
  added: Record<string, string>,
): Promise<Record<string, string>> {
  const sql = useDb();
  const keys = Object.keys(added);
  if (keys.length > 0) {
    // Nothing is written once every entry is dated.
    const [row] = await sql<{ items: Record<string, string> }[]>`
      INSERT INTO qa_releases (id, data)
      VALUES (${backend}, jsonb_build_object('items', ${sql.json(added)}::jsonb))
      ON CONFLICT (id) DO UPDATE
        SET data = qa_releases.data || jsonb_build_object('items',
              EXCLUDED.data -> 'items'
              || CASE WHEN jsonb_typeof(qa_releases.data -> 'items') = 'object'
                   THEN qa_releases.data -> 'items' ELSE '{}'::jsonb END),
            updated_at = now()
        WHERE jsonb_typeof(qa_releases.data -> 'items') IS DISTINCT FROM 'object'
          OR NOT (qa_releases.data -> 'items') ?& ${textArray(keys)}::text[]
      RETURNING data -> 'items' AS items`;
    if (row) return row.items;
  }
  const [row] = await sql<{ items: Record<string, string> | null }[]>`
    SELECT data -> 'items' AS items FROM qa_releases WHERE id = ${backend}`;
  return row?.items ?? {};
}
