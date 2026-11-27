-- What the pages read at x50 (local_artifacts 2026-11-26, postgres-full
-- §8), kept so that a page is answered from an index rather than by
-- expanding a sector into the list of its places, counting whole tables or
-- sorting all of node_stats:
--
-- - node_categories: a node and each sector it is tied to, with the flags
--   the queue, the table and their counters filter on, kept with node_stats;
-- - database_counts: the census of /api/stats/database, written by the
--   nightly refresh_node_stats();
-- - edges_live_published_employments: homeTimeline's scan as its index;
-- - node_stats_experience_approved: the longest tenures on the home page.

-- `categories ? x` as a set: the strings of an array, the keys of an
-- object, a string itself.
CREATE FUNCTION place_categories(categories jsonb) RETURNS SETOF text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT a #>> '{}' FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(categories) = 'array' THEN categories ELSE '[]' END) a
  WHERE jsonb_typeof(a) = 'string'
  UNION
  SELECT k FROM jsonb_object_keys(
      CASE WHEN jsonb_typeof(categories) = 'object' THEN categories ELSE '{}' END) k
  UNION
  SELECT categories #>> '{}' WHERE jsonb_typeof(categories) = 'string'
$$;

-- A node and each category of a live place it points at (node_target), as
-- the `category` filter reads it: tied at all, through a published tie,
-- through a current one. The node's own fields beside, so that the queue
-- and its counters do not leave the index.
CREATE TABLE node_categories (
  node_id         text COLLATE "C" NOT NULL,
  category        text COLLATE "C" NOT NULL,
  type            text,
  deleted         boolean NOT NULL,
  is_approved     boolean NOT NULL,
  human_voted     boolean NOT NULL,
  noted           boolean NOT NULL,
  latest_all      text COLLATE "C",
  latest_approved text COLLATE "C",
  in_approved     boolean NOT NULL,
  cur_all         boolean NOT NULL,
  cur_approved    boolean NOT NULL,
  PRIMARY KEY (node_id, category)
);
-- The table and the counters: a sector's people in id order.
CREATE INDEX node_categories_list ON node_categories (category, node_id)
  INCLUDE (type, deleted, is_approved, human_voted, noted, in_approved, cur_all, cur_approved);
-- The queue of /eksploruj/nowe: the unchecked people currently at a
-- sector's places, newest post first.
CREATE INDEX node_categories_queue ON node_categories
  (category, latest_all DESC NULLS LAST, node_id DESC)
  WHERE type = 'person' AND NOT deleted AND cur_all AND NOT is_approved AND NOT human_voted;

CREATE FUNCTION node_category_rows(ids text[] DEFAULT NULL)
RETURNS SETOF node_categories LANGUAGE sql STABLE AS $$
  WITH tied AS (
    SELECT t.node_id, c.category, bool_or(t.in_approved) AS in_approved,
      bool_or(t.cur_all) AS cur_all, bool_or(t.cur_approved) AS cur_approved
    FROM public.node_target t
    JOIN public.nodes p ON p.id = t.target_id AND p.type = 'place' AND NOT p.deleted
    CROSS JOIN LATERAL public.place_categories(p.data -> 'categories') c(category)
    WHERE ids IS NULL OR t.node_id = ANY(ids)
    GROUP BY t.node_id, c.category
  )
  SELECT x.node_id, x.category, n.type, n.deleted, n.is_approved,
    coalesce(s.human_voted, false),
    coalesce((s.stats ->> 'notesCount')::numeric, 0) > 0,
    s.latest_all, s.latest_approved, x.in_approved, x.cur_all, x.cur_approved
  FROM tied x JOIN public.nodes n ON n.id = x.node_id
  LEFT JOIN public.node_stats s ON s.id = x.node_id
$$;

-- /api/stats/database by the rules of server/utils/databaseStats.ts, the
-- shape of `DatabaseCounts` (server/db/stats.ts).
CREATE FUNCTION database_count_rows() RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH p AS MATERIALIZED (
    SELECT s.is_approved AS approved, s.human_voted AS voted,
      coalesce((s.stats ->> 'notesCount')::numeric, 0) > 0 AS noted,
      s.experience_all > 0 AS public_job, s.current_all AS current, s.interesting AS score
    FROM public.node_stats s WHERE s.type = 'person'
  ), people AS (
    SELECT jsonb_build_object(
      'total', count(*),
      'approved', count(*) FILTER (WHERE approved),
      'reviewed', count(*) FILTER (WHERE NOT approved AND (voted OR noted)),
      'toCheck', count(*) FILTER (WHERE NOT approved AND NOT voted AND NOT noted),
      'withVotes', count(*) FILTER (WHERE voted),
      'withNotes', count(*) FILTER (WHERE noted),
      'withPublicEmployment', count(*) FILTER (WHERE public_job),
      'currentlyEmployed', count(*) FILTER (WHERE current)) AS doc
    FROM p
  ), candidates AS (
    SELECT jsonb_agg(jsonb_build_object('floor', f, 'open', f = 5,
        'approved', coalesce(c.approved, 0), 'pending', coalesce(c.pending, 0)) ORDER BY f) AS doc
    FROM generate_series(1, 5) f
    LEFT JOIN (SELECT least(trunc(score), 5)::int AS floor,
        count(*) FILTER (WHERE approved) AS approved, count(*) FILTER (WHERE NOT approved) AS pending
      FROM p WHERE score >= 1 GROUP BY 1) c ON c.floor = f
  ), places AS (
    SELECT jsonb_build_object(
      'total', count(*),
      'publicSector', count(*) FILTER (WHERE data -> 'isPublic' = 'true'),
      'confirmedPrivate', count(*) FILTER (WHERE data -> 'isPublic' IS DISTINCT FROM 'true'
        AND data -> 'isPublicSource' = '"manual"'),
      'unknown', count(*) FILTER (WHERE data -> 'isPublic' IS DISTINCT FROM 'true'
        AND data -> 'isPublicSource' IS DISTINCT FROM '"manual"')) AS doc
    FROM public.nodes WHERE type = 'place'
  ), entries AS (
    SELECT coalesce(public.jsonb_text(x -> 'kind'), 'source') AS kind,
      public.jsonb_text(x -> 'adminStatus') AS status
    FROM public.notes, jsonb_array_elements(CASE WHEN jsonb_typeof(data -> 'sources') = 'array'
      THEN data -> 'sources' ELSE '[]' END) x
  ), notes AS (
    SELECT jsonb_build_object(
      'notes', (SELECT count(*) FROM public.notes),
      'annotatedNodes', (SELECT count(DISTINCT node_id) FROM public.notes WHERE node_id <> ''),
      'sources', count(*),
      'byKind', jsonb_build_object(
        'source', count(*) FILTER (WHERE kind = 'source'),
        'change_request', count(*) FILTER (WHERE kind = 'change_request'),
        'missing', count(*) FILTER (WHERE kind = 'missing')),
      'unresolved', count(*) FILTER (WHERE status = 'unresolved'),
      'resolved', count(*) FILTER (WHERE status = 'resolved'),
      'untriaged', count(*) FILTER (WHERE status IS DISTINCT FROM 'unresolved'
        AND status IS DISTINCT FROM 'resolved')) AS doc
    FROM entries
  ), human_votes AS MATERIALIZED (
    SELECT * FROM public.votes WHERE strpos(coalesce(user_uid, ''), 'pipeline') = 0
  ), steps AS (
    SELECT c.key AS category, greatest(-5, least(5, trunc((c.value #>> '{}')::numeric)))::int AS step,
      count(*) AS n
    FROM human_votes v, jsonb_each(CASE WHEN jsonb_typeof(v.data -> 'categoryVotes') = 'object'
      THEN v.data -> 'categoryVotes' ELSE '{}' END) c
    WHERE c.key IN ('interesting', 'quality') AND jsonb_typeof(c.value) = 'number'
    GROUP BY 1, 2
  ), votes AS (
    SELECT jsonb_build_object(
      'total', count(*),
      'onNodes', count(*) FILTER (WHERE coalesce(extraction_id, '') = ''),
      'onExtractions', count(*) FILTER (WHERE coalesce(extraction_id, '') <> ''),
      'voters', count(DISTINCT user_uid),
      'withComment', count(*) FILTER (WHERE coalesce(public.jsonb_text(data -> 'comment'), '') <> ''),
      'distribution', (SELECT jsonb_object_agg(k.category, (
          SELECT jsonb_object_agg(st::text, coalesce((SELECT n FROM steps x
            WHERE x.category = k.category AND x.step = st), 0))
          FROM unnest(ARRAY[-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]) st))
        FROM (VALUES ('interesting'), ('quality')) k(category))) AS doc
    FROM human_votes
  )
  SELECT jsonb_build_object(
    'people', (SELECT doc FROM people),
    'publicationCandidates', (SELECT doc FROM candidates),
    'places', (SELECT doc FROM places),
    'articles', (SELECT count(*) FROM public.nodes WHERE type = 'article'),
    'regions', (SELECT count(*) FROM public.nodes WHERE type = 'region'),
    'edges', (SELECT count(*) FROM public.edges),
    'notes', (SELECT doc FROM notes),
    'revisions', jsonb_build_object(
      'total', (SELECT count(*) FROM public.revisions),
      'unapprovedNodes', (SELECT count(*) FROM public.nodes
        WHERE data #> '{revisions,has_unapproved}' = 'true')),
    'votes', (SELECT doc FROM votes),
    'extractions', jsonb_build_object(
      'total', (SELECT count(*) FROM public.extractions),
      'reviewed', (SELECT count(*) FROM public.extractions
        WHERE data #> '{stats,votes,humanVoted}' = 'true')),
    'comments', (SELECT count(*) FROM public.comments))
$$;

-- The census as of the last full refresh: one row.
CREATE TABLE database_counts (
  id     boolean PRIMARY KEY DEFAULT true CHECK (id),
  counts jsonb NOT NULL,
  at     timestamptz NOT NULL
);

-- homeTimeline's and serviceMilestones' scan (readPublishedEmployments):
-- its WHERE as the predicate and its ORDER BY as the key, so that the plan
-- reads the first rows of the index instead of sorting every published
-- employment (6 s at x50, rows misestimated at 183 of 1.2 million).
CREATE INDEX edges_live_published_employments ON edges
  ((jsonb_text(data -> 'start_date')) COLLATE "C" DESC, id DESC)
  WHERE type = 'employed' AND data -> 'published' = 'true'::jsonb
    AND jsonb_text(data -> 'start_date') IS NOT NULL
    AND NOT deleted AND coalesce(source, '') <> '' AND coalesce(target, '') <> '';

-- The longest published tenures (/api/nodes?sortBy=experience, anonymous).
CREATE INDEX node_stats_experience_approved ON node_stats
  (experience_approved DESC NULLS LAST, id DESC NULLS LAST)
  WHERE is_approved AND type = 'person';

-- node_stats' refreshes, now with node_categories and the census: 0603's
-- bodies and two more steps.
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
  INSERT INTO public.database_counts (counts, at) VALUES (public.database_count_rows(), now())
  ON CONFLICT (id) DO UPDATE SET counts = excluded.counts, at = excluded.at;
  RETURN greatest(changed, n);
END $$;

CREATE OR REPLACE FUNCTION refresh_node_stats_for(ids text[], wide text[] DEFAULT '{}') RETURNS bigint
LANGUAGE plpgsql SET plan_cache_mode = force_custom_plan AS $$
DECLARE places text[]; nodes text[]; regions text[]; n bigint;
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

  regions := ARRAY(SELECT t.target_id FROM public.node_target t WHERE t.node_id = ANY(nodes));
  DELETE FROM public.node_target t WHERE t.node_id = ANY(nodes);
  INSERT INTO public.node_target SELECT * FROM public.node_target_rows(nodes);
  regions := ARRAY(
    SELECT r.id FROM public.nodes r
    WHERE r.type = 'region' AND (r.id = ANY(regions) OR r.id = ANY(
      ARRAY(SELECT t.target_id FROM public.node_target t WHERE t.node_id = ANY(nodes)))));

  nodes := ARRAY(SELECT unnest(nodes) UNION SELECT unnest(regions));
  DELETE FROM public.node_stats s WHERE s.id = ANY(nodes);
  INSERT INTO public.node_stats SELECT * FROM public.node_stats_rows(nodes);
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM public.node_categories c WHERE c.node_id = ANY(nodes);
  INSERT INTO public.node_categories SELECT * FROM public.node_category_rows(nodes);

  PERFORM public.refresh_hospital_stats_for(ids);
  RETURN n;
END $$;

INSERT INTO node_categories SELECT * FROM node_category_rows();
INSERT INTO database_counts (counts, at) VALUES (database_count_rows(), now());
