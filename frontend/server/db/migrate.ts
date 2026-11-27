import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./client";

/** The SQL migrations in `server/db/migrations`, applied in name order, each
 * once and each in its own transaction. What ran is in `schema_migrations`. */
export async function migrate(
  sql: Db,
  dir = join(import.meta.dirname, "migrations"),
): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const done = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map(
      (row) => row.name,
    ),
  );
  const applied: string[] = [];
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (done.has(name)) continue;
    const text = readFileSync(join(dir, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
    applied.push(name);
  }
  return applied;
}

/** Recomputes the derived statistics (0002_node_stats.sql). */
export async function refreshStats(sql: Db): Promise<number> {
  const started = performance.now();
  await sql`SELECT refresh_node_stats()`;
  return performance.now() - started;
}
