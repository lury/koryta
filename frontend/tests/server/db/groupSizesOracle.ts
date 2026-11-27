import type postgres from "postgres";

/** `node_group_sizes(roots)` and its view `group_links` as 0602_stats_sql.sql
 * defined them before the nightly count moved to server/db/groupSizes.ts
 * (0920), over live edges as 0921 counts them: the oracle the job is checked
 * against, in a schema of its own. */
const ORACLE = `
CREATE SCHEMA IF NOT EXISTS group_oracle;

CREATE OR REPLACE VIEW group_oracle.group_links AS
WITH graph AS (
  SELECT id FROM public.nodes WHERE type IN ('person', 'place', 'region')
), l AS (
  SELECT e.source AS from_id, e.target AS to_id, e.type IN ('employed', 'connection', 'owns') AS to_active
  FROM public.edges e
  WHERE e.type IN ('employed', 'connection', 'mentions', 'owns', 'seat', 'comment', 'election', 'tagged')
    AND NOT e.deleted
  UNION ALL
  SELECT e.target, e.source, e.type IN ('connection', 'mentions')
  FROM public.edges e
  WHERE e.type IN ('employed', 'connection', 'mentions', 'owns', 'seat', 'comment', 'election', 'tagged')
    AND NOT e.deleted
)
SELECT l.from_id, l.to_id, l.to_active FROM l
JOIN graph f ON f.id = l.from_id JOIN graph t ON t.id = l.to_id
WHERE NOT (l.to_active AND l.from_id = l.to_id);

CREATE OR REPLACE FUNCTION group_oracle.node_group_sizes(roots text[]) RETURNS TABLE (id text, size int)
LANGUAGE sql STABLE SET work_mem = '512MB' AS $$
  WITH RECURSIVE graph AS MATERIALIZED (
    SELECT n.id, row_number() OVER ()::int AS i,
      n.type = 'person' AND NOT public.js_truthy(n.data -> 'hide') AS counted
    FROM public.nodes n WHERE n.type IN ('person', 'place', 'region')
  ), links AS MATERIALIZED (
    SELECT f.i AS from_i, t.i AS to_i, l.to_active, t.counted
    FROM group_oracle.group_links l JOIN graph f ON f.id = l.from_id JOIN graph t ON t.id = l.to_id
  ), root AS MATERIALIZED (
    SELECT DISTINCT g.i, g.id FROM unnest(roots) r JOIN graph g ON g.id = r
  ), reach(root, node) AS (
    SELECT r.i, l.to_i FROM root r JOIN links l ON l.from_i = r.i AND l.to_active
    UNION
    SELECT reach.root, l.to_i FROM reach JOIN links l ON l.from_i = reach.node AND l.to_active
  ), active AS (
    SELECT reach.root, count(*) AS n FROM reach JOIN graph g ON g.i = reach.node AND g.counted
    GROUP BY reach.root
  ), dead AS (
    SELECT x.root, count(*) AS n FROM (
      SELECT DISTINCT a.root, l.to_i
      FROM (SELECT root, node FROM reach UNION ALL SELECT i, i FROM root) a
      JOIN links l ON l.from_i = a.node AND NOT l.to_active AND l.counted) x
    GROUP BY 1
  )
  SELECT r.id, (coalesce(a.n, 0) + coalesce(d.n, 0))::int
  FROM root r LEFT JOIN active a ON a.root = r.i LEFT JOIN dead d ON d.root = r.i
$$;
`;

export async function installGroupSizesOracle(
  sql: postgres.Sql | postgres.TransactionSql,
): Promise<void> {
  await sql.unsafe(ORACLE);
}

/** Nodes whose stored size is not the oracle's (0 off the graph), with the
 * first few. */
export async function groupSizeMismatches(
  sql: postgres.Sql | postgres.TransactionSql,
): Promise<{
  count: number;
  first: { id: string; stored: number; oracle: number }[];
}> {
  const rows = await sql<{ id: string; stored: number; oracle: number }[]>`
    WITH o AS (
      SELECT * FROM group_oracle.node_group_sizes(ARRAY(
        SELECT id FROM nodes WHERE type IN ('person', 'place', 'region'))))
    SELECT n.id, d.node_group_size AS stored, coalesce(o.size, 0) AS oracle
    FROM nodes n LEFT JOIN node_derived d ON d.id = n.id LEFT JOIN o ON o.id = n.id
    WHERE d.node_group_size IS DISTINCT FROM coalesce(o.size, 0)
    ORDER BY n.id`;
  return { count: rows.length, first: rows.slice(0, 3).map((r) => ({ ...r })) };
}
