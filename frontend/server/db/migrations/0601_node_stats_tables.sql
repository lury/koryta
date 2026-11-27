-- The views of 0002_node_stats.sql as tables, written by functions: the
-- whole of them at night (`refresh_node_stats`), and in a write's own
-- transaction the rows of the nodes the write touched
-- (`refresh_node_stats_for`, server/db/writeEffects.ts). Same rules, same
-- columns; what changes is that a write no longer waits for, nor pays for,
-- a refresh of every node.
--
-- REFRESH MATERIALIZED VIEW CONCURRENTLY recomputed all three and then
-- compared every row of the old against the new: 145 s on the x10 seed, as
-- many as there were writes in five seconds. Its cost was mostly three
-- things, each fixed below: the view of every edge from both its ends
-- built three times with whole edge documents in it; `js_date` parsed per post, 3.4 million
-- times, for some thirty thousand distinct strings; and the place flags read
-- out of each place's document once per edge.

DROP MATERIALIZED VIEW node_stats;
DROP MATERIALIZED VIEW node_target;
DROP VIEW node_edges;
DROP MATERIALIZED VIEW place_ancestors;
DROP FUNCTION refresh_node_stats();

-- The edge indexes without their `NOT deleted`: queue_tiers, the walk of
-- nodeGroupSize and the search line's teaser read deleted edges too, and a
-- partial index serves only a query that repeats its predicate, so those
-- scanned every edge (9.4 million at x50). One index each way serves both.
DROP INDEX edges_source;
DROP INDEX edges_target;
CREATE INDEX edges_source ON edges (source, type) INCLUDE (target, deleted);
CREATE INDEX edges_target ON edges (target, type) INCLUDE (source, deleted);

-- What the employment counters ask of a place, out of its document.
ALTER TABLE nodes
  ADD COLUMN is_public boolean GENERATED ALWAYS AS (jsonb_is_true(data -> 'isPublic')) STORED,
  ADD COLUMN unpaid_board boolean GENERATED ALWAYS AS
    (jsonb_text(data -> 'supervisoryBody') IS NOT DISTINCT FROM 'rada-spoleczna') STORED;

-- The live edges with an end among `ids` (every live edge for null), once
-- each, with what the counters read of them parsed out of the document and
-- whether each is a post they count (`public_post`). What node_edges was,
-- less its second copy of every edge: the callers take both ends.
CREATE FUNCTION live_edges(ids text[] DEFAULT NULL)
RETURNS TABLE (id text, type text, source text, target text, is_approved boolean, public_post boolean,
  start_full text, end_raw jsonb, end_full text, office text, elected jsonb, by_election jsonb)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.type, e.source, e.target, e.is_approved,
    e.type = 'employed' AND coalesce(pl.is_public, false)
      AND NOT (coalesce(pl.unpaid_board, false) AND public.names_supervisory_seat(public.jsonb_text(e.data -> 'name'))),
    public.jsonb_text(e.data -> 'start_date'), e.data -> 'end_date', public.jsonb_text(e.data -> 'end_date'),
    public.jsonb_text(e.data -> 'position'), e.data -> 'elected', e.data -> 'by_election'
  FROM (
    -- One branch or the other: the planner drops the one whose test on
    -- `ids` is false, so a write's few edges come by index.
    SELECT e.* FROM public.edges e WHERE ids IS NULL
    UNION ALL
    SELECT e.* FROM public.edges e WHERE e.id IN (
      SELECT x.id FROM public.edges x WHERE x.source = ANY(ids)
      UNION SELECT x.id FROM public.edges x WHERE x.target = ANY(ids))
  ) e LEFT JOIN public.nodes pl ON pl.id = e.target
  WHERE NOT e.deleted AND e.source IS NOT NULL AND e.target IS NOT NULL
$$;

-- transitiveTargets (computeNodes.post.ts): for a place, the regions with an
-- `owns` or `seat` edge to it, and every company above it at any depth. The
-- regions of the companies above are not folded in.
CREATE TABLE place_ancestors (
  place_id    text COLLATE "C" NOT NULL,
  ancestor_id text COLLATE "C" NOT NULL,
  PRIMARY KEY (place_id, ancestor_id)
);
CREATE INDEX place_ancestors_ancestor ON place_ancestors (ancestor_id);

CREATE FUNCTION place_ancestor_rows(ids text[] DEFAULT NULL)
RETURNS TABLE (place_id text, ancestor_id text) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up(place_id, ancestor_id) AS (
    SELECT e.target, e.source
    FROM public.edges e JOIN public.nodes s ON s.id = e.source AND s.type = 'place'
    WHERE e.type IN ('owns', 'seat') AND NOT e.deleted AND e.target IS NOT NULL
      AND (ids IS NULL OR e.target = ANY(ids))
    UNION
    SELECT u.place_id, e.source FROM up u
    JOIN public.edges e ON e.target = u.ancestor_id AND e.type IN ('owns', 'seat') AND NOT e.deleted
    JOIN public.nodes s ON s.id = e.source AND s.type = 'place'
  )
  SELECT place_id, ancestor_id FROM up
  UNION
  SELECT e.target, e.source
  FROM public.edges e JOIN public.nodes s ON s.id = e.source AND s.type = 'region'
  WHERE e.type IN ('owns', 'seat') AND NOT e.deleted AND e.target IS NOT NULL
    AND (ids IS NULL OR e.target = ANY(ids))
$$;

-- stats.edges.{all,approved}.{targetNodeIds,currentlyEmployedTargetNodeIds}
-- as rows: what a node points at, through which kind of edge.
CREATE TABLE node_target (
  node_id      text COLLATE "C" NOT NULL,
  target_id    text COLLATE "C" NOT NULL,
  in_approved  boolean NOT NULL,
  cur_all      boolean NOT NULL,
  cur_approved boolean NOT NULL,
  PRIMARY KEY (target_id, node_id)
);
CREATE INDEX node_target_node ON node_target (node_id);

CREATE FUNCTION node_target_rows(ids text[] DEFAULT NULL)
RETURNS TABLE (node_id text, target_id text, in_approved boolean, cur_all boolean, cur_approved boolean)
LANGUAGE sql STABLE AS $$
  WITH live AS MATERIALIZED (
    SELECT * FROM public.live_edges(ids)
  ), ahead AS (
    -- isCurrentPost, each date parsed once.
    SELECT d, public.js_date(d) >= now() AS ahead
    FROM (SELECT DISTINCT end_full FROM live WHERE public_post AND end_full IS NOT NULL) x(d)
  ), edge_flags AS (
    SELECT l.source, l.target, l.is_approved AS approved,
      l.public_post AND (l.end_raw IS NULL OR l.end_raw IN ('null', 'false', '""', '0')
                         OR coalesce(a.ahead, false)) AS cur
    FROM live l LEFT JOIN ahead a ON a.d = l.end_full
  ), flagged AS (
    -- From both ends, as computeNodes hands a node its edges.
    SELECT f.source AS node_id, f.target, f.approved, f.cur FROM edge_flags f
    WHERE ids IS NULL OR f.source = ANY(ids)
    UNION ALL
    SELECT f.target, f.target, f.approved, f.cur FROM edge_flags f
    WHERE ids IS NULL OR f.target = ANY(ids)
  ), expanded AS (
    SELECT node_id, target AS target_id, approved, cur FROM flagged
    UNION ALL
    SELECT f.node_id, a.ancestor_id, f.approved, f.cur
    FROM flagged f JOIN public.place_ancestors a ON a.place_id = f.target
  )
  SELECT node_id, target_id, bool_or(approved), bool_or(cur), bool_or(cur AND approved)
  FROM expanded GROUP BY node_id, target_id
$$;

CREATE TABLE node_stats (
  id                  text COLLATE "C" PRIMARY KEY,
  type                text,
  is_approved         boolean,
  latest_all          text,
  latest_approved     text,
  current_all         boolean NOT NULL,
  current_approved    boolean NOT NULL,
  experience_all      float8 NOT NULL,
  experience_approved float8 NOT NULL,
  elections_all       text[] NOT NULL,
  elections_approved  text[] NOT NULL,
  human_voted         boolean NOT NULL,
  interesting         numeric NOT NULL,
  stats               jsonb NOT NULL
);
CREATE INDEX node_stats_latest ON node_stats (type, latest_approved DESC NULLS LAST, id);
CREATE INDEX node_stats_elections_all ON node_stats USING gin (elections_all);
CREATE INDEX node_stats_elections_approved ON node_stats USING gin (elections_approved);

-- The rows of node_stats for `ids`, or for every node, from the documents
-- and node_target (which must be current for them).
CREATE FUNCTION node_stats_rows(ids text[] DEFAULT NULL)
RETURNS SETOF node_stats LANGUAGE sql STABLE AS $$
WITH live AS MATERIALIZED (
  SELECT * FROM public.live_edges(ids) WHERE type IN ('employed', 'election', 'seat')
), edges_of AS (
  -- From both ends, as computeNodes hands a node its edges; the same edge twice for a
  -- loop, which no aggregate below counts twice.
  SELECT x.node_id, l.* FROM live l
  CROSS JOIN LATERAL (VALUES (l.source), (l.target)) AS x(node_id)
  WHERE ids IS NULL OR x.node_id = ANY(ids)
), post_edges AS MATERIALIZED (
  SELECT l.source, l.target, l.is_approved AS approved,
    nullif(split_part(l.start_full, 'T', 1), '') AS start_text,
    nullif(split_part(l.end_full, 'T', 1), '') AS end_text, l.end_raw, l.end_full
  FROM live l WHERE l.public_post
), posts AS (
  SELECT x.node_id, p.approved, p.start_text, p.end_text, p.end_raw, p.end_full
  FROM post_edges p CROSS JOIN LATERAL (VALUES (p.source), (p.target)) AS x(node_id)
  WHERE ids IS NULL OR x.node_id = ANY(ids)
), days AS (
  -- Each date parsed once, not once per post.
  SELECT d, public.js_date(d) AS at
  FROM (SELECT start_text FROM post_edges UNION SELECT end_text FROM post_edges
        UNION SELECT end_full FROM post_edges) x(d)
  WHERE d IS NOT NULL
), spans AS (
  SELECT p.node_id, p.approved, p.start_text,
    -- isCurrentPost: no end date, or one that has not passed.
    p.end_raw IS NULL OR p.end_raw IN ('null', 'false', '""', '0')
      OR coalesce(dc.at >= now(), false) AS current_post,
    CASE WHEN ds.at IS NOT NULL
          AND (p.end_text IS NULL OR de.at IS NOT NULL)
          AND ds.at <= coalesce(de.at, now())
         THEN tstzrange(ds.at, coalesce(de.at, now()), '[]')
    END AS span
  FROM posts p
  LEFT JOIN days ds ON ds.d = p.start_text
  LEFT JOIN days de ON de.d = p.end_text
  LEFT JOIN days dc ON dc.d = p.end_full
), employment AS (
  SELECT node_id,
    max(start_text COLLATE "C") AS latest_all,
    max(start_text COLLATE "C") FILTER (WHERE approved) AS latest_approved,
    bool_or(current_post) AS current_all,
    coalesce(bool_or(current_post) FILTER (WHERE approved), false) AS current_approved,
    range_agg(span) AS spans_all,
    range_agg(span) FILTER (WHERE approved) AS spans_approved
  FROM spans GROUP BY node_id
), experience AS (
  -- calculateExperience: merged spans, in years with one decimal, floored.
  SELECT node_id,
    coalesce((SELECT floor(sum(extract(epoch FROM upper(r) - lower(r)) * 1000)::float8
                / (1000 * 60 * 60 * 24 * 30.44) / 12 * 10) / 10
              FROM unnest(spans_all) r), 0) AS experience_all,
    coalesce((SELECT floor(sum(extract(epoch FROM upper(r) - lower(r)) * 1000)::float8
                / (1000 * 60 * 60 * 24 * 30.44) / 12 * 10) / 10
              FROM unnest(spans_approved) r), 0) AS experience_approved
  FROM employment
), runs AS (
  SELECT node_id, is_approved AS approved, public.jsonb_is_true(elected) AS won,
    -- Only a recorded loss is one; a run with no result is neither.
    coalesce(elected = 'false'::jsonb, false) AS lost,
    public.election_key(start_full, office, public.jsonb_is_true(by_election)) AS k
  FROM edges_of WHERE type = 'election' AND source = node_id
), per_election AS (
  SELECT node_id, k,
    bool_or(won) AS won_all, bool_and(lost) AS lost_all,
    bool_or(approved) AS any_approved,
    bool_or(won) FILTER (WHERE approved) AS won_approved,
    bool_and(lost) FILTER (WHERE approved) AS lost_approved
  FROM runs WHERE k IS NOT NULL GROUP BY node_id, k
), elections AS (
  -- candidacyElections: each election once, then its result where known.
  SELECT node_id,
    array_agg(x ORDER BY x COLLATE "C") FILTER (WHERE scope = 'all') AS elections_all,
    array_agg(x ORDER BY x COLLATE "C") FILTER (WHERE scope = 'approved') AS elections_approved
  FROM (
    SELECT node_id, 'all' AS scope, k AS x FROM per_election
    UNION ALL
    SELECT node_id, 'all', k || CASE WHEN won_all THEN ':won' ELSE ':lost' END
      FROM per_election WHERE won_all OR lost_all
    UNION ALL
    SELECT node_id, 'approved', k FROM per_election WHERE any_approved
    UNION ALL
    SELECT node_id, 'approved', k || CASE WHEN won_approved THEN ':won' ELSE ':lost' END
      FROM per_election WHERE any_approved AND (won_approved OR lost_approved)
  ) s GROUP BY node_id
), targets AS (
  SELECT t.node_id,
    jsonb_agg(t.target_id ORDER BY t.target_id) AS all_ids,
    coalesce(jsonb_agg(t.target_id ORDER BY t.target_id) FILTER (WHERE t.in_approved), '[]') AS approved_ids,
    coalesce(jsonb_agg(t.target_id ORDER BY t.target_id) FILTER (WHERE t.cur_all), '[]') AS cur_all_ids,
    coalesce(jsonb_agg(t.target_id ORDER BY t.target_id) FILTER (WHERE t.cur_approved), '[]') AS cur_approved_ids
  FROM public.node_target t WHERE ids IS NULL OR t.node_id = ANY(ids) GROUP BY t.node_id
), seats AS (
  SELECT node_id,
    jsonb_agg(DISTINCT target) AS all_ids,
    coalesce(jsonb_agg(DISTINCT target) FILTER (WHERE is_approved), '[]') AS approved_ids
  FROM edges_of WHERE type = 'seat' GROUP BY node_id
), vote_rows AS (
  SELECT node_id, user_uid,
    strpos(coalesce(user_uid, ''), 'pipeline') > 0 AS pipeline,
    public.js_date(public.jsonb_text(data -> 'updatedAt')) AS at,
    data -> 'categoryVotes' AS categories
  FROM public.votes WHERE node_id IS NOT NULL AND node_id <> '' AND (ids IS NULL OR node_id = ANY(ids))
), vote_categories AS (
  SELECT v.node_id, c.key AS category,
    sum((c.value #>> '{}')::numeric) FILTER (WHERE NOT v.pipeline) AS human_sum,
    max((c.value #>> '{}')::numeric) FILTER (WHERE v.pipeline) AS pipeline_best,
    max((c.value #>> '{}')::numeric) FILTER (WHERE v.user_uid = 'pipeline-publishable') AS publish_chance
  FROM vote_rows v, jsonb_each(CASE WHEN jsonb_typeof(v.categories) = 'object' THEN v.categories ELSE '{}' END) c
  WHERE jsonb_typeof(c.value) = 'number'
  GROUP BY v.node_id, c.key
), vote_totals AS (
  -- computeVoteStats: people's verdicts summed, the models' best added once.
  SELECT node_id, jsonb_object_agg(category,
    coalesce(human_sum, 0) + coalesce(
      CASE WHEN category = 'interesting' THEN coalesce(publish_chance, pipeline_best)
           ELSE pipeline_best END, 0)) AS totals
  FROM vote_categories GROUP BY node_id
), vote_people AS (
  SELECT node_id,
    bool_or(NOT pipeline) AS human_voted,
    count(DISTINCT user_uid) FILTER (WHERE NOT pipeline AND user_uid <> '') AS human_count,
    max(at) FILTER (WHERE NOT pipeline) AS last_voted_at,
    jsonb_object_agg(user_uid, categories -> 'interesting')
      FILTER (WHERE pipeline AND jsonb_typeof(categories -> 'interesting') = 'number') AS models
  FROM vote_rows GROUP BY node_id
), notes_count AS (
  -- computeNodes counts sources; the onNoteWritten trigger counted documents.
  SELECT node_id, sum(CASE WHEN jsonb_typeof(data -> 'sources') = 'array'
                           THEN jsonb_array_length(data -> 'sources') ELSE 0 END) AS n
  FROM public.notes WHERE node_id IS NOT NULL AND (ids IS NULL OR node_id = ANY(ids)) GROUP BY node_id
), facts_count AS (
  SELECT person_node_id AS node_id, count(*) AS n
  FROM public.extractions WHERE person_node_id IS NOT NULL AND person_node_id <> ''
    AND (ids IS NULL OR person_node_id = ANY(ids))
  GROUP BY person_node_id
), region_people AS (
  -- stats.people on a region: published people with a published tie to it,
  -- to a place in it or to a company under it.
  SELECT t.target_id AS node_id, count(*) AS n
  FROM public.node_target t JOIN public.nodes p ON p.id = t.node_id AND p.type = 'person' AND p.is_approved
  WHERE t.in_approved AND t.node_id <> t.target_id AND (ids IS NULL OR t.target_id = ANY(ids))
  GROUP BY t.target_id
)
SELECT n.id, n.type, n.is_approved,
  emp.latest_all, emp.latest_approved,
  coalesce(emp.current_all, false),
  coalesce(emp.current_approved, false),
  coalesce(x.experience_all, 0),
  coalesce(x.experience_approved, 0),
  coalesce(el.elections_all, '{}'),
  coalesce(el.elections_approved, '{}'),
  coalesce(vp.human_voted, false),
  coalesce((vt.totals ->> 'interesting')::numeric, 0),
  jsonb_build_object(
    'isApproved', n.is_approved,
    'notesCount', coalesce(nc.n, 0),
    'factsCount', coalesce(fc.n, 0),
    'votes', jsonb_build_object('interesting', 0, 'quality', 0)
      || coalesce(vt.totals, '{}')
      || jsonb_build_object('humanVoted', coalesce(vp.human_voted, false))
      || jsonb_strip_nulls(jsonb_build_object(
           'models', vp.models,
           'humanCount', nullif(vp.human_count, 0),
           'lastVotedAt', to_char(vp.last_voted_at AT TIME ZONE 'UTC',
                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
    'edges', jsonb_build_object(
      'all', jsonb_build_object(
        'experienceMonths', coalesce(x.experience_all, 0),
        'latestEmploymentStart', emp.latest_all,
        'targetNodeIds', coalesce(t.all_ids, '[]'),
        'seatNodeIds', coalesce(se.all_ids, '[]'),
        'currentlyEmployed', coalesce(emp.current_all, false),
        'currentlyEmployedTargetNodeIds', coalesce(t.cur_all_ids, '[]'),
        'elections', to_jsonb(coalesce(el.elections_all, '{}'))),
      'approved', jsonb_build_object(
        'experienceMonths', coalesce(x.experience_approved, 0),
        'latestEmploymentStart', emp.latest_approved,
        'targetNodeIds', coalesce(t.approved_ids, '[]'),
        'seatNodeIds', coalesce(se.approved_ids, '[]'),
        'currentlyEmployed', coalesce(emp.current_approved, false),
        'currentlyEmployedTargetNodeIds', coalesce(t.cur_approved_ids, '[]'),
        'elections', to_jsonb(coalesce(el.elections_approved, '{}'))))
  ) || CASE WHEN n.type = 'region' THEN jsonb_build_object('people', coalesce(rp.n, 0))
            ELSE '{}' END
FROM public.nodes n
LEFT JOIN employment emp ON emp.node_id = n.id
LEFT JOIN experience x ON x.node_id = n.id
LEFT JOIN elections el ON el.node_id = n.id
LEFT JOIN targets t ON t.node_id = n.id
LEFT JOIN seats se ON se.node_id = n.id
LEFT JOIN vote_totals vt ON vt.node_id = n.id
LEFT JOIN vote_people vp ON vp.node_id = n.id
LEFT JOIN notes_count nc ON nc.node_id = n.id
LEFT JOIN facts_count fc ON fc.node_id = n.id
LEFT JOIN region_people rp ON rp.node_id = n.id
WHERE ids IS NULL OR n.id = ANY(ids)
$$;

-- Every row of the three, written only where it changed, so that readers
-- see the old rows until the commit and an unchanged night writes nothing.
-- Returns the node_stats rows it changed.
-- Hash joins throughout: the CTEs' row estimates are the planner's
-- defaults, and the merge joins it picks on them sort millions of rows.
CREATE FUNCTION refresh_node_stats() RETURNS bigint
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
  RETURN greatest(changed, n);
END $$;

-- The rows a write moved, in its own transaction. `ids` are the nodes whose
-- own edges, votes, notes, facts or page changed; `wide` the places and
-- regions whose place in the ownership tree, type, `isPublic` or
-- `supervisoryBody` changed, which moves every company below them and
-- everybody tied to one. A region whose people may have changed is
-- recounted with them. Returns the node_stats rows it wrote.
-- Planned for the ids at hand each time: a generic plan cannot tell a
-- write's handful of nodes from every node and scans the tables.
CREATE FUNCTION refresh_node_stats_for(ids text[], wide text[] DEFAULT '{}') RETURNS bigint
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
  RETURN n;
END $$;

SELECT refresh_node_stats();
