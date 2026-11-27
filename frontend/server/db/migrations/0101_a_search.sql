-- The name index /api/search reads, in place of the `nameChunksLower`
-- arrays Firestore needed (the migration drops them). A chunk of
-- `generateChunksLower` (shared/search.ts) is a prefix of one of three
-- things, so three stored columns and trigram indexes answer it with LIKE:
--
--   search_whole  the whole name as `searchableText` reads it: 'c%'
--   search_words  ' '-separated words of the name less its town bracket
--                 (only when there are several) and the parts of each word
--                 after a hyphen: '% c%'
--   search_town   the words of the town bracket (`QUALIFIER`) and their
--                 hyphen parts, for the '@' chunks: '% c%'
--
-- tests/parity/searchIndex.parity.test.ts checks them against the
-- TypeScript name by name.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Not used yet: matching without accents would change what the box finds.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- `searchableText`: composed, lowercased, everything but letters, digits,
-- whitespace and the hyphen turned into a space, whitespace flattened.
-- [:digit:] is 0-9 alone, so the other numbers of \p{N} that a name could
-- carry (superscripts, fractions, Roman and circled numerals) are listed.
CREATE FUNCTION search_text(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(lower(normalize(value, NFC)),
                   '[^[:alpha:][:digit:][:space:]²³¹¼-¾⁰-⁹₀-₉Ⅰ-ↈ①-⒛⓪-⓿❶-➓-]+', ' ', 'g'),
    '[[:space:]]+', ' ', 'g'), ' ')
$$;

-- Where the town bracket of a place or region name starts (`QUALIFIER`),
-- 0 where it has none.
CREATE FUNCTION search_town_at(name text, type text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN type IN ('place', 'region')
    THEN regexp_instr(name, '\(([^()]*[[:lower:]][^()]*)\)[[:space:]]*$')
    ELSE 0 END
$$;

-- Words of a searchable text (when `with_words`) and every part after a
-- hyphen of each, between single spaces and padded with one on each side.
CREATE FUNCTION search_parts(value text, with_words boolean) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ' ' || CASE WHEN with_words THEN value || ' ' ELSE '' END
    || coalesce((SELECT string_agg(part, ' ')
                 FROM unnest(string_to_array(value, ' ')) AS word,
                      unnest((string_to_array(word, '-'))[2:]) AS part
                 WHERE part <> ''), '')
    || ' '
$$;

CREATE FUNCTION search_words(name text, type text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT search_parts(called, called LIKE '% %')
  FROM (SELECT search_text(CASE WHEN search_town_at(name, type) > 0
          THEN left(name, search_town_at(name, type) - 1) ELSE name END)
        AS called) AS c
$$;

CREATE FUNCTION search_town(name text, type text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN search_town_at(name, type) > 0
    THEN search_parts(search_text((regexp_match(name,
      '\(([^()]*[[:lower:]][^()]*)\)[[:space:]]*$'))[1]), true)
    ELSE ' ' END
$$;

ALTER TABLE nodes
  ADD COLUMN search_whole text GENERATED ALWAYS AS
    (search_text(jsonb_text(data -> 'name'))) STORED,
  ADD COLUMN search_words text GENERATED ALWAYS AS
    (search_words(jsonb_text(data -> 'name'), jsonb_text(data -> 'type'))) STORED,
  ADD COLUMN search_town text GENERATED ALWAYS AS
    (search_town(jsonb_text(data -> 'name'), jsonb_text(data -> 'type'))) STORED;

CREATE INDEX nodes_search_whole ON nodes USING gin (search_whole gin_trgm_ops)
  WHERE type IN ('person', 'place', 'region');
CREATE INDEX nodes_search_words ON nodes USING gin (search_words gin_trgm_ops)
  WHERE type IN ('person', 'place', 'region');
CREATE INDEX nodes_search_town ON nodes USING gin (search_town gin_trgm_ops)
  WHERE type = ANY (ARRAY['place', 'region']);
-- The order the hits come in: `stats.nodeGroupSize` descending, then the id,
-- as Firestore gave them. A node without the field (a database loaded
-- without the nightly batch that writes it) comes last rather than not at
-- all, where Firestore's `orderBy` left it out.
CREATE FUNCTION search_rank(data jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(data #> '{stats,nodeGroupSize}') = 'number'
    THEN (data #>> '{stats,nodeGroupSize}')::numeric END
$$;
CREATE INDEX nodes_search_rank ON nodes (search_rank(data) DESC NULLS LAST, id DESC)
  WHERE type IN ('person', 'place', 'region');
