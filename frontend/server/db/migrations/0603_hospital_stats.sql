-- /api/stats/hospitals in SQL: who sits on the supervisory boards of the
-- publicly owned hospitals, by party (server/utils/hospitalStats.ts holds
-- the rules and why; its `buildHospitalStats` stays as the oracle of
-- tests/server/db/statsSql.pg.test.ts).
--
-- Two tables kept with node_stats, the whole of them by refresh_node_stats()
-- and the places a write touched by refresh_node_stats_for(): the hospitals
-- with their group and województwo, and each (hospital, person) seat with
-- the spells behind it. Whether a spell is over depends on the day, and a
-- person's parties on their page, so `hospital_stats(today)` reads both at
-- the time of the request.

CREATE TABLE hospital_places (
  id         text COLLATE "C" PRIMARY KEY,
  name       text NOT NULL,
  -- `supervisoryOrgan` when it is one of shared/companyOrgans.ts, else null.
  organ      text,
  legal_form jsonb,
  -- Two-digit TERYT of the most specific seat, or '__NOREGION__'.
  woj        text NOT NULL
);

-- One row per person per hospital board: whether a published spell is open
-- (no end date) and the latest end of a published one; the same for spells
-- nobody has published.
CREATE TABLE hospital_seats (
  place_id   text COLLATE "C" NOT NULL,
  person_id  text COLLATE "C" NOT NULL,
  pub_open   boolean NOT NULL,
  pub_end    text COLLATE "C",
  draft_open boolean NOT NULL,
  draft_end  text COLLATE "C",
  PRIMARY KEY (place_id, person_id)
);

-- `isPublicHospital`, and the seat the by-województwo breakdown files a
-- hospital under: the most specific region (longest TERYT), the first by
-- edge id between two of one depth.
CREATE FUNCTION hospital_place_rows(ids text[] DEFAULT NULL)
RETURNS SETOF hospital_places LANGUAGE sql STABLE AS $$
  WITH place AS (
    SELECT n.id, n.data FROM public.nodes n
    WHERE n.type = 'place' AND n.is_approved AND public.jsonb_is_true(n.data -> 'isPublic')
      AND EXISTS (SELECT 1 FROM public.js_values(n.data -> 'categories') v WHERE v.elem = '"szpitale"')
      AND (ids IS NULL OR n.id = ANY(ids))
  ), seat AS (
    SELECT DISTINCT ON (e.target) e.target AS id, r.data ->> 'teryt' AS teryt
    FROM public.edges e JOIN place p ON p.id = e.target JOIN public.nodes r ON r.id = e.source
    WHERE e.type = 'seat' AND NOT e.deleted
      AND jsonb_typeof(r.data -> 'teryt') = 'string' AND r.data ->> 'teryt' <> ''
    ORDER BY e.target, length(r.data ->> 'teryt') DESC, e.id
  )
  SELECT p.id, coalesce(public.jsonb_text(p.data -> 'name'), p.id),
    CASE WHEN public.jsonb_text(p.data -> 'supervisoryOrgan') IN
      ('rada_nadzorcza', 'rada_spoleczna', 'komisja_rewizyjna', 'inny', 'nieznany', 'brak')
      THEN public.jsonb_text(p.data -> 'supervisoryOrgan') END,
    nullif(p.data -> 'legalForm', 'null'),
    CASE WHEN s.teryt ~ '^[0-9]{2,}$' THEN left(s.teryt, 2) ELSE '__NOREGION__' END
  FROM place p LEFT JOIN seat s ON s.id = p.id
$$;

-- `boardSeats` up to the day: the `employed` edges into a hospital whose
-- role is a board seat (`isSupervisoryRole`), removals left out. An end
-- date that is not a non-empty string never passes, as in JavaScript.
CREATE FUNCTION hospital_seat_rows(places text[] DEFAULT NULL)
RETURNS SETOF hospital_seats LANGUAGE sql STABLE AS $$
  WITH spell AS (
    SELECT e.target, e.source, e.is_approved AS published,
      CASE WHEN public.js_truthy(e.data -> 'end_date') THEN public.jsonb_text(e.data -> 'end_date') END AS ends
    FROM public.edges e
    WHERE e.type = 'employed' AND NOT e.deleted
      AND coalesce(e.source, '') <> '' AND coalesce(e.target, '') <> ''
      AND e.target IN (SELECT h.id FROM public.hospital_places h WHERE places IS NULL OR h.id = ANY(places))
      AND upper(public.js_squash(public.jsonb_text(e.data -> 'name'))) ~ '^RADA (NADZORCZA|SPOŁECZNA|SPOLECZNA)'
  )
  SELECT target, source,
    coalesce(bool_or(ends IS NULL) FILTER (WHERE published), false),
    max(ends) FILTER (WHERE published),
    coalesce(bool_or(ends IS NULL) FILTER (WHERE NOT published), false),
    max(ends) FILTER (WHERE NOT published)
  FROM spell GROUP BY target, source
$$;

-- The rows of both for every hospital, written only where they changed.
-- Returns the rows it changed.
CREATE FUNCTION refresh_hospital_stats() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint := 0; k bigint;
BEGIN
  CREATE TEMP TABLE fresh_hospitals ON COMMIT DROP AS SELECT * FROM public.hospital_place_rows();
  DELETE FROM public.hospital_places o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_hospitals f WHERE f.id = o.id
      AND (f.name, f.organ, f.legal_form, f.woj) IS NOT DISTINCT FROM (o.name, o.organ, o.legal_form, o.woj));
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  INSERT INTO public.hospital_places SELECT f.* FROM fresh_hospitals f
  WHERE NOT EXISTS (SELECT 1 FROM public.hospital_places o WHERE o.id = f.id);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DROP TABLE fresh_hospitals;

  CREATE TEMP TABLE fresh_seats ON COMMIT DROP AS SELECT * FROM public.hospital_seat_rows();
  DELETE FROM public.hospital_seats o WHERE NOT EXISTS (
    SELECT 1 FROM fresh_seats f WHERE f.place_id = o.place_id AND f.person_id = o.person_id
      AND (f.pub_open, f.pub_end, f.draft_open, f.draft_end)
        IS NOT DISTINCT FROM (o.pub_open, o.pub_end, o.draft_open, o.draft_end));
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  INSERT INTO public.hospital_seats SELECT f.* FROM fresh_seats f WHERE NOT EXISTS (
    SELECT 1 FROM public.hospital_seats o WHERE o.place_id = f.place_id AND o.person_id = f.person_id);
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DROP TABLE fresh_seats;
  RETURN n;
END $$;

-- The hospitals among `ids`, and those seated in a region among them.
CREATE FUNCTION refresh_hospital_stats_for(ids text[]) RETURNS bigint
LANGUAGE plpgsql SET plan_cache_mode = force_custom_plan AS $$
DECLARE places text[]; n bigint;
BEGIN
  places := ARRAY(SELECT unnest(ids) UNION
    SELECT e.target FROM public.edges e
    WHERE e.source = ANY(ids) AND e.type = 'seat' AND e.target IS NOT NULL);
  DELETE FROM public.hospital_seats s WHERE s.place_id = ANY(places);
  DELETE FROM public.hospital_places h WHERE h.id = ANY(places);
  INSERT INTO public.hospital_places SELECT * FROM public.hospital_place_rows(places);
  INSERT INTO public.hospital_seats SELECT * FROM public.hospital_seat_rows(places);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- `partyTail`: the parties first, then „Inne”, then nobody's.
CREATE FUNCTION hospital_party_tail(party text) RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE party WHEN '__NONE__' THEN 2 WHEN 'Inne' THEN 1 ELSE 0 END
$$;

-- The whole response of /api/stats/hospitals (`HospitalStats`) on `today`
-- (YYYY-MM-DD, UTC). Ties sort as the TypeScript's stable sorts leave
-- them: hospitals by id, regions by their first hospital.
CREATE FUNCTION hospital_stats(today text, generated_at text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
WITH place AS MATERIALIZED (
  SELECT h.*, CASE h.organ WHEN 'rada_nadzorcza' THEN 'paid' WHEN 'rada_spoleczna' THEN 'unpaid'
    ELSE 'other' END AS grp
  FROM public.hospital_places h
), spell AS MATERIALIZED (
  SELECT s.place_id, s.person_id, p.grp, p.woj,
    coalesce(s.pub_open OR s.pub_end >= today COLLATE "C", false) AS cur,
    coalesce(s.draft_open OR s.draft_end >= today COLLATE "C", false) AS draft_cur,
    s.pub_end IS NOT NULL AS pub_any
  FROM public.hospital_seats s JOIN place p ON p.id = s.place_id
), seat AS MATERIALIZED (
  SELECT *, NOT cur AND pub_any AS ended, NOT cur AND draft_cur AS unreviewed FROM spell
), held AS MATERIALIZED (
  -- The parties of the published people on a current seat, canonical
  -- (`canonicalParty`) and each once.
  SELECT DISTINCT n.id, CASE WHEN v.elem #>> '{}' = 'SLD' THEN 'Nowa Lewica' ELSE v.elem #>> '{}' END AS party
  FROM public.nodes n CROSS JOIN LATERAL public.js_values(n.data -> 'parties') v
  WHERE n.id IN (SELECT person_id FROM seat WHERE cur) AND n.is_approved
    AND jsonb_typeof(v.elem) = 'string' AND v.elem <> '""'
), cur_seat AS MATERIALIZED (
  SELECT s.place_id, s.person_id, s.grp, s.woj,
    EXISTS (SELECT 1 FROM held h WHERE h.id = s.person_id) AS with_party
  FROM seat s WHERE s.cur
), seat_party AS MATERIALIZED (
  SELECT c.place_id, c.person_id, c.grp, c.woj, coalesce(h.party, '__NONE__') AS party
  FROM cur_seat c LEFT JOIN held h ON h.id = c.person_id
), group_party AS (
  SELECT grp, jsonb_agg(jsonb_build_object('party', party, 'seats', seats, 'people', people,
      'hospitals', hospitals)
    ORDER BY public.hospital_party_tail(party), seats DESC, party COLLATE "und-x-icu") AS list
  FROM (SELECT grp, party, count(*) AS seats, count(DISTINCT person_id) AS people,
          count(DISTINCT place_id) AS hospitals
        FROM seat_party GROUP BY grp, party) x
  GROUP BY grp
), region_party AS (
  SELECT grp, woj, jsonb_agg(jsonb_build_object('party', party, 'seats', seats, 'people', people,
      'hospitals', hospitals)
    ORDER BY public.hospital_party_tail(party), seats DESC, party COLLATE "und-x-icu") AS list
  FROM (SELECT grp, woj, party, count(*) AS seats, count(DISTINCT person_id) AS people,
          count(DISTINCT place_id) AS hospitals
        FROM seat_party GROUP BY grp, woj, party) x
  GROUP BY grp, woj
), row_party AS (
  SELECT place_id,
    jsonb_agg(to_jsonb(party) ORDER BY public.hospital_party_tail(party), seats DESC,
      party COLLATE "und-x-icu") AS parties,
    jsonb_agg(jsonb_build_object('party', party, 'seats', seats, 'people', seats, 'hospitals', 1)
      ORDER BY public.hospital_party_tail(party), seats DESC, party COLLATE "und-x-icu") AS by_party
  FROM (SELECT place_id, party, count(*) AS seats FROM seat_party GROUP BY place_id, party) x
  GROUP BY place_id
), per_place AS MATERIALIZED (
  SELECT p.*,
    (SELECT count(*) FROM seat s WHERE s.place_id = p.id AND s.cur) AS seats,
    (SELECT count(*) FROM seat s WHERE s.place_id = p.id AND s.unreviewed) AS unreviewed
  FROM place p
), rows AS (
  SELECT p.grp, jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'supervisoryOrgan', p.organ, 'legalForm', p.legal_form,
      'seats', p.seats, 'unreviewed', p.unreviewed,
      'parties', coalesce(rp.parties, '[]'), 'byParty', coalesce(rp.by_party, '[]'))
    ORDER BY p.seats DESC, p.name COLLATE "und-x-icu", p.id) AS list
  FROM per_place p LEFT JOIN row_party rp ON rp.place_id = p.id
  GROUP BY p.grp
), woj_hospitals AS (
  SELECT woj, count(*) AS n FROM place GROUP BY woj
), region AS (
  SELECT p.grp, p.woj,
    CASE WHEN p.woj = '__NOREGION__' THEN 'Bez regionu w bazie'
      ELSE coalesce(
        (SELECT 'Województwo ' || lower(left(b, 1)) || substr(b, 2)
         FROM (SELECT regexp_replace(r.data ->> 'name', '^Województwo[[:space:]]+', '', 'i') AS b
               FROM public.nodes r
               WHERE r.id = 'teryt' || p.woj AND jsonb_typeof(r.data -> 'name') = 'string'
                 AND jsonb_typeof(r.data -> 'teryt') = 'string' AND r.data ->> 'teryt' = p.woj) x),
        'Województwo ' || p.woj) END AS name,
    count(*) AS group_hospitals,
    count(*) FILTER (WHERE p.seats > 0) AS with_seats,
    sum(p.seats) AS seats, sum(p.unreviewed) AS unreviewed,
    min(p.id) AS first
  FROM per_place p GROUP BY p.grp, p.woj
), regions AS (
  SELECT r.grp, jsonb_agg(jsonb_build_object(
      'teryt', r.woj, 'name', r.name, 'hospitals', w.n, 'groupHospitals', r.group_hospitals,
      'hospitalsWithSeats', r.with_seats, 'seats', r.seats, 'unreviewed', r.unreviewed,
      'seatsWithParty', (SELECT count(*) FROM cur_seat c WHERE c.grp = r.grp AND c.woj = r.woj AND c.with_party),
      'byParty', coalesce(rp.list, '[]'))
    ORDER BY r.woj = '__NOREGION__', r.seats + r.unreviewed DESC, r.name COLLATE "pl-x-icu", r.first) AS list
  FROM region r JOIN woj_hospitals w ON w.woj = r.woj
  LEFT JOIN region_party rp ON rp.grp = r.grp AND rp.woj = r.woj
  GROUP BY r.grp
), groups AS (
  SELECT g.grp, jsonb_build_object(
    'kinds', g.kinds,
    'hospitals', (SELECT count(*) FROM place p WHERE p.grp = g.grp),
    'hospitalsWithSeats', (SELECT count(*) FROM per_place p WHERE p.grp = g.grp AND p.seats > 0),
    'seats', (SELECT count(*) FROM seat s WHERE s.grp = g.grp AND s.cur),
    'endedSeats', (SELECT count(*) FROM seat s WHERE s.grp = g.grp AND s.ended),
    'seatsWithParty', (SELECT count(*) FROM cur_seat c WHERE c.grp = g.grp AND c.with_party),
    'unreviewed', (SELECT count(*) FROM seat s WHERE s.grp = g.grp AND s.unreviewed),
    'byParty', coalesce((SELECT list FROM group_party x WHERE x.grp = g.grp), '[]'),
    'rows', coalesce((SELECT list FROM rows x WHERE x.grp = g.grp), '[]'),
    'byRegion', coalesce((SELECT list FROM regions x WHERE x.grp = g.grp), '[]')) AS doc
  FROM (VALUES ('paid', '["rada_nadzorcza"]'::jsonb), ('unpaid', '["rada_spoleczna"]'),
    ('other', '["komisja_rewizyjna", "inny", "nieznany", "brak"]')) AS g(grp, kinds)
)
SELECT jsonb_build_object(
  'generatedAt', generated_at,
  'hospitals', (SELECT count(*) FROM place),
  'paid', (SELECT doc FROM groups WHERE grp = 'paid'),
  'unpaid', (SELECT doc FROM groups WHERE grp = 'unpaid'),
  'other', (SELECT doc FROM groups WHERE grp = 'other'))
$$;

-- node_stats' refreshes, now with the hospitals: 0601's bodies and one call.
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

  PERFORM public.refresh_hospital_stats();
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

  PERFORM public.refresh_hospital_stats_for(ids);
  RETURN n;
END $$;

SELECT refresh_hospital_stats();
