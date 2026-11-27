import type { Db } from "./client";
import { refreshGroupSizes } from "./groupSizes";

/** /api/stats/computeNodes on Postgres: every derived field recomputed in
 * SQL and written only where it changed. The views' tables
 * (`refresh_node_stats`, 0002_node_stats.sql and 0602_node_stats_tables.sql),
 * a person's `queueTier` and every node's `revisions`
 * (0501_e_batch_fields.sql), `searchLine` (`refresh_node_derived`,
 * 0602_stats_sql.sql), `nodeGroupSize` (groupSizes.ts), then the census of
 * /api/stats/database (`refresh_database_counts`, 0606). The writes keep all of them
 * current for the nodes they touch (writeEffects.ts); this is the nightly
 * pass that catches what the day moved, the dates that passed. */

export interface BatchReport {
  nodes: number;
  regions: number;
  changed: {
    nodeStats: number;
    queueTier: number;
    revisions: number;
    derived: number;
    groupSizes: number;
  };
  ms: {
    views: number;
    queueTier: number;
    revisions: number;
    derived: number;
    groupSizes: number;
    census: number;
    total: number;
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const started = performance.now();
  const value = await fn();
  return [value, performance.now() - started];
}

export async function recountBatch(
  sql: Db,
  options: { now?: Date } = {},
): Promise<BatchReport> {
  const started = performance.now();
  const now = options.now ?? new Date();

  const [[stats], views] = await timed(
    () => sql<{ n: number }[]>`SELECT refresh_node_stats()::int AS n`,
  );
  const [[tiers], queueTier] = await timed(
    () => sql<{ n: number }[]>`SELECT refresh_queue_tiers(${now})::int AS n`,
  );
  const [[revs], revisions] = await timed(
    () => sql<{ n: number }[]>`SELECT refresh_node_revisions()::int AS n`,
  );
  const [[derivedRows], derived] = await timed(
    () => sql<{ n: number }[]>`SELECT refresh_node_derived(${now})::int AS n`,
  );
  const [groups, groupSizes] = await timed(() => refreshGroupSizes(sql));
  // Last: the census counts what the steps above wrote.
  const [, census] = await timed(() => sql`SELECT refresh_database_counts()`);
  const [counts] = await sql<{ nodes: number; regions: number }[]>`
    SELECT count(*)::int AS nodes, count(*) FILTER (WHERE type = 'region')::int AS regions
    FROM nodes`;

  return {
    nodes: counts?.nodes ?? 0,
    regions: counts?.regions ?? 0,
    changed: {
      nodeStats: stats?.n ?? 0,
      queueTier: tiers?.n ?? 0,
      revisions: revs?.n ?? 0,
      derived: derivedRows?.n ?? 0,
      groupSizes: groups.changed,
    },
    ms: {
      views,
      queueTier,
      revisions,
      derived,
      groupSizes,
      census,
      total: performance.now() - started,
    },
  };
}
