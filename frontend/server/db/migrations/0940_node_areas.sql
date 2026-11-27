-- The region filters of /api/nodes and /api/stats/progress from a table
-- kept with node_stats, as node_categories keeps the sector (0604):
--
-- - `teryt`: a node tied to the region (node_target), or to any live region
--   of a województwo;
-- - `companyTeryt`: a node tied to a place that a region has a `seat` (or,
--   while the migration to seats runs, `owns`) edge to.
--
-- Both expanded the filter into a list of ids, a województwo's 300-odd
-- regions or every company seated in them, and probed node_target with the
-- list for each node: at x50 `teryt=14` took 0.7 s for a page and 1.7 s for
-- its count.
--
-- `area` is the region's id, or `woj:` and the two digits for a
-- województwo; `via` says which filter the row answers. The flags are the
-- tie's, or'ed over every target that brings the node in, and the node's
-- own fields ride along so that a count does not leave the index.

CREATE TABLE node_areas (
  node_id      text COLLATE "C" NOT NULL,
  via          text COLLATE "C" NOT NULL CHECK (via IN ('region', 'seat')),
  area         text COLLATE "C" NOT NULL,
  type         text,
  deleted      boolean NOT NULL,
  is_approved  boolean NOT NULL,
  human_voted  boolean NOT NULL,
  noted        boolean NOT NULL,
  in_approved  boolean NOT NULL,
  cur_all      boolean NOT NULL,
  cur_approved boolean NOT NULL,
  PRIMARY KEY (node_id, via, area)
);
CREATE INDEX node_areas_list ON node_areas (via, area, node_id)
  INCLUDE (type, deleted, is_approved, human_voted, noted, in_approved, cur_all, cur_approved);

CREATE FUNCTION node_area_rows(ids text[] DEFAULT NULL)
RETURNS SETOF node_areas LANGUAGE sql STABLE AS $$
  WITH tied AS (
    SELECT t.node_id, 'region' AS via, r.id AS region_id, r.data ->> 'teryt' AS teryt, r.deleted,
      t.in_approved, t.cur_all, t.cur_approved
    FROM public.node_target t JOIN public.nodes r ON r.id = t.target_id AND r.type = 'region'
    WHERE ids IS NULL OR t.node_id = ANY(ids)
    UNION ALL
    SELECT t.node_id, 'seat', r.id, r.data ->> 'teryt', r.deleted,
      t.in_approved, t.cur_all, t.cur_approved
    FROM public.node_target t
    JOIN public.edges e ON e.target = t.target_id AND e.type IN ('seat', 'owns') AND NOT e.deleted
    JOIN public.nodes r ON r.id = e.source AND r.type = 'region'
    WHERE (ids IS NULL OR t.node_id = ANY(ids)) AND e.target <> ''
      AND NOT EXISTS (SELECT 1 FROM public.nodes x
        WHERE x.id = e.target AND x.type = 'region' AND NOT x.deleted)
  ), areas AS (
    SELECT node_id, via, region_id AS area, in_approved, cur_all, cur_approved FROM tied
    UNION ALL
    SELECT node_id, via, 'woj:' || left(teryt, 2), in_approved, cur_all, cur_approved
    FROM tied WHERE NOT deleted AND teryt ~ '^\d{2,}$'
  ), flags AS (
    SELECT node_id, via, area, bool_or(in_approved) AS in_approved,
      bool_or(cur_all) AS cur_all, bool_or(cur_approved) AS cur_approved
    FROM areas GROUP BY node_id, via, area
  )
  SELECT x.node_id, x.via, x.area, n.type, n.deleted, n.is_approved,
    coalesce(s.human_voted, false),
    coalesce((s.stats ->> 'notesCount')::numeric, 0) > 0,
    x.in_approved, x.cur_all, x.cur_approved
  FROM flags x JOIN public.nodes n ON n.id = x.node_id
  LEFT JOIN public.node_stats s ON s.id = x.node_id
$$;

INSERT INTO node_areas SELECT * FROM node_area_rows();
ANALYZE node_areas;

-- 0607's refreshes with node_areas beside node_categories. The full one
-- also inserts what is new with ON CONFLICT DO NOTHING (the primary keys
-- are the columns the NOT EXISTS compared) and analyses each table it
-- reads next. Into a table analysed empty, a freshly loaded seed's, the
-- NOT EXISTS was planned as a nested loop over a sequential scan of the
-- table being filled, so every row rescanned the rows inserted before it:
-- place_ancestors took 110 s and node_target did not finish in 15 minutes
-- at x10.
CREATE OR REPLACE FUNCTION refresh_node_stats() RETURNS bigint
LANGUAGE plpgsql SET work_mem = '256MB' SET enable_mergejoin = off AS $$
DECLARE changed bigint; n bigint;
BEGIN
  CREATE TEMP TABLE fresh_ancestors ON COMMIT DROP AS SELECT * FROM public.place_ancestor_rows();
  ANALYZE fresh_ancestors;
  DELETE FROM public.place_ancestors o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_ancestors f WHERE f.place_id = o.place_id AND f.ancestor_id = o.ancestor_id);
  INSERT INTO public.place_ancestors SELECT f.* FROM fresh_ancestors f ON CONFLICT DO NOTHING;
  DROP TABLE fresh_ancestors;
  ANALYZE public.place_ancestors;

  CREATE TEMP TABLE fresh_target ON COMMIT DROP AS SELECT * FROM public.node_target_rows();
  ANALYZE fresh_target;
  DELETE FROM public.node_target o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_target f WHERE f.target_id = o.target_id AND f.node_id = o.node_id
      AND (f.in_approved, f.cur_all, f.cur_approved) = (o.in_approved, o.cur_all, o.cur_approved));
  INSERT INTO public.node_target SELECT f.* FROM fresh_target f ON CONFLICT DO NOTHING;
  DROP TABLE fresh_target;
  ANALYZE public.node_target;

  CREATE TEMP TABLE fresh_stats ON COMMIT DROP AS SELECT * FROM public.node_stats_rows();
  ANALYZE fresh_stats;
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
  INSERT INTO public.node_stats SELECT f.* FROM fresh_stats f ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  DROP TABLE fresh_stats;
  ANALYZE public.node_stats;

  CREATE TEMP TABLE fresh_categories ON COMMIT DROP AS SELECT * FROM public.node_category_rows();
  ANALYZE fresh_categories;
  DELETE FROM public.node_categories o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_categories f WHERE f.node_id = o.node_id AND f.category = o.category
      AND (f.type, f.deleted, f.is_approved, f.human_voted, f.noted, f.latest_all, f.latest_approved,
           f.in_approved, f.cur_all, f.cur_approved)
      IS NOT DISTINCT FROM
          (o.type, o.deleted, o.is_approved, o.human_voted, o.noted, o.latest_all, o.latest_approved,
           o.in_approved, o.cur_all, o.cur_approved));
  INSERT INTO public.node_categories SELECT f.* FROM fresh_categories f ON CONFLICT DO NOTHING;
  DROP TABLE fresh_categories;
  ANALYZE public.node_categories;

  CREATE TEMP TABLE fresh_areas ON COMMIT DROP AS SELECT * FROM public.node_area_rows();
  ANALYZE fresh_areas;
  DELETE FROM public.node_areas o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_areas f WHERE f.node_id = o.node_id AND f.via = o.via AND f.area = o.area
      AND (f.type, f.deleted, f.is_approved, f.human_voted, f.noted, f.in_approved, f.cur_all, f.cur_approved)
      IS NOT DISTINCT FROM
          (o.type, o.deleted, o.is_approved, o.human_voted, o.noted, o.in_approved, o.cur_all, o.cur_approved));
  INSERT INTO public.node_areas SELECT f.* FROM fresh_areas f ON CONFLICT DO NOTHING;
  DROP TABLE fresh_areas;
  ANALYZE public.node_areas;

  PERFORM public.refresh_hospital_stats();
  RETURN greatest(changed, n);
END $$;

CREATE OR REPLACE FUNCTION refresh_node_stats_for(ids text[], wide text[] DEFAULT '{}') RETURNS bigint
LANGUAGE plpgsql SET plan_cache_mode = force_custom_plan AS $$
DECLARE places text[]; nodes text[]; regions text[]; republished text[];
  old_ties public.node_target[]; n bigint;
BEGIN
  IF cardinality(wide) > 0 THEN
    -- The places below, and those owned by a place below: a company owned by
    -- one seated in a region that moves has no ancestor in it, yet node_areas
    -- reaches the region through its owner's seat.
    places := ARRAY(SELECT unnest(wide) UNION
                    SELECT a.place_id FROM public.place_ancestors a WHERE a.ancestor_id = ANY(wide) UNION
                    SELECT b.place_id FROM public.place_ancestors a
                    JOIN public.place_ancestors b ON b.ancestor_id = a.place_id
                    WHERE a.ancestor_id = ANY(wide));
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
  DELETE FROM public.node_areas a WHERE a.node_id = ANY(nodes);
  INSERT INTO public.node_areas SELECT * FROM public.node_area_rows(nodes);

  PERFORM public.refresh_hospital_stats_for(ids);
  RETURN n;
END $$;
