import type postgres from "postgres";

type Doc = Record<string, unknown>;

/** Documents a test arranges in memory, by table, that `around` writes to
 * their tables before a call and reads back after it: the tests ported from
 * the Firestore fakes keep arranging and asserting on plain maps while the
 * code under test runs its SQL. */
export class Mirror {
  private readonly maps = new Map<string, Map<string, Doc>>();

  constructor(
    private readonly sql: () => postgres.Sql,
    readonly tables: readonly string[],
  ) {
    for (const table of tables) this.maps.set(table, new Map());
  }

  docs(table: string): Map<string, Doc> {
    const docs = this.maps.get(table);
    if (!docs) throw new Error(`Mirror: no table ${table}`);
    return docs;
  }

  clear() {
    for (const docs of this.maps.values()) docs.clear();
  }

  async push() {
    const sql = this.sql();
    for (const [table, docs] of this.maps) {
      await sql.unsafe(`TRUNCATE ${table}`);
      const rows = [...docs].map(([id, data]) => ({
        id,
        data: JSON.parse(JSON.stringify(data)) as Doc,
      }));
      if (rows.length === 0) continue;
      await sql`
        INSERT INTO ${sql(table)} (id, data)
        SELECT x.id, x.data FROM jsonb_to_recordset(${sql.json(rows as never)}) AS x(id text, data jsonb)`;
    }
  }

  async pull() {
    const sql = this.sql();
    for (const [table, docs] of this.maps) {
      const rows = await sql<{ id: string; data: Doc }[]>`
        SELECT id, data FROM ${sql(table)} ORDER BY id`;
      docs.clear();
      for (const row of rows) docs.set(row.id, row.data);
    }
  }

  /** `run` against the tables as arranged, with what it wrote read back. */
  async around<T>(run: () => Promise<T>): Promise<T> {
    await this.push();
    try {
      return await run();
    } finally {
      await this.pull();
    }
  }
}
