-- nodeGroupSize counts live edges only: a relation an editor deleted no
-- longer lifts a person in search. The nightly count of
-- server/db/groupSizes.ts reads live edges alone, and so does the walk of a
-- write; deleting or restoring an edge moves the sizes like any other edge
-- write (`ends` in writeEffects.ts).

CREATE OR REPLACE FUNCTION node_group_sizes_near(roots text[]) RETURNS TABLE (id text, size int)
LANGUAGE sql STABLE SET jit = off AS $$
  WITH RECURSIVE root AS (
    SELECT DISTINCT n.id FROM unnest(roots) r JOIN public.nodes n ON n.id = r
    WHERE n.type IN ('person', 'place', 'region')
  ), reach(root, node) AS (
    SELECT r.id, nx.id FROM root r CROSS JOIN LATERAL (
      SELECT e.target AS id FROM public.edges e
      WHERE NOT e.deleted AND e.source = r.id AND e.type IN ('employed', 'connection', 'owns') AND e.target <> r.id
      UNION ALL
      SELECT e.source FROM public.edges e
      WHERE NOT e.deleted AND e.target = r.id AND e.type IN ('connection', 'mentions') AND e.source <> r.id) nx
    JOIN public.nodes g ON g.id = nx.id AND g.type IN ('person', 'place', 'region')
    UNION
    SELECT reach.root, nx.id FROM reach CROSS JOIN LATERAL (
      SELECT e.target AS id FROM public.edges e
      WHERE NOT e.deleted AND e.source = reach.node AND e.type IN ('employed', 'connection', 'owns') AND e.target <> reach.node
      UNION ALL
      SELECT e.source FROM public.edges e
      WHERE NOT e.deleted AND e.target = reach.node AND e.type IN ('connection', 'mentions') AND e.source <> reach.node) nx
    JOIN public.nodes g ON g.id = nx.id AND g.type IN ('person', 'place', 'region')
  ), walked AS MATERIALIZED (
    SELECT * FROM reach
  ), active AS (
    SELECT w.root, count(*) AS n FROM walked w
    JOIN public.nodes p ON p.id = w.node AND p.type = 'person' AND NOT public.js_truthy(p.data -> 'hide')
    GROUP BY w.root
  ), dead AS (
    SELECT x.root, count(DISTINCT x.id) AS n FROM (
      SELECT a.root, nx.id FROM (SELECT root, node FROM walked UNION ALL SELECT id, id FROM root) a
      CROSS JOIN LATERAL (
        SELECT e.target AS id FROM public.edges e
        WHERE NOT e.deleted AND e.source = a.node AND e.type IN ('mentions', 'seat', 'comment', 'election', 'tagged')
        UNION ALL
        SELECT e.source FROM public.edges e
        WHERE NOT e.deleted AND e.target = a.node AND e.type IN ('employed', 'owns', 'seat', 'comment', 'election', 'tagged')) nx
    ) x JOIN public.nodes p ON p.id = x.id AND p.type = 'person' AND NOT public.js_truthy(p.data -> 'hide')
    GROUP BY x.root
  )
  SELECT r.id, (coalesce(a.n, 0) + coalesce(d.n, 0))::int
  FROM root r LEFT JOIN active a ON a.root = r.id LEFT JOIN dead d ON d.root = r.id
$$;

-- The nodes whose size may change when the edges at `ends` change, or the
-- type or `hide` of `changed`: everything with a walk to one of them, and
-- for `changed` also to a node with a link into it. Over any node, so that
-- a node that has just left the graph still counts.
CREATE OR REPLACE FUNCTION node_group_affected(ends text[], changed text[] DEFAULT '{}')
RETURNS TABLE (id text) LANGUAGE sql STABLE SET jit = off AS $$
  WITH RECURSIVE seed AS (
    SELECT unnest(ends || changed) AS id
    UNION
    SELECT e.source FROM public.edges e WHERE NOT e.deleted AND e.target = ANY(changed) AND e.source IS NOT NULL
      AND e.type IN ('employed', 'connection', 'mentions', 'owns', 'seat', 'comment', 'election', 'tagged')
    UNION
    SELECT e.target FROM public.edges e WHERE NOT e.deleted AND e.source = ANY(changed) AND e.target IS NOT NULL
      AND e.type IN ('employed', 'connection', 'mentions', 'owns', 'seat', 'comment', 'election', 'tagged')
  ), up(id) AS (
    SELECT id FROM seed
    UNION
    SELECT pre.id FROM up CROSS JOIN LATERAL (
      SELECT e.source AS id FROM public.edges e
      WHERE NOT e.deleted AND e.target = up.id AND e.type IN ('employed', 'connection', 'owns') AND e.source IS NOT NULL
      UNION ALL
      SELECT e.target FROM public.edges e
      WHERE NOT e.deleted AND e.source = up.id AND e.type IN ('connection', 'mentions') AND e.target IS NOT NULL
    ) pre
  )
  SELECT up.id FROM up JOIN public.nodes n ON n.id = up.id
$$;
