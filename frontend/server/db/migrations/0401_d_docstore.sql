-- What the Firestore-shaped store of the time needed to run the
-- declarations, mail and ops code on the jsonb tables (its two write
-- functions go in 0930): a write's field operations applied in SQL (so an
-- increment or an array union stays atomic outside a transaction too), the
-- Firestore order of mixed types, and the indexes its filters use.

-- `value` at `path` inside `doc`, making the maps on the way (Firestore's
-- `update({"a.b": 1})` on a document without `a`).
CREATE FUNCTION docstore_set(doc jsonb, path text[], value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  IF coalesce(array_length(path, 1), 0) = 0 THEN
    RETURN value;
  END IF;
  IF doc IS NULL OR jsonb_typeof(doc) <> 'object' THEN
    doc := '{}'::jsonb;
  END IF;
  RETURN jsonb_set(doc, path[1:1],
    docstore_set(doc -> path[1], path[2:], value), true);
END $$;

-- Applies a write's operations in order: `[{p: path, o: op, v: value}]`,
-- op `s` sets, `d` deletes, `i` adds (FieldValue.increment), `u` and `r`
-- add and remove array elements (arrayUnion, arrayRemove).
CREATE FUNCTION docstore_patch(doc jsonb, ops jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  op jsonb;
  path text[];
  current jsonb;
  element jsonb;
BEGIN
  FOR op IN SELECT value FROM jsonb_array_elements(ops) LOOP
    path := ARRAY(SELECT jsonb_array_elements_text(op -> 'p'));
    CASE op ->> 'o'
      WHEN 's' THEN
        doc := docstore_set(doc, path, op -> 'v');
      WHEN 'd' THEN
        IF coalesce(array_length(path, 1), 0) > 0 THEN
          doc := doc #- path;
        END IF;
      WHEN 'i' THEN
        current := doc #> path;
        doc := docstore_set(doc, path, CASE
          WHEN jsonb_typeof(current) = 'number'
            THEN to_jsonb((current #>> '{}')::numeric + (op ->> 'v')::numeric)
          ELSE op -> 'v' END);
      WHEN 'u' THEN
        current := doc #> path;
        IF current IS NULL OR jsonb_typeof(current) <> 'array' THEN
          current := '[]'::jsonb;
        END IF;
        FOR element IN SELECT value FROM jsonb_array_elements(op -> 'v') LOOP
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(current) e WHERE e.value = element
          ) THEN
            current := current || jsonb_build_array(element);
          END IF;
        END LOOP;
        doc := docstore_set(doc, path, current);
      WHEN 'r' THEN
        current := doc #> path;
        IF current IS NULL OR jsonb_typeof(current) <> 'array' THEN
          current := '[]'::jsonb;
        END IF;
        doc := docstore_set(doc, path, coalesce((
          SELECT jsonb_agg(e.value ORDER BY e.ordinality)
          FROM jsonb_array_elements(current) WITH ORDINALITY e
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(op -> 'v') r WHERE r.value = e.value)
        ), '[]'::jsonb));
      ELSE
        RAISE EXCEPTION 'docstore_patch: unknown op %', op ->> 'o';
    END CASE;
  END LOOP;
  RETURN doc;
END $$;

-- Firestore orders values of different types by type first: null, boolean,
-- number, (timestamp,) string, (bytes, reference, geo point,) array, map.
-- Timestamps are ISO strings here, so they sort with the strings.
CREATE FUNCTION docstore_rank(value jsonb) RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'null' THEN 0 WHEN 'boolean' THEN 1 WHEN 'number' THEN 2
    WHEN 'string' THEN 4 WHEN 'array' THEN 8 WHEN 'object' THEN 9 END
$$;

CREATE FUNCTION docstore_num(value jsonb) RETURNS float8
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::float8 END
$$;

-- Equality filters compile to `data @> {...}`, which one GIN index a table
-- serves, whatever the field.
CREATE INDEX declaration_candidacies_data ON declaration_candidacies USING gin (data jsonb_path_ops);
CREATE INDEX declaration_extracts_data ON declaration_extracts USING gin (data jsonb_path_ops);
CREATE INDEX declaration_answers_data ON declaration_answers USING gin (data jsonb_path_ops);
CREATE INDEX declaration_reader_finds_data ON declaration_reader_finds USING gin (data jsonb_path_ops);
CREATE INDEX declaration_publications_data ON declaration_publications USING gin (data jsonb_path_ops);
CREATE INDEX declaration_links_data ON declaration_links USING gin (data jsonb_path_ops);
CREATE INDEX audit_data ON audit USING gin (data jsonb_path_ops);
CREATE INDEX article_pages_data ON article_pages USING gin (data jsonb_path_ops);

-- The reading queue (`nextTasks`): open crops by priority, the crops a vote
-- short of agreeing first, then at random. Typed columns so that the order is
-- an index scan.
ALTER TABLE declaration_extracts
  ADD COLUMN status text GENERATED ALWAYS AS (jsonb_text(data -> 'status')) STORED,
  ADD COLUMN priority float8 GENERATED ALWAYS AS (docstore_num(data -> 'priority')) STORED,
  ADD COLUMN answer_count float8 GENERATED ALWAYS AS (docstore_num(data -> 'answerCount')) STORED,
  ADD COLUMN rand float8 GENERATED ALWAYS AS (docstore_num(data -> 'rand')) STORED;
CREATE INDEX declaration_extracts_queue
  ON declaration_extracts (status, priority, answer_count DESC, rand, id);

-- A crop's answers that vote (`votingAnswersTo`) and a reader's own.
ALTER TABLE declaration_answers
  ADD COLUMN extract_id text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'extractId')) STORED,
  ADD COLUMN uid text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'uid')) STORED;
CREATE INDEX declaration_answers_extract ON declaration_answers (extract_id);
CREATE INDEX declaration_answers_uid ON declaration_answers (uid);
