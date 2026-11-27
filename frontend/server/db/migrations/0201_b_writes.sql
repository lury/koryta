-- What the revision, publication and ingest writes (package B) look up.

-- A name with its Polish letters written plain, as `withoutDiacritics`
-- (shared/names.ts) leaves it, for the namesake lookup of the person ingest
-- that Firestore answered from `nameChunksLower` (server/db/store.ts).
CREATE FUNCTION polish_fold(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT translate(value, 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ')
$$;
