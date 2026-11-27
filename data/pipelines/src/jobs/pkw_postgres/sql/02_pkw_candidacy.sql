-- PeoplePKW's candidacies (`person_pkw`) as views over `pkw_raw`.
--
-- Each step is the Python one it names, in `scrapers.pkw`: the header rules
-- of `headers.py`, `process_csv`'s choice between two columns of one field,
-- `extract_data`, `with_runoff` and `offices.local_office`. Functions call
-- each other schema-qualified: PG 17 builds indexes and refreshes
-- materialized views with search_path = pg_catalog.

CREATE SCHEMA IF NOT EXISTS pkw;

-- A cell pandas read as NaN, as a processor passes it on: not None, and true.
CREATE OR REPLACE FUNCTION pkw.nan() RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT '{"$nan": true}'::jsonb $$;

-- str(value) of the Python value a jsonb stands for.
CREATE OR REPLACE FUNCTION pkw.pystr(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN v IS NULL OR v = 'null'::jsonb THEN 'None'
    WHEN v = pkw.nan() THEN 'nan'
    WHEN jsonb_typeof(v) = 'string' THEN v #>> '{}'
    WHEN v = 'true'::jsonb THEN 'True'
    WHEN v = 'false'::jsonb THEN 'False'
    ELSE v #>> '{}'
  END
$$;

-- A string value, or null for anything else.
CREATE OR REPLACE FUNCTION pkw.str(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(v) = 'string' THEN v #>> '{}' END
$$;

-- str.strip(): whitespace off both ends, Unicode's as Python counts it - a
-- 1998 committee ends in three no-break spaces, which `\s` alone leaves.
CREATE OR REPLACE FUNCTION pkw.strip(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(t, '^[\s\u0085   -     　\u001c-\u001f]+|[\s\u0085   -     　\u001c-\u001f]+$', '', 'g')
$$;

-- What strip_if_not_none takes as text: a string, or a bool as str(bool) -
-- 16 surnames in the 1998, 2002 and 2014 council workbooks are TRUE cells.
CREATE OR REPLACE FUNCTION pkw.text_cell(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN jsonb_typeof(v) = 'string' THEN v #>> '{}'
    WHEN v = 'true'::jsonb THEN 'True'
    WHEN v = 'false'::jsonb THEN 'False'
  END
$$;

-- bool(value) in Python.
CREATE OR REPLACE FUNCTION pkw.truthy(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN v IS NULL OR v = 'null'::jsonb THEN false
    WHEN jsonb_typeof(v) = 'string' THEN v <> '""'::jsonb
    WHEN jsonb_typeof(v) = 'number' THEN (v #>> '{}')::numeric <> 0
    WHEN jsonb_typeof(v) = 'boolean' THEN v = 'true'::jsonb
    ELSE true
  END
$$;

-- int(value) for an int, an integral float or a string of digits; else null.
CREATE OR REPLACE FUNCTION pkw.pyint(v jsonb) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN jsonb_typeof(v) = 'number' THEN trunc((v #>> '{}')::numeric)::bigint
    WHEN jsonb_typeof(v) = 'string' AND v #>> '{}' ~ '^\s*[+-]?\d+\s*$'
      THEN pkw.strip(v #>> '{}')::bigint
  END
$$;

-- headers.lookup_teryt: an okręg's number to the TERYT of its seat.
CREATE OR REPLACE FUNCTION pkw.district_teryt(v jsonb, year text, kind text) RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN kind = 'samorządu' OR year::int < 2000 THEN '""'::jsonb
    WHEN pkw.pyint(v) IS NULL AND kind = 'europarlamentu' THEN '""'::jsonb
    ELSE (SELECT to_jsonb(d.teryt) FROM pkw_raw.district_teryt d
          WHERE d.election_year = year AND d.election_type = kind
            AND d.district = pkw.pyint(v)::text)
  END
$$;

-- headers.lookup_teryt_from_city: a seat's name, less a trailing Roman number.
CREATE OR REPLACE FUNCTION pkw.city_teryt(v jsonb) RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT to_jsonb(substr(c.teryt, 1, 2)) FROM pkw_raw.city_teryt c
  WHERE c.city = regexp_replace(rtrim(pkw.pystr(v), 'I'), '\s+$', '')
$$;

-- headers.parse_mandate: a letter naming how the seat was taken, or none.
CREATE OR REPLACE FUNCTION pkw.mandate(v jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN v IS NULL OR v = 'null'::jsonb OR v = pkw.nan() THEN '"FALSE"'::jsonb
    WHEN pkw.strip(pkw.pystr(v)) IN ('T', 'W', 'G', 'B', 'L', 'P', 'O', 'K') THEN '"TRUE"'::jsonb
    WHEN pkw.strip(pkw.pystr(v)) IN ('N', '', 'nan', '2') THEN '"FALSE"'::jsonb
  END
$$;

-- What the processor of a column makes of one of its cells (`SetField`).
CREATE OR REPLACE FUNCTION pkw.apply_rule(rule text, arg text, v jsonb, year text, kind text)
RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE rule
    WHEN 'identity' THEN v
    WHEN 'const' THEN to_jsonb(arg)
    WHEN 'sex' THEN CASE pkw.pystr(v)
      WHEN 'K' THEN '"F"' WHEN 'M' THEN '"M"' WHEN 'Mężczyzna' THEN '"M"' WHEN 'Kobieta' THEN '"F"'
    END::jsonb
    WHEN 'yes_no' THEN CASE
      WHEN v = pkw.nan() THEN '"FALSE"'::jsonb
      WHEN pkw.pystr(v) IN ('Tak', 'T') THEN '"TRUE"'::jsonb
      WHEN pkw.pystr(v) IN ('Nie', 'N', '2', 'nan', '2 tura') THEN '"FALSE"'::jsonb
    END
    WHEN 'mandate' THEN pkw.mandate(v)
    WHEN 'runoff_mandate' THEN CASE
      WHEN v = pkw.nan() OR pkw.strip(pkw.pystr(v)) = '' THEN 'null'::jsonb
      ELSE pkw.mandate(v)
    END
    WHEN 'district_teryt' THEN pkw.district_teryt(v, year, kind)
    WHEN 'city_teryt' THEN pkw.city_teryt(v)
  END
$$;

-- util.polish.parse_name: a whole name as one format writes it, as
-- (first, middle, last); '' where the format leaves one out.
CREATE OR REPLACE FUNCTION pkw.parse_name(name text, format text, OUT first text, OUT middle text, OUT last text)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  upper_class constant text := '[-A-ZĘẞÃŻŃŚŠĆČÜÖÓŁŹŽĆĄÁŇŚÑŠÁÉÇŐŰÝŸÄṔÍŢİŞÇİŅ'']';
  words text[];
  found text;
  rest text;
BEGIN
  IF name IS NULL THEN
    RETURN;
  END IF;
  first := ''; middle := ''; last := '';
  IF format = 'First_Last' THEN
    words := string_to_array(name, ' ');
    last := words[cardinality(words)];
    first := words[1];
    IF cardinality(words) > 2 THEN
      middle := array_to_string(words[2:cardinality(words) - 1], ' ');
    END IF;
  ELSIF format IN ('First_LAST', 'LAST_First') THEN
    IF format = 'First_LAST' THEN
      found := (regexp_match(name, '((?: ' || upper_class || '+)+)$'))[1];
      rest := pkw.strip(left(name, length(name) - length(found)));
    ELSE
      found := (regexp_match(name, '^((?:' || upper_class || '+ )+)'))[1];
      rest := pkw.strip(substr(name, length(found) + 1));
    END IF;
    IF found IS NULL THEN
      RAISE EXCEPTION 'Invalid name: %', name;
    END IF;
    last := pkw.strip(found);
    IF rest <> '' THEN
      words := string_to_array(rest, ' ');
      first := words[1];
      IF cardinality(words) > 1 THEN
        middle := array_to_string(words[2:], ' ');
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported format: %', name;
  END IF;
END
$$;

-- process.given_names: the names alone, without a patronymic or commas.
CREATE OR REPLACE FUNCTION pkw.given_names(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(regexp_replace(t, ',?\s*\y[sc]\.\s*\S+', '', 'g'), '\s*,\s*', ' ', 'g')
$$;

-- process.statement: a membership or backing cell as text, its spacing settled.
CREATE OR REPLACE FUNCTION pkw.statement(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN v IS NULL OR v = 'null'::jsonb OR v = pkw.nan() THEN NULL
    WHEN jsonb_typeof(v) = 'number' AND (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
      THEN nullif(trunc((v #>> '{}')::numeric)::text, '')
    ELSE nullif(array_to_string(regexp_split_to_array(pkw.strip(pkw.pystr(v)), '[\s\u0085   -     　\u001c-\u001f]+'), ' '), '')
  END
$$;

-- affiliations.membership_and_backing: a membership cell split into the
-- membership it states and the backing written into it too.
CREATE OR REPLACE FUNCTION pkw.membership_and_backing(cell text, OUT membership text, OUT backing text)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  quotes constant text := '["''„”“«»]';
  at int;
BEGIN
  IF cell IS NULL OR cell = '' THEN
    RETURN;
  END IF;
  IF length(cell) > 1 AND left(cell, 1) ~ ('^' || quotes || '$') AND right(cell, 1) ~ ('^' || quotes || '$') THEN
    cell := substr(cell, 2, length(cell) - 2);
  END IF;
  at := regexp_instr(cell, '(?<!\w)(?:popierany|popierana|popierane|popierani|pop\.)(?=\s|$)', 1, 1, 0, 'i');
  IF at = 0 THEN
    membership := cell;
    RETURN;
  END IF;
  membership := nullif(btrim(regexp_replace(left(cell, at - 1), quotes, '', 'g'), ' ,;'), '');
  backing := nullif(pkw.strip(substr(cell, at)), '');
END
$$;

-- offices.teryt_code: a TERYT as its six digits.
CREATE OR REPLACE FUNCTION pkw.teryt_code(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN jsonb_typeof(v) = 'number' THEN lpad(trunc((v #>> '{}')::numeric)::text, 6, '0')
    WHEN jsonb_typeof(v) = 'string' THEN pkw.strip(v #>> '{}')
  END
$$;

-- One row of a list as `process_csv` maps it: {field: processed value}. Of
-- two columns for one field the later wins if it says anything, else the
-- earlier stays.
CREATE MATERIALIZED VIEW IF NOT EXISTS pkw.mapped AS
WITH cells AS (
  SELECT r.source, r.row_no, h.field, h.ordinal,
         pkw.apply_rule(h.rule, h.arg,
                        CASE WHEN r.data -> h.header = 'null'::jsonb THEN pkw.nan()
                             ELSE r.data -> h.header END,
                        s.election_year, s.election_type) AS val
  FROM pkw_raw.row r
  JOIN pkw_raw.source s ON s.source = r.source
  JOIN pkw_raw.header_rule h ON h.source = r.source AND h.field IS NOT NULL
), fields AS (
  SELECT source, row_no, field,
         coalesce(
           (array_agg(jsonb_build_array(val) ORDER BY ordinal DESC) FILTER (WHERE pkw.truthy(val)))[1],
           (array_agg(jsonb_build_array(val) ORDER BY ordinal))[1]
         ) -> 0 AS val
  FROM cells
  GROUP BY source, row_no, field
)
SELECT source, row_no, jsonb_object_agg(field, coalesce(val, 'null'::jsonb)) AS m
FROM fields
GROUP BY source, row_no
-- Filled by the refresh, not when the schema is applied.
WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS mapped_row ON pkw.mapped (source, row_no);

-- process.extract_data, one row of a list to one candidacy.
CREATE OR REPLACE VIEW pkw.extracted AS
WITH named AS (
  SELECT x.source, x.row_no, s.ordinal, s.runoff_of, s.election_year, s.election_type, x.m,
         n.first AS p_first, n.middle AS p_middle, n.last AS p_last,
         (x.m ? 'pkw_name' AND x.m -> 'pkw_name' <> 'null'::jsonb) AS has_pkw_name
  FROM pkw.mapped x
  JOIN pkw_raw.source s ON s.source = x.source
  -- A LATERAL call runs before its ON, so a row without a whole name passes null.
  CROSS JOIN LATERAL pkw.parse_name(
    CASE WHEN x.m ? 'pkw_name' AND x.m -> 'pkw_name' <> 'null'::jsonb
         THEN pkw.pystr(x.m -> 'pkw_name') END,
    s.name_format) n
), names AS (
  SELECT *,
    CASE WHEN has_pkw_name THEN to_jsonb(p_first)
         WHEN jsonb_typeof(m -> 'first_name') = 'string' THEN to_jsonb(pkw.given_names(m ->> 'first_name'))
         ELSE m -> 'first_name' END AS first0,
    CASE WHEN has_pkw_name THEN to_jsonb(p_middle)
         WHEN jsonb_typeof(m -> 'middle_name') = 'string'
           THEN coalesce(to_jsonb(nullif(pkw.given_names(m ->> 'middle_name'), '')), 'null'::jsonb)
         ELSE m -> 'middle_name' END AS middle0,
    CASE WHEN has_pkw_name THEN to_jsonb(p_last) ELSE m -> 'last_name' END AS last0
  FROM named
), split AS (
  SELECT *,
    CASE WHEN jsonb_typeof(first0) = 'string' AND strpos(first0 #>> '{}', ' ') > 0
         THEN to_jsonb(split_part(first0 #>> '{}', ' ', 1)) ELSE first0 END AS first1,
    CASE WHEN jsonb_typeof(first0) = 'string' AND strpos(first0 #>> '{}', ' ') > 0
         THEN to_jsonb(substr(first0 #>> '{}', strpos(first0 #>> '{}', ' ') + 1)) ELSE middle0 END AS middle1,
    CASE WHEN has_pkw_name THEN m -> 'pkw_name'
         ELSE to_jsonb(pkw.pystr(last0) || ' ' || pkw.pystr(first0)) END AS pkw_name0
  FROM names
), stated AS (
  SELECT *, pkw.statement(m -> 'party_member') AS member0, pkw.statement(m -> 'supported_by') AS backed0
  FROM split
)
SELECT
  source, row_no, ordinal, runoff_of,
  election_year,
  election_type,
  nullif(m -> 'sex', pkw.nan()) AS sex,
  CASE WHEN m ? 'age' AND m -> 'age' <> 'null'::jsonb
       THEN election_year::int - pkw.pyint(m -> 'age') END AS birth_year,
  nullif(m -> 'age', pkw.nan()) AS age,
  nullif(m -> 'teryt_candidacy', pkw.nan()) AS teryt_candidacy,
  nullif(m -> 'teryt_living', pkw.nan()) AS teryt_living,
  pkw.str(m -> 'candidacy_success') AS candidacy_success,
  pkw.strip(pkw.text_cell(m -> 'party')) AS party,
  pkw.strip(pkw.text_cell(m -> 'position')) AS position,
  pkw.strip(pkw.text_cell(pkw_name0)) AS pkw_name,
  pkw.strip(pkw.text_cell(first1)) AS first_name,
  pkw.strip(pkw.text_cell(middle1)) AS middle_name,
  pkw.strip(pkw.text_cell(last0)) AS last_name,
  CASE WHEN backed0 IS NULL THEN (pkw.membership_and_backing(member0)).membership ELSE member0 END AS party_member,
  CASE WHEN backed0 IS NULL THEN (pkw.membership_and_backing(member0)).backing ELSE backed0 END AS supported_by
FROM stated;

-- process.with_runoff and offices.local_office: the first round's
-- candidacies, each settled by the run-off row tied to it, then the run-off
-- rows tied to none, each list in `sources` order.
CREATE MATERIALIZED VIEW IF NOT EXISTS pkw.candidacy AS
WITH e AS (
  SELECT x.*,
         coalesce(x.position, '\x01') || '\x02' || coalesce(x.pkw_name, '\x01') || '\x02'
           || coalesce(pkw.teryt_code(x.teryt_candidacy), '\x01') AS entry
  FROM pkw.extracted x
), first_round AS (
  SELECT e.*, count(*) OVER (PARTITION BY source, entry) AS same
  FROM e WHERE runoff_of IS NULL
), second_round AS (
  SELECT e.*, row_number() OVER (PARTITION BY source, entry ORDER BY row_no) AS nth
  FROM e WHERE runoff_of IS NOT NULL
), tied AS (
  SELECT r.runoff_of AS source, r.entry, r.candidacy_success, r.source AS runoff_source, r.row_no AS runoff_row
  FROM second_round r
  JOIN first_round f ON f.source = r.runoff_of AND f.entry = r.entry AND f.same = 1
  WHERE r.nth = 1
), settled AS (
  SELECT f.ordinal, 0 AS part, f.row_no, f.source, f.row_no AS source_row,
         f.election_year, f.election_type, f.sex, f.birth_year, f.age, f.teryt_candidacy, f.teryt_living,
         coalesce(t.candidacy_success, f.candidacy_success) AS candidacy_success,
         f.party, f.position, f.pkw_name, f.first_name, f.middle_name, f.last_name,
         f.party_member, f.supported_by
  FROM first_round f
  LEFT JOIN tied t ON t.source = f.source AND t.entry = f.entry AND f.same = 1
  UNION ALL
  SELECT p.ordinal, 1, r.row_no, r.source, r.row_no,
         r.election_year, r.election_type, r.sex, r.birth_year, r.age, r.teryt_candidacy, r.teryt_living,
         r.candidacy_success, r.party, r.position, r.pkw_name, r.first_name, r.middle_name, r.last_name,
         r.party_member, r.supported_by
  FROM second_round r
  JOIN pkw_raw.source p ON p.source = r.runoff_of
  WHERE NOT EXISTS (SELECT 1 FROM tied t WHERE t.runoff_source = r.source AND t.runoff_row = r.row_no)
)
SELECT
  row_number() OVER (ORDER BY s.ordinal, s.part, s.row_no) AS n,
  s.source, s.source_row,
  s.election_year, s.election_type, s.sex, s.birth_year, s.age, s.teryt_candidacy, s.teryt_living,
  s.candidacy_success, s.party, s.position, s.pkw_name, s.first_name, s.middle_name, s.last_name,
  s.party_member, s.supported_by,
  CASE WHEN s.election_type <> 'samorządu' THEN NULL
       WHEN pkw.strip(coalesce(s.position, '')) <> '' THEN
         CASE array_to_string(regexp_split_to_array(lower(pkw.strip(s.position)), '\s+'), ' ')
           WHEN 'rada sejmiku' THEN 'Sejmik'
           WHEN 'rada dzielnicy' THEN 'Rada dzielnicy'
           ELSE CASE split_part(array_to_string(regexp_split_to_array(lower(pkw.strip(s.position)), '\s+'), ' '), ' ', 1)
             WHEN 'w' THEN 'Wójt' WHEN 'wójt' THEN 'Wójt'
             WHEN 'b' THEN 'Burmistrz' WHEN 'burmistrz' THEN 'Burmistrz'
             WHEN 'p' THEN 'Prezydent' WHEN 'prezydent' THEN 'Prezydent'
           END
         END
       WHEN pkw.teryt_code(s.teryt_candidacy) !~ '^\d{6}$' THEN NULL
       WHEN pkw.teryt_code(s.teryt_candidacy) LIKE '%0000' THEN 'Sejmik'
       WHEN pkw.teryt_code(s.teryt_candidacy) LIKE '%00' THEN 'Rada powiatu'
       ELSE (SELECT CASE g.kind WHEN '1' THEN 'Rada miasta' WHEN '2' THEN 'Rada gminy'
                                WHEN '3' THEN 'Rada gminy' WHEN '8' THEN 'Rada dzielnicy' END
             FROM pkw_raw.gmina_kind g WHERE g.teryt = pkw.teryt_code(s.teryt_candidacy))
  END AS office
FROM settled s
WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS candidacy_n ON pkw.candidacy (n);
CREATE INDEX IF NOT EXISTS candidacy_year_type ON pkw.candidacy (election_year, election_type);
CREATE INDEX IF NOT EXISTS candidacy_name_birth ON pkw.candidacy (last_name, first_name, birth_year);

CREATE OR REPLACE FUNCTION pkw.refresh() RETURNS void
LANGUAGE sql AS $$
  REFRESH MATERIALIZED VIEW pkw.mapped;
  REFRESH MATERIALIZED VIEW pkw.candidacy;
$$;
