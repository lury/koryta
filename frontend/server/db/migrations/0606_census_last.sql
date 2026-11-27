-- The census of /api/stats/database counts what the whole nightly recount
-- leaves (`revisions.has_unapproved` among it, which refresh_node_revisions
-- writes after refresh_node_stats), so it is taken last, by
-- refresh_database_counts() at the end of recountBatch (server/db/batch.ts),
-- not inside refresh_node_stats() as 0604 had it: there it counted no
-- unapproved revisions on a freshly loaded seed.

CREATE FUNCTION refresh_database_counts() RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.database_counts (counts, at) VALUES (public.database_count_rows(), now())
  ON CONFLICT (id) DO UPDATE SET counts = excluded.counts, at = excluded.at
$$;

CREATE OR REPLACE FUNCTION refresh_node_stats() RETURNS bigint
LANGUAGE plpgsql SET work_mem = '256MB' SET enable_mergejoin = off AS $$
DECLARE changed bigint; n bigint;
BEGIN
  CREATE TEMP TABLE fresh_ancestors ON COMMIT DROP AS SELECT * FROM public.place_ancestor_rows();
  DELETE FROM public.place_ancestors o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_ancestors f WHERE f.place_id = o.place_id AND f.ancestor_id = o.ancestor_id);
  INSERT INTO public.place_ancestors SELECT f.* FROM fresh_ancestors f WHERE NOT EXISTS (
    SELECT 1 FROM public.place_ancestors o WHERE f.place_id = o.place_id AND f.ancestor_id = o.ancestor_id);
  DROP TABLE fresh_ancestors;

  CREATE TEMP TABLE fresh_target ON COMMIT DROP AS SELECT * FROM public.node_target_rows();
  DELETE FROM public.node_target o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_target f WHERE f.target_id = o.target_id AND f.node_id = o.node_id
      AND (f.in_approved, f.cur_all, f.cur_approved) = (o.in_approved, o.cur_all, o.cur_approved));
  INSERT INTO public.node_target SELECT f.* FROM fresh_target f WHERE NOT EXISTS (
    SELECT 1 FROM public.node_target o WHERE f.target_id = o.target_id AND f.node_id = o.node_id);
  DROP TABLE fresh_target;

  CREATE TEMP TABLE fresh_stats ON COMMIT DROP AS SELECT * FROM public.node_stats_rows();
  DELETE FROM public.node_stats o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_stats f WHERE f.id = o.id AND f.stats = o.stats
      AND (f.type, f.is_approved, f.latest_all, f.latest_approved, f.current_all, f.current_approved,
           f.experience_all, f.experience_approved, f.elections_all, f.elections_approved,
           f.human_voted, f.interesting)
      IS NOT DISTINCT FROM
          (o.type, o.is_approved, o.latest_all, o.latest_approved, o.current_all, o.current_approved,
           o.experience_all, o.experience_approved, o.elections_all, o.elections_approved,
           o.human_voted, o.interesting));
  GET DIAGNOSTICS changed = ROW_COUNT;
  INSERT INTO public.node_stats SELECT f.* FROM fresh_stats f WHERE NOT EXISTS (
    SELECT 1 FROM public.node_stats o WHERE o.id = f.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  DROP TABLE fresh_stats;

  CREATE TEMP TABLE fresh_categories ON COMMIT DROP AS SELECT * FROM public.node_category_rows();
  DELETE FROM public.node_categories o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_categories f WHERE f.node_id = o.node_id AND f.category = o.category
      AND (f.type, f.deleted, f.is_approved, f.human_voted, f.noted, f.latest_all, f.latest_approved,
           f.in_approved, f.cur_all, f.cur_approved)
      IS NOT DISTINCT FROM
          (o.type, o.deleted, o.is_approved, o.human_voted, o.noted, o.latest_all, o.latest_approved,
           o.in_approved, o.cur_all, o.cur_approved));
  INSERT INTO public.node_categories SELECT f.* FROM fresh_categories f WHERE NOT EXISTS (
    SELECT 1 FROM public.node_categories o WHERE o.node_id = f.node_id AND o.category = f.category);
  DROP TABLE fresh_categories;

  PERFORM public.refresh_hospital_stats();
  RETURN greatest(changed, n);
END $$;

SELECT refresh_database_counts();
