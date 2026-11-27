-- refresh_node_stats() reads each table it has just rewritten in the next
-- step: node_target_rows() joins place_ancestors, node_stats_rows() reads
-- node_target. Planned with the statistics of before the rewrite, the first
-- fill of the x50 seed joined 18 million ties to an "empty" place_ancestors
-- by nested loop and ran past 30 minutes; with the tables analysed between
-- the steps node_target fills in 4.4 minutes. The analyses cost 0.1 and
-- 0.5 s there.
--
-- refresh_node_stats_for() recounted every region the written nodes are
-- tied to, whatever the write: on x50 a vote on one person took 4.5 s, the
-- `people` of the powiaty around them counted again. It now recounts the
-- regions whose ties to these nodes changed, and all of a node's regions
-- when its publication or type did.

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
  ANALYZE public.place_ancestors;

  CREATE TEMP TABLE fresh_target ON COMMIT DROP AS SELECT * FROM public.node_target_rows();
  DELETE FROM public.node_target o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_target f WHERE f.target_id = o.target_id AND f.node_id = o.node_id
      AND (f.in_approved, f.cur_all, f.cur_approved) = (o.in_approved, o.cur_all, o.cur_approved));
  INSERT INTO public.node_target SELECT f.* FROM fresh_target f WHERE NOT EXISTS (
    SELECT 1 FROM public.node_target o WHERE f.target_id = o.target_id AND f.node_id = o.node_id);
  DROP TABLE fresh_target;
  ANALYZE public.node_target;

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

CREATE OR REPLACE FUNCTION refresh_node_stats_for(ids text[], wide text[] DEFAULT '{}') RETURNS bigint
LANGUAGE plpgsql SET plan_cache_mode = force_custom_plan AS $$
DECLARE places text[]; nodes text[]; regions text[]; republished text[];
  old_ties public.node_target[]; n bigint;
BEGIN
  IF cardinality(wide) > 0 THEN
    places := ARRAY(SELECT unnest(wide) UNION
                    SELECT a.place_id FROM public.place_ancestors a WHERE a.ancestor_id = ANY(wide));
    DELETE FROM public.place_ancestors a WHERE a.place_id = ANY(places);
    INSERT INTO public.place_ancestors SELECT * FROM public.place_ancestor_rows(places);
    nodes := ARRAY(SELECT unnest(ids) UNION SELECT unnest(places) UNION
                   SELECT e.source FROM public.edges e WHERE e.target = ANY(places) AND e.source IS NOT NULL);
  ELSE
    nodes := ids;
  END IF;
  IF cardinality(nodes) = 0 THEN RETURN 0; END IF;

  -- A region's `people` moves with the ties of these nodes that changed,
  -- and with every tie of one whose publication or type changed (node_stats
  -- still holds what they were); a vote moves none.
  old_ties := ARRAY(SELECT t FROM public.node_target t WHERE t.node_id = ANY(nodes));
  republished := ARRAY(
    SELECT n.id FROM public.nodes n LEFT JOIN public.node_stats s ON s.id = n.id
    WHERE n.id = ANY(nodes)
      AND (s.id IS NULL OR (s.is_approved, s.type) IS DISTINCT FROM (n.is_approved, n.type))
    UNION
    SELECT s.id FROM public.node_stats s
    WHERE s.id = ANY(nodes) AND NOT EXISTS (SELECT 1 FROM public.nodes n WHERE n.id = s.id));
  DELETE FROM public.node_target t WHERE t.node_id = ANY(nodes);
  INSERT INTO public.node_target SELECT * FROM public.node_target_rows(nodes);
  regions := ARRAY(
    SELECT r.id FROM public.nodes r
    WHERE r.type = 'region' AND r.id IN (
      SELECT x.target_id FROM (
        (SELECT * FROM unnest(old_ties) EXCEPT
         SELECT * FROM public.node_target t WHERE t.node_id = ANY(nodes))
        UNION ALL
        (SELECT * FROM public.node_target t WHERE t.node_id = ANY(nodes) EXCEPT
         SELECT * FROM unnest(old_ties))) x
      UNION
      SELECT b.target_id FROM unnest(old_ties) b WHERE b.node_id = ANY(republished)
      UNION
      SELECT t.target_id FROM public.node_target t WHERE t.node_id = ANY(republished)));

  nodes := ARRAY(SELECT unnest(nodes) UNION SELECT unnest(regions));
  DELETE FROM public.node_stats s WHERE s.id = ANY(nodes);
  INSERT INTO public.node_stats SELECT * FROM public.node_stats_rows(nodes);
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM public.node_categories c WHERE c.node_id = ANY(nodes);
  INSERT INTO public.node_categories SELECT * FROM public.node_category_rows(nodes);

  PERFORM public.refresh_hospital_stats_for(ids);
  RETURN n;
END $$;
