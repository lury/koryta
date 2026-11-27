import type postgres from "postgres";
import { collectionTables } from "~~/server/db/collections";

type Data = Record<string, unknown>;

/** Documents a test arranges in memory by `collection/id`, the way the
 * Firestore tests named them, that `around` writes to their tables before a
 * call and reads back after it, counting the rows the call wrote. The tests
 * ported from the Firestore doubles keep arranging and asserting on one map
 * while the code under test runs its SQL. */
export class PathMirror {
  readonly stored = new Map<string, Data>();
  /** Rows the last call inserted or updated, and their paths. */
  lastWrites = 0;
  lastWritten: string[] = [];

  constructor(private readonly sql: () => postgres.Sql) {}

  private static table(collection: string): string {
    const table = (collectionTables as Record<string, string>)[collection];
    if (!table) throw new Error(`PathMirror: no table for ${collection}`);
    return table;
  }

  async push(jobRuns: Record<string, Data> = {}) {
    const sql = this.sql();
    const tables = Object.values(collectionTables);
    await sql.unsafe(`TRUNCATE ${tables.join(", ")}, ops.job_runs`);
    const byTable = new Map<string, { id: string; data: Data }[]>();
    for (const [path, data] of this.stored) {
      const at = path.indexOf("/");
      const table = PathMirror.table(path.slice(0, at));
      const rows = byTable.get(table) ?? [];
      rows.push({
        id: path.slice(at + 1),
        data: JSON.parse(JSON.stringify(data)) as Data,
      });
      byTable.set(table, rows);
    }
    const runs = Object.entries(jobRuns).map(([id, data]) => ({ id, data }));
    if (runs.length > 0) byTable.set("ops.job_runs", runs);
    for (const [table, rows] of byTable) {
      await sql`
        INSERT INTO ${sql.unsafe(table)} (id, data)
        SELECT x.id, x.data
        FROM jsonb_to_recordset(${sql.json(rows as never)}) AS x(id text, data jsonb)`;
    }
  }

  /** Every table read back into the map, the audit rows in the order they
   * were filed; returns the rows written since `since`. */
  async pull(since: string): Promise<number> {
    const sql = this.sql();
    this.stored.clear();
    let written = 0;
    this.lastWritten = [];
    for (const [collection, table] of Object.entries(collectionTables)) {
      const order =
        table === "audit" ? "data ->> 'at', created_at, id" : "created_at, id";
      // `since` goes as text: typed timestamptz, postgres.js would send it
      // through a JS Date, which drops the microseconds, and a row the push
      // wrote in the same millisecond would count as written by the call.
      const rows = await sql.unsafe<
        { id: string; data: Data; fresh: boolean }[]
      >(
        `SELECT id, data, updated_at > $1::text::timestamptz AS fresh
         FROM ${table} ORDER BY ${order}`,
        [since],
      );
      for (const row of rows) {
        this.stored.set(`${collection}/${row.id}`, row.data);
        if (row.fresh) {
          written += 1;
          this.lastWritten.push(`${collection}/${row.id}`);
        }
      }
    }
    return written;
  }

  /** `run` against the documents as arranged, with what it wrote read
   * back. `unreadable` tables are renamed away for the call. */
  async around<T>(
    run: () => Promise<T>,
    options: { jobRuns?: Record<string, Data>; unreadable?: string[] } = {},
  ): Promise<T> {
    const sql = this.sql();
    await this.push(options.jobRuns);
    const [{ at }] = await sql<{ at: string }[]>`
      SELECT clock_timestamp()::text AS at`;
    const away = options.unreadable ?? [];
    for (const table of away)
      await sql.unsafe(
        `ALTER TABLE ${table} RENAME TO away_${table.split(".").pop()}`,
      );
    try {
      return await run();
    } finally {
      for (const table of away) {
        const [schema] = table.includes(".") ? table.split(".") : ["public"];
        await sql.unsafe(
          `ALTER TABLE ${schema}.away_${table.split(".").pop()} RENAME TO ${table.split(".").pop()}`,
        );
      }
      this.lastWrites = await this.pull(at!);
    }
  }

  /** Every document by path, its keys sorted, as text: equal for the same
   * documents whichever order they were written in. */
  state(): string {
    return JSON.stringify(
      sorted([...this.stored].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    );
  }
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(JSON.parse(JSON.stringify(value)) as Data)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sorted(v)]),
    );
  return value;
}
