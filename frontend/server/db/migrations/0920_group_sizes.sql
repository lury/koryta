-- The nightly count of `stats.nodeGroupSize` moves to the application,
-- server/db/groupSizes.ts (decision on 2026-11-27); node_group_sizes()
-- and its view stay only as the oracle of the tests
-- (tests/server/db/groupSizesOracle.ts). A write keeps the sizes it moves
-- current here in SQL, as before.

DROP FUNCTION node_group_sizes(text[]);
DROP VIEW group_links;

-- The incremental writes and the nightly count share an advisory lock on
-- hashtext('node_derived.node_group_size'): a write holds it shared until it
-- commits, the count holds it alone while it takes a number of
-- `node_group_gen` and while it writes. A write stamps the rows it moves with
-- a later number, and the count leaves those rows to it.
ALTER TABLE node_derived ADD COLUMN group_gen bigint;
CREATE SEQUENCE node_group_gen;

CREATE OR REPLACE FUNCTION write_node_group_sizes(roots text[]) RETURNS bigint
LANGUAGE plpgsql SET plan_cache_mode = force_custom_plan AS $$
DECLARE changed bigint; gen bigint;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtext('node_derived.node_group_size'));
  gen := nextval('public.node_group_gen');
  INSERT INTO public.node_derived AS d (id, node_group_size, group_gen)
  SELECT n.id, coalesce(g.size, 0), gen
  FROM public.nodes n LEFT JOIN public.node_group_sizes_near(roots) g ON g.id = n.id
  WHERE n.id = ANY(roots)
  ON CONFLICT (id) DO UPDATE SET node_group_size = excluded.node_group_size, group_gen = excluded.group_gen
  WHERE d.node_group_size IS DISTINCT FROM excluded.node_group_size;
  GET DIAGNOSTICS changed = ROW_COUNT;
  DELETE FROM public.node_derived d WHERE d.id = ANY(roots)
    AND NOT EXISTS (SELECT 1 FROM public.nodes n WHERE n.id = d.id);
  RETURN changed;
END $$;

-- Every node's row and its search line; the sizes are groupSizes.ts'. A new
-- node's row starts at size 0 until the count, or a write, sets it.
CREATE OR REPLACE FUNCTION refresh_node_derived(at timestamptz DEFAULT now()) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE gone bigint; changed bigint;
BEGIN
  CREATE TEMP TABLE fresh ON COMMIT DROP AS
  SELECT n.id, l.line AS search_line
  FROM public.nodes n LEFT JOIN public.search_lines(at) l ON l.id = n.id;
  DELETE FROM public.node_derived d WHERE NOT EXISTS (SELECT 1 FROM fresh f WHERE f.id = d.id);
  GET DIAGNOSTICS gone = ROW_COUNT;
  INSERT INTO public.node_derived AS d (id, node_group_size, search_line)
  SELECT f.id, 0, f.search_line FROM fresh f
  ON CONFLICT (id) DO UPDATE SET search_line = excluded.search_line
  WHERE d.search_line IS DISTINCT FROM excluded.search_line;
  GET DIAGNOSTICS changed = ROW_COUNT;
  DROP TABLE fresh;
  RETURN gone + changed;
END $$;

-- JIT compiles the recursive walks of a write for longer than they run:
-- 1.1 s against 0.3 s per write at x10.
ALTER FUNCTION node_group_sizes_near(text[]) SET jit = off;
ALTER FUNCTION node_group_affected(text[], text[]) SET jit = off;
