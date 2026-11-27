-- The statements of the mail, newsletter and ops code (server/db/mail.ts,
-- server/db/ops.ts), ported from the document store (decision on 2026-11-26).

-- `arr` with each of `items` it does not hold yet appended, in order: what
-- Firestore's arrayUnion did. Anything but an array counts as empty.
CREATE FUNCTION jsonb_array_union(arr jsonb, items jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE element jsonb;
BEGIN
  IF arr IS NULL OR jsonb_typeof(arr) <> 'array' THEN arr := '[]'::jsonb; END IF;
  FOR element IN SELECT value FROM jsonb_array_elements(items) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(arr) e WHERE e.value = element) THEN
      arr := arr || jsonb_build_array(element);
    END IF;
  END LOOP;
  RETURN arr;
END $$;

-- `a` with the fields of `b` over it, maps merged field by field: a
-- Firestore `set(…, {merge: true})`.
CREATE FUNCTION jsonb_merge_deep(a jsonb, b jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE k text; v jsonb;
BEGIN
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR jsonb_typeof(b) IS DISTINCT FROM 'object' THEN
    RETURN b;
  END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(b) LOOP
    a := a || jsonb_build_object(k,
      CASE WHEN jsonb_typeof(v) = 'object' THEN jsonb_merge_deep(a -> k, v) ELSE v END);
  END LOOP;
  RETURN a;
END $$;

-- The newest reported runs (`reportedRuns`), the runs of a page
-- (`runsForNode`) and the captures of /admin/procesy.
CREATE INDEX job_runs_started ON ops.job_runs
  ((jsonb_text(data -> 'startedAt')) COLLATE "C" DESC, id DESC);
CREATE INDEX article_pages_captured ON article_pages
  ((jsonb_text(data -> 'capturedAt')) COLLATE "C" DESC, id DESC);
