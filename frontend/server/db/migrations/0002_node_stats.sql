-- The part of `stats` that /api/stats/computeNodes, the triggers and the
-- minute sweep write onto every node, computed from the documents instead:
-- isApproved, notesCount, factsCount, votes, edges.{all,approved} and a
-- region's people. Rule for rule what shared/stats.ts and computeNodes do;
-- tests/parity holds the two side by side. `nodeGroupSize`, `queueTier` and
-- `searchLine` stay batch fields in `nodes.data.stats`.

-- `new Date(value)` as V8 reads the dates the site stores: a year, a month or
-- a day (the day may run over the month, "2019-02-31" is 3 March), or a full
-- ISO timestamp. Anything else is null, which is NaN there. Dates without a
-- zone are read as UTC, the zone Cloud Run runs in.
CREATE FUNCTION js_date_parsed(value text) RETURNS timestamptz
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE m text[];
BEGIN
  -- Built from its parts rather than cast, so that nothing here can raise:
  -- an error handler would open a subtransaction per call.
  m := regexp_match(value,
    '^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2})(?:T(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(Z|[+-]\d{2}:?\d{2})?)?)?)?$');
  IF m IS NULL OR m[1]::int < 1
     OR coalesce(m[2], '1')::int NOT BETWEEN 1 AND 12
     OR coalesce(m[3], '1')::int NOT BETWEEN 1 AND 31
     OR coalesce(m[4], '0')::int > 24 OR coalesce(m[5], '0')::int > 59
     OR coalesce(m[6], '0')::numeric >= 60 THEN
    RETURN NULL;
  END IF;
  RETURN make_timestamptz(m[1]::int, coalesce(m[2], '1')::int, 1, 0, 0, 0, 'UTC')
    + (coalesce(m[3], '1')::int - 1) * interval '1 day'
    + make_interval(hours => coalesce(m[4], '0')::int, mins => coalesce(m[5], '0')::int,
                    secs => coalesce(m[6], '0')::float8)
    - CASE WHEN m[7] IS NULL OR m[7] = 'Z' THEN interval '0'
           ELSE (CASE WHEN left(m[7], 1) = '-' THEN -1 ELSE 1 END)
                * make_interval(hours => substr(m[7], 2, 2)::int, mins => right(m[7], 2)::int)
      END;
END $$;

-- The day form, nearly every date stored, without a function call: an SQL
-- function of one expression is inlined into the query. Nested CASEs, since
-- only they fix the order of evaluation.
CREATE FUNCTION js_date(value text) RETURNS timestamptz
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN value IS NULL THEN NULL
    WHEN value ~ '^\d{4}-\d{2}-\d{2}$' THEN
      CASE WHEN substr(value, 6, 2)::int BETWEEN 1 AND 12
             AND substr(value, 9, 2)::int BETWEEN 1 AND 31
             AND left(value, 4)::int >= 1
           THEN (make_date(left(value, 4)::int, substr(value, 6, 2)::int, 1)
                 + (substr(value, 9, 2)::int - 1))::timestamp AT TIME ZONE 'UTC'
      END
    ELSE public.js_date_parsed(value)
  END
$$;

-- candidacyElection (shared/electionDays.ts). tests/db checks it against the
-- TypeScript for every year and office.
CREATE FUNCTION election_key(start_text text, office text, by_election boolean)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  year text := substring(coalesce(start_text, '') from '^(\d{4})');
  kind text := CASE WHEN office IS NULL OR office = '' THEN NULL
                    WHEN office IN ('Sejm', 'Senat') THEN 'parliament'
                    WHEN office = 'Parlament Europejski' THEN 'european'
                    ELSE 'local' END;
BEGIN
  IF by_election IS TRUE OR year IS NULL THEN RETURN NULL; END IF;
  -- An office nobody named is matched in this order (UNNAMED_OFFICE_ORDER).
  IF coalesce(kind, 'parliament') = 'parliament' AND year = ANY ('{1989,1991,1993,1997,2001,2005,2007,2011,2015,2019,2023}') THEN
    RETURN 'parliament-' || year;
  END IF;
  IF coalesce(kind, 'local') = 'local' AND year = ANY ('{1990,1994,1998,2002,2006,2010,2014,2018,2024}') THEN
    RETURN 'local-' || year;
  END IF;
  IF coalesce(kind, 'european') = 'european' AND year = ANY ('{2004,2009,2014,2019,2024}') THEN
    RETURN 'european-' || year;
  END IF;
  RETURN NULL;
END $$;

-- namesASupervisorySeat (shared/companyBodies.ts): the role folded to ASCII
-- the way `fold` does it for Polish.
CREATE FUNCTION names_supervisory_seat(role text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(
    lower(translate(role, 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ'))
      ~ '(^|[^a-z0-9_])rad[a-z0-9_]*\s+(nadzorcz|spolecz)',
    false)
$$;

-- isCurrentPost (shared/stats.ts) for an employment's `end_date`: none, or
-- one that has not passed. Qualified: Postgres 17 refreshes a view with
-- search_path set to pg_catalog, and a function body is resolved then.
CREATE FUNCTION is_current_post(end_date jsonb) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT end_date IS NULL OR end_date IN ('null', 'false', '""', '0')
    OR coalesce(public.js_date(public.jsonb_text(end_date)) >= now(), false)
$$;

-- transitiveTargets (computeNodes.post.ts): for a place, the regions with an
-- `owns` or `seat` edge to it, and every company above it at any depth. The
-- regions of the companies above are not folded in.
CREATE MATERIALIZED VIEW place_ancestors AS
WITH RECURSIVE parent AS (
  SELECT e.target AS place_id, e.source AS parent_id
  FROM edges e JOIN nodes s ON s.id = e.source AND s.type = 'place'
  WHERE e.type IN ('owns', 'seat') AND NOT e.deleted AND e.target IS NOT NULL
), up(place_id, ancestor_id) AS (
  SELECT place_id, parent_id FROM parent
  UNION
  SELECT u.place_id, p.parent_id FROM up u JOIN parent p ON p.place_id = u.ancestor_id
)
SELECT place_id, ancestor_id FROM up
UNION
SELECT e.target, e.source
FROM edges e JOIN nodes s ON s.id = e.source AND s.type = 'region'
WHERE e.type IN ('owns', 'seat') AND NOT e.deleted AND e.target IS NOT NULL;
CREATE UNIQUE INDEX place_ancestors_pk ON place_ancestors (place_id, ancestor_id);

-- Every live edge from both of its ends, as computeNodes hands a node its
-- edges, with what the employment counters ask of it.
CREATE VIEW node_edges AS
WITH live AS (
  SELECT e.*,
    e.type = 'employed'
      AND jsonb_is_true(pl.data -> 'isPublic')
      AND NOT (jsonb_text(pl.data -> 'supervisoryBody') IS NOT DISTINCT FROM 'rada-spoleczna'
               AND names_supervisory_seat(jsonb_text(e.data -> 'name'))) AS public_post
  FROM edges e LEFT JOIN nodes pl ON pl.id = e.target
  WHERE NOT e.deleted AND e.source IS NOT NULL AND e.target IS NOT NULL
)
SELECT source AS node_id, live.* FROM live
UNION ALL
SELECT target AS node_id, live.* FROM live;

-- stats.edges.{all,approved}.{targetNodeIds,currentlyEmployedTargetNodeIds}
-- as rows: what a node points at, through which kind of edge.
CREATE MATERIALIZED VIEW node_target AS
WITH ends AS (
  SELECT node_id, target, is_approved AS approved,
    public_post AND is_current_post(data -> 'end_date') AS cur
  FROM node_edges
), expanded AS (
  SELECT node_id, target AS target_id, approved, cur FROM ends
  UNION ALL
  SELECT en.node_id, a.ancestor_id, en.approved, en.cur
  FROM ends en JOIN place_ancestors a ON a.place_id = en.target
)
SELECT node_id, target_id,
  bool_or(approved) AS in_approved,
  bool_or(cur) AS cur_all,
  bool_or(cur AND approved) AS cur_approved
FROM expanded
GROUP BY node_id, target_id;
CREATE UNIQUE INDEX node_target_pk ON node_target (target_id, node_id);
CREATE INDEX node_target_node ON node_target (node_id);

CREATE MATERIALIZED VIEW node_stats AS
WITH posts AS (
  SELECT node_id, is_approved AS approved,
    nullif(split_part(jsonb_text(data -> 'start_date'), 'T', 1), '') AS start_text,
    nullif(split_part(jsonb_text(data -> 'end_date'), 'T', 1), '') AS end_text,
    data -> 'end_date' AS end_raw
  FROM node_edges WHERE public_post
), dated AS MATERIALIZED (
  -- Materialized, so that each date is parsed once and not once per use.
  SELECT node_id, approved, start_text, end_text, end_raw,
    js_date(start_text) AS start_at, js_date(end_text) AS end_at
  FROM posts
), spans AS (
  SELECT node_id, approved, start_text,
    -- isCurrentPost: no end date, or one that has not passed.
    is_current_post(end_raw) AS current_post,
    CASE WHEN start_at IS NOT NULL
          AND (end_text IS NULL OR end_at IS NOT NULL)
          AND start_at <= coalesce(end_at, now())
         THEN tstzrange(start_at, coalesce(end_at, now()), '[]')
    END AS span
  FROM dated
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
  SELECT node_id, is_approved AS approved, jsonb_is_true(data -> 'elected') AS won,
    -- Only a recorded loss is one; a run with no result is neither.
    coalesce(data -> 'elected' = 'false'::jsonb, false) AS lost,
    election_key(jsonb_text(data -> 'start_date'), jsonb_text(data -> 'position'),
                 jsonb_is_true(data -> 'by_election')) AS k
  FROM node_edges WHERE type = 'election' AND source = node_id
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
  SELECT node_id,
    jsonb_agg(target_id ORDER BY target_id) AS all_ids,
    coalesce(jsonb_agg(target_id ORDER BY target_id) FILTER (WHERE in_approved), '[]') AS approved_ids,
    coalesce(jsonb_agg(target_id ORDER BY target_id) FILTER (WHERE cur_all), '[]') AS cur_all_ids,
    coalesce(jsonb_agg(target_id ORDER BY target_id) FILTER (WHERE cur_approved), '[]') AS cur_approved_ids
  FROM node_target GROUP BY node_id
), seats AS (
  SELECT node_id,
    jsonb_agg(DISTINCT target) AS all_ids,
    coalesce(jsonb_agg(DISTINCT target) FILTER (WHERE is_approved), '[]') AS approved_ids
  FROM node_edges WHERE type = 'seat' GROUP BY node_id
), vote_rows AS (
  SELECT node_id, user_uid,
    strpos(coalesce(user_uid, ''), 'pipeline') > 0 AS pipeline,
    js_date(jsonb_text(data -> 'updatedAt')) AS at,
    data -> 'categoryVotes' AS categories
  FROM votes WHERE node_id IS NOT NULL AND node_id <> ''
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
  FROM notes WHERE node_id IS NOT NULL GROUP BY node_id
), facts_count AS (
  SELECT person_node_id AS node_id, count(*) AS n
  FROM extractions WHERE person_node_id IS NOT NULL AND person_node_id <> ''
  GROUP BY person_node_id
), region_people AS (
  -- stats.people on a region: published people with a published tie to it,
  -- to a place in it or to a company under it.
  SELECT t.target_id AS node_id, count(*) AS n
  FROM node_target t JOIN nodes p ON p.id = t.node_id AND p.type = 'person' AND p.is_approved
  WHERE t.in_approved AND t.node_id <> t.target_id
  GROUP BY t.target_id
)
SELECT n.id, n.type, n.is_approved,
  emp.latest_all, emp.latest_approved,
  coalesce(emp.current_all, false) AS current_all,
  coalesce(emp.current_approved, false) AS current_approved,
  coalesce(x.experience_all, 0) AS experience_all,
  coalesce(x.experience_approved, 0) AS experience_approved,
  coalesce(el.elections_all, '{}') AS elections_all,
  coalesce(el.elections_approved, '{}') AS elections_approved,
  coalesce(vp.human_voted, false) AS human_voted,
  coalesce((vt.totals ->> 'interesting')::numeric, 0) AS interesting,
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
            ELSE '{}' END AS stats
FROM nodes n
LEFT JOIN employment emp ON emp.node_id = n.id
LEFT JOIN experience x ON x.node_id = n.id
LEFT JOIN elections el ON el.node_id = n.id
LEFT JOIN targets t ON t.node_id = n.id
LEFT JOIN seats se ON se.node_id = n.id
LEFT JOIN vote_totals vt ON vt.node_id = n.id
LEFT JOIN vote_people vp ON vp.node_id = n.id
LEFT JOIN notes_count nc ON nc.node_id = n.id
LEFT JOIN facts_count fc ON fc.node_id = n.id
LEFT JOIN region_people rp ON rp.node_id = n.id;
CREATE UNIQUE INDEX node_stats_pk ON node_stats (id);
CREATE INDEX node_stats_latest ON node_stats (type, latest_approved DESC NULLS LAST, id);
CREATE INDEX node_stats_elections_all ON node_stats USING gin (elections_all);
CREATE INDEX node_stats_elections_approved ON node_stats USING gin (elections_approved);

-- Run after a load or a batch of writes. CONCURRENTLY keeps the views
-- readable while they refresh; each has the unique index that needs.
CREATE FUNCTION refresh_node_stats() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY place_ancestors;
  REFRESH MATERIALIZED VIEW CONCURRENTLY node_target;
  REFRESH MATERIALIZED VIEW CONCURRENTLY node_stats;
END $$;
