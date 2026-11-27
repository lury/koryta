-- The last batch fields of /api/stats/computeNodes, in SQL: a node's
-- `stats.nodeGroupSize` (getNodeGroups, shared/graph/util.ts) and a person's
-- `stats.searchLine` (storedSearchLines, shared/searchLine.ts), kept in
-- `node_derived` rather than in the document; the home map's region rows
-- (server/utils/regionStats.ts) as the view `region_people_rows`; and
-- /api/stats/hospitals (buildHospitalStats, server/utils/hospitalStats.ts)
-- as `hospital_stats()`. Rule for rule what the TypeScript does;
-- tests/server/db/statsSql.pg.test.ts holds the two side by side.

-- ---------------------------------------------------------------------------
-- JavaScript's reading of a value
-- ---------------------------------------------------------------------------

-- `!!value` for a document field: absent, null, false, 0 and "" are false.
CREATE FUNCTION js_truthy(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT value IS NOT NULL AND value NOT IN ('null', 'false', '0', '""')
$$;

-- `value.replace(/\s+/g, " ").trim()`: \s as JavaScript has it (the
-- whitespace and line terminators, U+0085 not among them).
CREATE FUNCTION js_squash(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(value,
    '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'), ' ')
$$;

-- `value.trim()`.
CREATE FUNCTION js_trim(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(value,
    '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$',
    '', 'g')
$$;

-- `/^(\d{4})/.exec(value)?.[1]`.
CREATE FUNCTION js_year(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT substring(value FROM '^(\d{4})')
$$;

-- Milliseconds since the epoch of a day in UTC, for any year 0-9999 (a
-- 400-year cycle is 146097 days, so the year is moved into the range
-- make_date takes and back). The day may run over the month, as in V8.
CREATE FUNCTION js_day_ms(y int, m int, d int) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ((make_date(y + 400, m, 1) - date '1970-01-01') - 146097 + (d - 1))::bigint * 86400000
$$;

-- `spellDate` (shared/succession.ts): a YYYY-MM-DD day, else null.
CREATE FUNCTION spell_date_ms(value text) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN value ~ '^\d{4}-\d{2}-\d{2}$'
      AND substr(value, 6, 2)::int BETWEEN 1 AND 12
      AND substr(value, 9, 2)::int BETWEEN 1 AND 31
    THEN public.js_day_ms(left(value, 4)::int, substr(value, 6, 2)::int, substr(value, 9, 2)::int)
  END
$$;

-- An array's elements, or an object's values in `Object.values` order:
-- the keys that are array indices by number, then the rest as stored.
CREATE FUNCTION js_values(value jsonb) RETURNS TABLE (ord bigint, elem jsonb)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT a.ord, a.elem FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(value) = 'array' THEN value ELSE '[]' END)
    WITH ORDINALITY AS a(elem, ord)
  UNION ALL
  SELECT row_number() OVER (ORDER BY o.key ~ '^(0|[1-9][0-9]{0,9})$' DESC,
      CASE WHEN o.key ~ '^(0|[1-9][0-9]{0,9})$' THEN o.key::numeric END, o.ord), o.value
  FROM jsonb_each(CASE WHEN jsonb_typeof(value) = 'object' THEN value ELSE '{}' END)
    WITH ORDINALITY AS o(key, value, ord)
$$;

-- `paintedParty` then `canonicalParty` (shared/misc.ts): the first party
-- with a colour of its own other than „Inne”, else „Inne” for anybody with
-- a party at all; SLD is counted as Nowa Lewica.
CREATE FUNCTION painted_party(parties jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p = 'SLD' THEN 'Nowa Lewica' ELSE p END FROM (
    SELECT coalesce(
      (SELECT v.elem #>> '{}' FROM public.js_values(parties) v
       WHERE jsonb_typeof(v.elem) = 'string' AND public.js_trim(v.elem #>> '{}') <> ''
         AND v.elem #>> '{}' IN ('PO', 'PiS', 'PSL', 'Polska 2050', 'Nowa Lewica', 'SLD',
           'Konfederacja', 'Nowoczesna', 'Bezpartyjni Samorządowcy')
       ORDER BY v.ord LIMIT 1),
      CASE WHEN EXISTS (SELECT 1 FROM public.js_values(parties) v
        WHERE jsonb_typeof(v.elem) = 'string' AND public.js_trim(v.elem #>> '{}') <> '')
        THEN 'Inne' END) AS p
  ) s
$$;

-- ---------------------------------------------------------------------------
-- stats.nodeGroupSize
-- ---------------------------------------------------------------------------
--
-- getNodeGroups walks two states of every person, place and region: the
-- active one, which leads on, and the dead end, which does not. Each edge
-- type links them as `edgeTraverse` says, deleted and unpublished edges
-- alike. A node's size is the number of person states not hidden that its
-- active state reaches: the active ones reached (itself only through a
-- cycle) plus the dead ends of everything active reached, itself included.

-- The links of the state graph: `from_id` active leads to `to_id`, active or
-- a dead end, between persons, places and regions.
CREATE VIEW group_links AS
WITH graph AS (
  SELECT id FROM nodes WHERE type IN ('person', 'place', 'region')
), l AS (
  SELECT e.source AS from_id, e.target AS to_id, e.type IN ('employed', 'connection', 'owns') AS to_active
  FROM edges e
  WHERE e.type IN ('employed', 'connection', 'mentions', 'owns', 'seat', 'comment', 'election', 'tagged')
  UNION ALL
  SELECT e.target, e.source, e.type IN ('connection', 'mentions')
  FROM edges e
  WHERE e.type IN ('employed', 'connection', 'mentions', 'owns', 'seat', 'comment', 'election', 'tagged')
)
SELECT l.from_id, l.to_id, l.to_active FROM l
JOIN graph f ON f.id = l.from_id JOIN graph t ON t.id = l.to_id
WHERE NOT (l.to_active AND l.from_id = l.to_id);

-- The size of each of `roots`. Over integer ids, so that the pairs of a root
-- and a dead end it reaches, quadratic in the people of a place, hash fast.
CREATE FUNCTION node_group_sizes(roots text[]) RETURNS TABLE (id text, size int)
LANGUAGE sql STABLE SET work_mem = '512MB' AS $$
  WITH RECURSIVE graph AS MATERIALIZED (
    SELECT n.id, row_number() OVER ()::int AS i,
      n.type = 'person' AND NOT public.js_truthy(n.data -> 'hide') AS counted
    FROM public.nodes n WHERE n.type IN ('person', 'place', 'region')
  ), links AS MATERIALIZED (
    SELECT f.i AS from_i, t.i AS to_i, l.to_active, t.counted
    FROM public.group_links l JOIN graph f ON f.id = l.from_id JOIN graph t ON t.id = l.to_id
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

-- The same for a few roots, walked from them through the edge indexes
-- rather than over the whole graph: what a write recounts.
CREATE FUNCTION node_group_sizes_near(roots text[]) RETURNS TABLE (id text, size int)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE root AS (
    SELECT DISTINCT n.id FROM unnest(roots) r JOIN public.nodes n ON n.id = r
    WHERE n.type IN ('person', 'place', 'region')
  ), reach(root, node) AS (
    SELECT r.id, nx.id FROM root r CROSS JOIN LATERAL (
      SELECT e.target AS id FROM public.edges e
      WHERE e.source = r.id AND e.type IN ('employed', 'connection', 'owns') AND e.target <> r.id
      UNION ALL
      SELECT e.source FROM public.edges e
      WHERE e.target = r.id AND e.type IN ('connection', 'mentions') AND e.source <> r.id) nx
    JOIN public.nodes g ON g.id = nx.id AND g.type IN ('person', 'place', 'region')
    UNION
    SELECT reach.root, nx.id FROM reach CROSS JOIN LATERAL (
      SELECT e.target AS id FROM public.edges e
      WHERE e.source = reach.node AND e.type IN ('employed', 'connection', 'owns') AND e.target <> reach.node
      UNION ALL
      SELECT e.source FROM public.edges e
      WHERE e.target = reach.node AND e.type IN ('connection', 'mentions') AND e.source <> reach.node) nx
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
        WHERE e.source = a.node AND e.type IN ('mentions', 'seat', 'comment', 'election', 'tagged')
        UNION ALL
        SELECT e.source FROM public.edges e
        WHERE e.target = a.node AND e.type IN ('employed', 'owns', 'seat', 'comment', 'election', 'tagged')) nx
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
CREATE FUNCTION node_group_affected(ends text[], changed text[] DEFAULT '{}')
RETURNS TABLE (id text) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE seed AS (
    SELECT unnest(ends || changed) AS id
    UNION
    SELECT e.source FROM public.edges e WHERE e.target = ANY(changed) AND e.source IS NOT NULL
      AND e.type IN ('employed', 'connection', 'mentions', 'owns', 'seat', 'comment', 'election', 'tagged')
    UNION
    SELECT e.target FROM public.edges e WHERE e.source = ANY(changed) AND e.target IS NOT NULL
      AND e.type IN ('employed', 'connection', 'mentions', 'owns', 'seat', 'comment', 'election', 'tagged')
  ), up(id) AS (
    SELECT id FROM seed
    UNION
    SELECT pre.id FROM up CROSS JOIN LATERAL (
      SELECT e.source AS id FROM public.edges e
      WHERE e.target = up.id AND e.type IN ('employed', 'connection', 'owns') AND e.source IS NOT NULL
      UNION ALL
      SELECT e.target FROM public.edges e
      WHERE e.source = up.id AND e.type IN ('connection', 'mentions') AND e.target IS NOT NULL
    ) pre
  )
  SELECT up.id FROM up JOIN public.nodes n ON n.id = up.id
$$;

-- ---------------------------------------------------------------------------
-- stats.searchLine
-- ---------------------------------------------------------------------------

-- `placeName` (shared/searchLine.ts).
CREATE FUNCTION line_place_name(name text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN t ~ '^(Gmina|Miasto) .' THEN substring(t FROM '^(?:Gmina|Miasto) (.+)$')
    WHEN t ~ '^Powiat .' THEN 'powiat ' || substring(t FROM '^Powiat (.+)$')
    WHEN t ~* '^Województwo .' THEN lower(substring(t FROM '^(?:[Ww][Oo][Jj][Ee][Ww][ÓóOo][Dd][Zz][Tt][Ww][Oo]) (.+)$'))
    ELSE t END
  FROM (SELECT public.js_squash(name) AS t) s
$$;

-- `splitQualifier(name, "place")` (shared/search.ts) of a squashed name:
-- what it is called and the town of its bracket, '' where it has none.
CREATE FUNCTION line_split_town(name text, OUT called text, OUT town text)
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN at > 0 THEN rtrim(left(name, at - 1), ' ') ELSE name END,
    CASE WHEN at > 0 THEN (regexp_match(substr(name, at), '^\(([^()]*)\)'))[1] ELSE '' END
  FROM (SELECT regexp_instr(name, '\(([^()]*[[:lower:]][^()]*)\) *$') AS at) s
$$;

-- `companyName`: the register name without its town, or the name it
-- carries in quotes.
CREATE FUNCTION line_company_name(name text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN q IS NOT NULL THEN '„' || btrim(q, ' ') || '”' ELSE btrim(called, ' ') END
  FROM (SELECT called, (regexp_match(called, '["„”]([^"„”]{2,})["„”]'))[1] AS q
        FROM public.line_split_town(regexp_replace(name,
          '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'))) s
$$;

-- `regionTown`: the town a region is, a gmina or a city with powiat rights.
CREATE FUNCTION line_region_town(name text, teryt text, deleted boolean) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN name IS NULL OR name = '' OR deleted THEN NULL
    WHEN length(teryt) = 7 THEN public.line_place_name(name)
    WHEN length(teryt) = 4 AND public.js_trim(name) !~
      '^Powiat[\t\n\v\f\r    -     　﻿]'
      THEN public.line_place_name(name)
  END
$$;

-- Where each place is for a line (`companyPlace`): the town, the TERYT code
-- of its area and its seat as a line names it, and the place's name as a
-- line says it (`companyName`). The seat is the region of its
-- first `seat` edge by id; the owner the one gmina within the seat among the
-- regions with an `owns` edge to it, counted per edge, else the one town.
CREATE FUNCTION line_places(ids text[] DEFAULT NULL)
RETURNS TABLE (id text, town text, area text, region text, company text)
LANGUAGE sql STABLE AS $$
  WITH place AS (
    SELECT p.id, public.line_company_name(public.jsonb_text(p.data -> 'name')) AS company, regexp_replace(coalesce(public.jsonb_text(p.data -> 'name'), ''),
        '[\t\n\v\f\r    -     　﻿]+', ' ', 'g') AS squashed
    FROM public.nodes p WHERE p.type = 'place' AND (ids IS NULL OR p.id = ANY(ids))
  ), seat AS (
    SELECT DISTINCT ON (e.target) e.target AS place_id, r.data AS rdata, r.deleted AS rdeleted
    FROM public.edges e JOIN public.nodes r ON r.id = e.source AND r.type = 'region'
    WHERE e.type = 'seat' AND NOT e.deleted AND (ids IS NULL OR e.target = ANY(ids))
    ORDER BY e.target, e.id
  ), owner AS (
    SELECT e.target AS place_id, e.id AS edge_id, r.data AS rdata, r.deleted AS rdeleted,
      public.jsonb_text(r.data -> 'teryt') AS teryt
    FROM public.edges e JOIN public.nodes r ON r.id = e.source AND r.type = 'region'
    WHERE e.type = 'owns' AND NOT e.deleted AND (ids IS NULL OR e.target = ANY(ids))
  ), gmina AS (
    SELECT o.*, count(*) OVER w AS gminas,
      count(*) FILTER (WHERE right(o.teryt, 1) = '1') OVER w AS towns
    FROM owner o LEFT JOIN seat s ON s.place_id = o.place_id
    WHERE length(o.teryt) = 7
      AND (coalesce(public.jsonb_text(s.rdata -> 'teryt'), '') = ''
           OR starts_with(o.teryt, public.jsonb_text(s.rdata -> 'teryt')))
    WINDOW w AS (PARTITION BY o.place_id)
  ), picked AS (
    SELECT DISTINCT ON (place_id) place_id, rdata, rdeleted, teryt FROM gmina
    WHERE gminas = 1 OR (towns = 1 AND right(teryt, 1) = '1')
    ORDER BY place_id
  )
  SELECT p.id,
    coalesce(nullif(btrim((public.line_split_town(p.squashed)).town, ' '), ''),
      public.line_region_town(public.jsonb_text(s.rdata -> 'name'), public.jsonb_text(s.rdata -> 'teryt'), s.rdeleted),
      public.line_region_town(public.jsonb_text(o.rdata -> 'name'), o.teryt, o.rdeleted)),
    CASE WHEN s.place_id IS NOT NULL AND s.rdata -> 'teryt' IS NOT NULL AND s.rdata -> 'teryt' <> 'null'
      THEN public.jsonb_text(s.rdata -> 'teryt') ELSE o.teryt END,
    CASE WHEN public.js_truthy(s.rdata -> 'name') THEN public.line_place_name(public.jsonb_text(s.rdata -> 'name')) END,
    p.company
  FROM place p LEFT JOIN seat s ON s.place_id = p.id LEFT JOIN picked o ON o.place_id = p.id
$$;

-- The first revision of each document by `update_time` (the lower id
-- first), and whether an import wrote it: `addFirstRevision`
-- (tests/server/db/batchFields.ts, the oracle) over the revisions filed under `node_id`.
CREATE FUNCTION first_revisions(ids text[] DEFAULT NULL)
RETURNS TABLE (doc_id text, automatic boolean) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (doc_id) doc_id, coalesce(update_automatic = 'true'::jsonb, false)
  FROM (
    SELECT public.jsonb_text(r.data -> 'node_id') AS doc_id, r.id,
      CASE WHEN jsonb_typeof(r.data -> 'update_time') = 'string' THEN nullif(r.data ->> 'update_time', '')
           WHEN jsonb_typeof(r.data #> '{update_time,_seconds}') = 'number'
             THEN to_char(to_timestamp((r.data #>> '{update_time,_seconds}')::float8) AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS at,
      r.data -> 'update_automatic' AS update_automatic
    FROM public.revisions r
    WHERE ids IS NULL OR r.node_id = ANY(ids)
  ) x
  WHERE doc_id IS NOT NULL AND doc_id <> '' AND at IS NOT NULL
  ORDER BY doc_id, at COLLATE "C", id
$$;

-- `storedSearchLines` of the people `ids` names, or of every person, on the
-- day `at`: the line for each scope a reader may be in, null for a person
-- with none. For a few people, `places` (the places they work at) and
-- `docs` (them and their posts) narrow the reads of seats, owners and first
-- revisions; given as values, so that the plan reaches those by index.
CREATE FUNCTION search_lines(at timestamptz DEFAULT now(), ids text[] DEFAULT NULL,
  places text[] DEFAULT NULL, docs text[] DEFAULT NULL)
RETURNS TABLE (id text, line jsonb) LANGUAGE sql STABLE AS $$
  WITH person AS (
    SELECT p.id, p.is_approved, public.js_truthy(p.data -> 'revision_id') AS reviewed
    FROM public.nodes p WHERE p.type = 'person' AND (ids IS NULL OR p.id = ANY(ids))
  ), own AS (
    -- The ties a line reads: live posts at a place and runs in a region with
    -- a year, each with its far end named and not removed.
    SELECT e.id, e.source AS person_id, e.target, e.type = 'employed' AS is_post,
      e.is_approved, public.js_truthy(e.data -> 'revision_id') AS reviewed,
      public.jsonb_text(e.data -> 'name') AS role,
      public.jsonb_text(e.data -> 'position') AS office,
      public.js_year(e.data ->> 'start_date') AS start_year,
      public.js_year(e.data ->> 'end_date') AS end_year,
      public.spell_date_ms(public.jsonb_text(e.data -> 'start_date')) AS start_ms,
      public.spell_date_ms(public.jsonb_text(e.data -> 'end_date')) AS end_ms,
      coalesce(e.data -> 'elected' = 'true'::jsonb, false) AS won,
      CASE WHEN e.type = 'election' THEN
        public.election_key(public.jsonb_text(e.data -> 'start_date'), public.jsonb_text(e.data -> 'position'),
                            public.js_truthy(e.data -> 'by_election')) END AS election,
      public.jsonb_text(t.data -> 'name') AS tname, public.jsonb_text(t.data -> 'teryt') AS tteryt,
      t.deleted AS tdeleted
    FROM person p
    JOIN public.edges e ON e.source = p.id AND NOT e.deleted
    JOIN public.nodes t ON t.id = e.target AND NOT t.deleted AND public.js_truthy(t.data -> 'name')
    WHERE (e.type = 'employed' AND t.type = 'place')
       OR (e.type = 'election' AND t.type = 'region' AND public.js_year(e.data ->> 'start_date') IS NOT NULL)
  ), place_lines AS MATERIALIZED (
    SELECT * FROM public.line_places(places)
  ), firsts AS MATERIALIZED (
    SELECT f.doc_id, f.automatic FROM public.first_revisions(docs) f
  ), region_lines AS MATERIALIZED (
    -- Each region a run is in, read once rather than per run.
    SELECT r.target AS id, public.line_region_town(r.tname, r.tteryt, r.tdeleted) AS town,
      public.line_place_name(r.tname) AS region
    FROM (SELECT DISTINCT target, tname, tteryt, tdeleted FROM own WHERE NOT is_post) r
  ), placed AS MATERIALIZED (
    -- Once per tie, not once per scope it is read in.
    SELECT o.*,
      nullif(CASE WHEN o.is_post THEN lp.town ELSE rl.town END, '') AS town,
      CASE WHEN o.is_post THEN lp.area ELSE o.tteryt END AS area,
      CASE WHEN o.is_post THEN lp.region ELSE rl.region END AS region,
      lp.company,
      -- `held` and `lastSeen`.
      o.end_ms IS NULL OR o.end_ms >= (extract(epoch FROM at) * 1000)::bigint AS held,
      CASE WHEN NOT o.is_post THEN public.js_day_ms(o.start_year::int, 12, 31)
           WHEN o.end_ms IS NULL OR o.end_ms >= (extract(epoch FROM at) * 1000)::bigint THEN 9007199254740991
           ELSE o.end_ms END AS last_seen
    FROM own o
    LEFT JOIN place_lines lp ON lp.id = o.target AND o.is_post
    LEFT JOIN region_lines rl ON rl.id = o.target AND NOT o.is_post
  ), scoped AS (
    -- Each tie in each scope it is read in: the published ones, all of them,
    -- and the teaser's posts, of a person and a post an import wrote or a
    -- reviewer approved.
    SELECT s.scope, pl.*, CASE WHEN s.scope = 'all' AND NOT p.is_approved THEN 'post' ELSE 'office' END AS lead
    FROM placed pl JOIN person p ON p.id = pl.person_id
    LEFT JOIN firsts fp ON fp.doc_id = p.id
    LEFT JOIN firsts fe ON fe.doc_id = pl.id
    CROSS JOIN LATERAL (VALUES ('approved'), ('all'), ('teaser')) AS s(scope)
    WHERE CASE s.scope
      WHEN 'approved' THEN pl.is_approved
      WHEN 'all' THEN true
      ELSE pl.is_post AND (p.reviewed OR coalesce(fp.automatic, false))
        AND (pl.reviewed OR coalesce(fe.automatic, false)) END
  ), latest_post AS (
    -- `mostRecentPost`.
    SELECT DISTINCT ON (person_id, scope) * FROM scoped WHERE is_post
    ORDER BY person_id, scope,
      CASE WHEN NOT held THEN 2 WHEN start_ms IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN held THEN coalesce(start_ms, 0) ELSE end_ms END DESC,
      coalesce(start_ms, 0) DESC, (role IS NOT NULL AND role <> '') DESC, id COLLATE "und-x-icu"
  ), run_order AS (
    SELECT *, row_number() OVER (PARTITION BY person_id, scope
      ORDER BY start_year DESC, won DESC, id COLLATE "und-x-icu") AS rn
    FROM scoped WHERE NOT is_post
  ), first_run AS (
    SELECT * FROM run_order WHERE rn = 1
  ), first_won AS (
    SELECT DISTINCT ON (person_id, scope) * FROM run_order WHERE won ORDER BY person_id, scope, rn
  ), seat_now AS (
    SELECT DISTINCT ON (person_id, scope) * FROM run_order
    WHERE won AND election IN ('parliament-2023', 'local-2024', 'european-2024')
    ORDER BY person_id, scope, rn
  ), scopes AS (
    SELECT DISTINCT person_id, scope, lead FROM scoped
  ), chosen AS (
    -- Which tie the line names (`personSearchLine`), and whether a post is
    -- named as held.
    SELECT sc.person_id, sc.scope, pick.*
    FROM scopes sc
    LEFT JOIN latest_post lpo ON lpo.person_id = sc.person_id AND lpo.scope = sc.scope
    LEFT JOIN seat_now sn ON sn.person_id = sc.person_id AND sn.scope = sc.scope
    LEFT JOIN first_won fw ON fw.person_id = sc.person_id AND fw.scope = sc.scope
    LEFT JOIN first_run fr ON fr.person_id = sc.person_id AND fr.scope = sc.scope
    CROSS JOIN LATERAL (
      SELECT CASE
          WHEN sc.lead = 'post' AND lpo.id IS NOT NULL THEN lpo.id
          WHEN sn.id IS NOT NULL THEN sn.id
          WHEN lpo.held THEN lpo.id
          ELSE (SELECT c.edge_id FROM (VALUES
                  (fw.start_year, 0, fw.id),
                  (coalesce(lpo.end_year, lpo.start_year), 1, lpo.id),
                  (fr.start_year, 2, fr.id)) AS c(year, rank, edge_id)
                WHERE c.year IS NOT NULL AND c.edge_id IS NOT NULL
                ORDER BY c.year DESC, c.rank LIMIT 1)
        END AS edge_id,
        CASE WHEN sc.lead = 'post' AND lpo.id IS NOT NULL THEN lpo.held
             WHEN sn.id IS NOT NULL THEN NULL
             WHEN lpo.held THEN true
             ELSE false END AS as_held
    ) pick
  ), subject AS (
    SELECT s.*, c.as_held FROM chosen c
    JOIN scoped s ON s.person_id = c.person_id AND s.scope = c.scope AND s.id = c.edge_id
  ), near AS (
    -- `lineTown`: a tie that names no town takes the town of the latest
    -- other tie inside its area.
    SELECT DISTINCT ON (s.person_id, s.scope) s.person_id, s.scope, o.town, o.target
    FROM subject s
    JOIN scoped o ON o.person_id = s.person_id AND o.scope = s.scope AND o.id <> s.id
    WHERE s.town IS NULL AND coalesce(s.area, '') <> ''
      AND o.town IS NOT NULL AND starts_with(o.area, s.area)
    ORDER BY s.person_id, s.scope, o.last_seen DESC, o.id COLLATE "und-x-icu"
  ), lines AS (
    SELECT s.person_id, s.scope, jsonb_strip_nulls(jsonb_build_object(
        'where', nullif(coalesce(s.town, near.town, s.region), ''),
        'what', CASE WHEN s.is_post THEN s.company
                     WHEN s.won AND public.js_trim(s.office) <> '' AND public.js_trim(s.office) <> 'Samorząd'
                       THEN public.js_trim(s.office)
                     ELSE 'wybory' END,
        'when', CASE WHEN NOT s.is_post THEN s.start_year
                     WHEN NOT s.as_held AND s.end_year IS NOT NULL THEN 'do ' || s.end_year END,
        'ties', CASE WHEN s.town IS NULL AND near.town IS NOT NULL
                     THEN jsonb_build_array(s.target, near.target) ELSE jsonb_build_array(s.target) END,
        'election', CASE WHEN NOT s.is_post AND s.election IS NOT NULL
                         THEN s.election || CASE WHEN s.won THEN ':won' ELSE '' END END)) AS line
    FROM subject s
    LEFT JOIN near ON near.person_id = s.person_id AND near.scope = s.scope
  ), per_person AS (
    SELECT person_id, jsonb_object_agg(scope, line) AS line FROM lines GROUP BY person_id
  )
  SELECT p.id, pp.line FROM person p LEFT JOIN per_person pp ON pp.person_id = p.id
$$;

-- ---------------------------------------------------------------------------
-- node_derived
-- ---------------------------------------------------------------------------

-- The two fields, out of the document: what the API lays over `stats`
-- (server/db/nodes.ts, `servedDoc`) and what /api/search ranks by.
CREATE TABLE node_derived (
  id              text COLLATE "C" PRIMARY KEY,
  node_group_size int NOT NULL,
  search_line     jsonb
);
CREATE INDEX node_derived_rank ON node_derived (node_group_size DESC, id DESC);

-- `stats` with the two laid over it.
CREATE FUNCTION derived_stats(node_group_size int, search_line jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN node_group_size IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('nodeGroupSize', node_group_size)
      || CASE WHEN search_line IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('searchLine', search_line) END
  END
$$;

-- Writes the sizes of `roots`, only where they changed; rows of nodes that
-- are gone are dropped. Returns the rows it changed.
CREATE FUNCTION write_node_group_sizes(roots text[]) RETURNS bigint
LANGUAGE plpgsql SET plan_cache_mode = force_custom_plan AS $$
DECLARE changed bigint;
BEGIN
  INSERT INTO public.node_derived AS d (id, node_group_size)
  SELECT n.id, coalesce(g.size, 0)
  FROM public.nodes n LEFT JOIN public.node_group_sizes_near(roots) g ON g.id = n.id
  WHERE n.id = ANY(roots)
  ON CONFLICT (id) DO UPDATE SET node_group_size = excluded.node_group_size
  WHERE d.node_group_size IS DISTINCT FROM excluded.node_group_size;
  GET DIAGNOSTICS changed = ROW_COUNT;
  DELETE FROM public.node_derived d WHERE d.id = ANY(roots)
    AND NOT EXISTS (SELECT 1 FROM public.nodes n WHERE n.id = d.id);
  RETURN changed;
END $$;

-- Writes the lines of the people `ids` names, only where they changed.
CREATE FUNCTION write_search_lines(at timestamptz, ids text[]) RETURNS bigint
LANGUAGE plpgsql SET plan_cache_mode = force_custom_plan AS $$
DECLARE changed bigint; places text[]; docs text[];
BEGIN
  places := ARRAY(SELECT DISTINCT e.target FROM public.edges e
                  WHERE e.source = ANY(ids) AND e.type = 'employed' AND e.target IS NOT NULL);
  docs := ids || ARRAY(SELECT e.id FROM public.edges e WHERE e.source = ANY(ids) AND e.type = 'employed');
  INSERT INTO public.node_derived AS d (id, node_group_size, search_line)
  SELECT s.id, 0, s.line FROM public.search_lines(at, ids, places, docs) s
  ON CONFLICT (id) DO UPDATE SET search_line = excluded.search_line
  WHERE d.search_line IS DISTINCT FROM excluded.search_line;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;

-- Every node: the nightly recount, and the consistency check of the
-- incremental one. Returns the rows it changed.
CREATE FUNCTION refresh_node_derived(at timestamptz DEFAULT now()) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE gone bigint; changed bigint;
BEGIN
  CREATE TEMP TABLE fresh ON COMMIT DROP AS
  SELECT n.id, coalesce(g.size, 0) AS node_group_size, l.line AS search_line
  FROM public.nodes n
  LEFT JOIN public.node_group_sizes(
    ARRAY(SELECT x.id FROM public.nodes x WHERE x.type IN ('person', 'place', 'region'))) g ON g.id = n.id
  LEFT JOIN public.search_lines(at) l ON l.id = n.id;
  DELETE FROM public.node_derived d WHERE NOT EXISTS (SELECT 1 FROM fresh f WHERE f.id = d.id);
  GET DIAGNOSTICS gone = ROW_COUNT;
  INSERT INTO public.node_derived AS d (id, node_group_size, search_line)
  SELECT * FROM fresh
  ON CONFLICT (id) DO UPDATE SET node_group_size = excluded.node_group_size, search_line = excluded.search_line
  WHERE (d.node_group_size, d.search_line) IS DISTINCT FROM (excluded.node_group_size, excluded.search_line);
  GET DIAGNOSTICS changed = ROW_COUNT;
  DROP TABLE fresh;
  RETURN gone + changed;
END $$;

-- After a write: the sizes that the edges at `ends`, or the type or `hide`
-- of `changed`, can move, and the lines of the people whose ties, far ends
-- or first revisions are among `touched` (node or edge ids). Returns the
-- rows it changed.
CREATE FUNCTION refresh_node_derived_for(
  at timestamptz, touched text[], ends text[] DEFAULT '{}', changed text[] DEFAULT '{}')
RETURNS bigint LANGUAGE plpgsql SET plan_cache_mode = force_custom_plan AS $$
DECLARE n bigint := 0;
BEGIN
  IF cardinality(ends) + cardinality(changed) > 0 THEN
    n := n + public.write_node_group_sizes(
      ARRAY(SELECT a.id FROM public.node_group_affected(ends, changed) a));
  END IF;
  IF cardinality(touched) > 0 THEN
    -- A person's line reads their own ties, the nodes at the far end, the
    -- seat and owners of a company they work at, and the first revisions of
    -- themselves and their posts.
    n := n + public.write_search_lines(at, ARRAY(
      SELECT p.id FROM public.nodes p WHERE p.id = ANY(touched) AND p.type = 'person'
      UNION
      SELECT e.source FROM public.edges e WHERE e.id = ANY(touched) AND e.source IS NOT NULL
      UNION
      SELECT e.source FROM public.edges e WHERE e.target = ANY(touched) AND e.source IS NOT NULL
      UNION
      SELECT w.source FROM public.edges s
      JOIN public.edges w ON w.target = s.target AND w.type = 'employed' AND w.source IS NOT NULL
      WHERE s.source = ANY(touched) AND s.type IN ('seat', 'owns')));
  END IF;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- /api/stats/regions
-- ---------------------------------------------------------------------------

-- The rows the home map draws (`regionStat`, server/utils/regionStats.ts):
-- every region in id order, with `people` from node_stats and, for a powiat,
-- the people it counts by the party each is drawn in.
CREATE VIEW region_people_rows AS
WITH region AS (
  SELECT n.id, public.jsonb_text(n.data -> 'teryt') AS teryt, n.data -> 'name' AS name,
    n.data -> 'teryt' AS teryt_raw, coalesce((s.stats ->> 'people')::numeric, 0) AS people
  FROM public.nodes n LEFT JOIN public.node_stats s ON s.id = n.id
  WHERE n.type = 'region'
), party AS (
  SELECT t.target_id AS id, public.painted_party(p.data -> 'parties') AS party, count(*) AS n
  FROM public.node_target t
  JOIN region r ON r.id = t.target_id AND length(r.teryt) = 4
  JOIN public.nodes p ON p.id = t.node_id AND p.type = 'person' AND p.is_approved
  WHERE t.in_approved AND t.node_id <> t.target_id
  GROUP BY 1, 2
)
SELECT r.id, jsonb_build_object('id', r.id, 'people', r.people)
  || CASE WHEN public.js_truthy(r.teryt_raw) THEN jsonb_build_object('teryt', r.teryt_raw) ELSE '{}' END
  || CASE WHEN public.js_truthy(r.name) THEN jsonb_build_object('name', r.name) ELSE '{}' END
  || CASE WHEN length(r.teryt) = 4 THEN jsonb_build_object('parties', coalesce(
       (SELECT jsonb_object_agg(pa.party, pa.n) FROM party pa WHERE pa.id = r.id AND pa.party IS NOT NULL),
       '{}')) ELSE '{}' END AS row
FROM region r;
