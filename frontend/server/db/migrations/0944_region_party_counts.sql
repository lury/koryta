-- /api/stats/regions counted, for every powiat, the published people tied
-- to it by the party each is drawn in, over node_target, on every request:
-- 12.8 s at x50 (region_people_rows, 0602). The counts are now a table,
-- region_party_counts, kept with node_stats: node_areas carries each
-- person's party (`painted_party`), and a refresh recounts the powiaty the
-- refreshed nodes were or are tied to, from node_areas' index alone.

ALTER TABLE node_areas ADD COLUMN party text;
DROP INDEX node_areas_list;

CREATE OR REPLACE FUNCTION node_area_rows(ids text[] DEFAULT NULL)
RETURNS SETOF node_areas LANGUAGE sql STABLE PARALLEL SAFE AS $$
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
  ), who AS MATERIALIZED (
    -- Each node once: a person's party is worked out per person, not per
    -- area they reach.
    SELECT n.id, n.type, n.deleted, n.is_approved,
      coalesce(s.human_voted, false) AS human_voted,
      coalesce((s.stats ->> 'notesCount')::numeric, 0) > 0 AS noted,
      CASE WHEN n.type = 'person' THEN public.painted_party(n.data -> 'parties') END AS party
    FROM public.nodes n LEFT JOIN public.node_stats s ON s.id = n.id
    WHERE n.id IN (SELECT node_id FROM flags)
  )
  SELECT x.node_id, x.via, x.area, w.type, w.deleted, w.is_approved, w.human_voted, w.noted,
    x.in_approved, x.cur_all, x.cur_approved, w.party
  FROM flags x JOIN who w ON w.id = x.node_id
$$;

-- A powiat's published people by party, as region_people_rows counted them:
-- a published tie (in_approved), a published person, not the region itself.
CREATE TABLE region_party_counts (
  region_id text COLLATE "C" NOT NULL,
  party     text NOT NULL,
  n         bigint NOT NULL,
  PRIMARY KEY (region_id, party)
);

CREATE FUNCTION region_party_rows(ids text[] DEFAULT NULL)
RETURNS SETOF region_party_counts LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT a.area, a.party, count(*)
  FROM public.node_areas a
  JOIN public.nodes r ON r.id = a.area AND r.type = 'region'
    AND length(public.jsonb_text(r.data -> 'teryt')) = 4
  WHERE a.via = 'region' AND a.type = 'person' AND a.is_approved AND a.in_approved
    AND a.node_id <> a.area AND a.party IS NOT NULL
    AND (ids IS NULL OR a.area = ANY(ids))
  GROUP BY a.area, a.party
$$;

-- Refilled rather than updated: every person's party once, and the index
-- built after the rows.
TRUNCATE node_areas;
INSERT INTO node_areas SELECT * FROM node_area_rows();
CREATE INDEX node_areas_list ON node_areas (via, area, node_id)
  INCLUDE (type, deleted, is_approved, human_voted, noted, in_approved, cur_all, cur_approved, party);
ANALYZE node_areas;
INSERT INTO region_party_counts SELECT * FROM region_party_rows();

CREATE OR REPLACE VIEW region_people_rows AS
WITH region AS (
  SELECT n.id, public.jsonb_text(n.data -> 'teryt') AS teryt, n.data -> 'name' AS name,
    n.data -> 'teryt' AS teryt_raw, coalesce((s.stats ->> 'people')::numeric, 0) AS people
  FROM public.nodes n LEFT JOIN public.node_stats s ON s.id = n.id
  WHERE n.type = 'region'
)
SELECT r.id, jsonb_build_object('id', r.id, 'people', r.people)
  || CASE WHEN public.js_truthy(r.teryt_raw) THEN jsonb_build_object('teryt', r.teryt_raw) ELSE '{}' END
  || CASE WHEN public.js_truthy(r.name) THEN jsonb_build_object('name', r.name) ELSE '{}' END
  || CASE WHEN length(r.teryt) = 4 THEN jsonb_build_object('parties', coalesce(
       (SELECT jsonb_object_agg(c.party, c.n) FROM public.region_party_counts c WHERE c.region_id = r.id),
       '{}')) ELSE '{}' END AS row
FROM region r;

-- 0940's refreshes with the party counts.
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
          (o.type, o.deleted, o.is_approved, o.human_voted, o.noted, o.in_approved, o.cur_all, o.cur_approved)
      AND f.party IS NOT DISTINCT FROM o.party);
  INSERT INTO public.node_areas SELECT f.* FROM fresh_areas f ON CONFLICT DO NOTHING;
  DROP TABLE fresh_areas;
  ANALYZE public.node_areas;

  CREATE TEMP TABLE fresh_parties ON COMMIT DROP AS SELECT * FROM public.region_party_rows();
  DELETE FROM public.region_party_counts o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_parties f WHERE f.region_id = o.region_id AND f.party = o.party AND f.n = o.n);
  INSERT INTO public.region_party_counts SELECT f.* FROM fresh_parties f ON CONFLICT DO NOTHING;
  DROP TABLE fresh_parties;

  PERFORM public.refresh_hospital_stats();
  RETURN greatest(changed, n);
END $$;

CREATE OR REPLACE FUNCTION refresh_node_stats_for(ids text[], wide text[] DEFAULT '{}') RETURNS bigint
LANGUAGE plpgsql SET plan_cache_mode = force_custom_plan AS $$
DECLARE places text[]; nodes text[]; regions text[]; republished text[];
  old_ties public.node_target[]; powiaty text[]; n bigint;
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
  -- The powiaty these nodes were and are tied to: their party counts.
  powiaty := ARRAY(SELECT a.area FROM public.node_areas a
                   WHERE a.node_id = ANY(nodes) AND a.via = 'region' AND a.type = 'person');
  DELETE FROM public.node_areas a WHERE a.node_id = ANY(nodes);
  INSERT INTO public.node_areas SELECT * FROM public.node_area_rows(nodes);
  powiaty := ARRAY(SELECT unnest(powiaty) UNION
                   SELECT a.area FROM public.node_areas a
                   WHERE a.node_id = ANY(nodes) AND a.via = 'region' AND a.type = 'person');
  DELETE FROM public.region_party_counts c WHERE c.region_id = ANY(powiaty);
  INSERT INTO public.region_party_counts SELECT * FROM public.region_party_rows(powiaty);

  PERFORM public.refresh_hospital_stats_for(ids);
  RETURN n;
END $$;
