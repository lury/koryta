-- Every extraction fact has a `createdAt`, and `created_at` is that instant:
-- /api/extractions orders by the column and leaves no fact out.
--
-- A fact stored without one is given, in this order:
--   1. the time of the extraction run it came from: the capture
--      (article_pages) of its article with the fact's tag, its
--      `extraction.finishedAt`, else `extraction.startedAt`, else `capturedAt`;
--   2. the date of its article: `publishedDate` of the node `articleNodeId`
--      names, else of the article node whose `sourceURL` is `articleUrl`;
--   3. the time its row was loaded (`created_at` as it stood).
-- The value goes into the document too, so that the API shows the order it
-- sorts by.

-- A stored instant (an ISO string) as a timestamptz; null for anything else.
CREATE FUNCTION jsonb_instant(value jsonb) RETURNS timestamptz
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
BEGIN
  IF jsonb_typeof(value) <> 'string' THEN RETURN NULL; END IF;
  RETURN (value #>> '{}')::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

-- An instant as JavaScript's `toISOString` writes it.
CREATE FUNCTION iso_instant(value timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE INDEX nodes_article_url ON nodes ((jsonb_text(data -> 'sourceURL')))
  WHERE type = 'article';

-- Sources 1 and 2 above for one fact's document; null when neither is known.
CREATE FUNCTION extraction_source_time(fact jsonb) RETURNS timestamptz
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(
    (SELECT coalesce(
        jsonb_instant(p.data #> '{extraction,finishedAt}'),
        jsonb_instant(p.data #> '{extraction,startedAt}'),
        jsonb_instant(p.data -> 'capturedAt'))
     FROM article_pages p
     WHERE (p.data @> jsonb_build_object('url', fact -> 'articleUrl')
         OR p.data @> jsonb_build_object('normalizedUrl', fact -> 'articleUrl'))
       AND p.data #> '{extraction,tag}' = fact -> 'tag'
     ORDER BY p.id LIMIT 1),
    (SELECT jsonb_instant(n.data -> 'publishedDate') FROM nodes n
     WHERE n.id = jsonb_text(fact -> 'articleNodeId')),
    (SELECT jsonb_instant(n.data -> 'publishedDate') FROM nodes n
     WHERE n.type = 'article'
       AND jsonb_text(n.data -> 'sourceURL') = jsonb_text(fact -> 'articleUrl')
       AND jsonb_instant(n.data -> 'publishedDate') IS NOT NULL
     ORDER BY n.id LIMIT 1))
$$;

UPDATE extractions SET created_at = coalesce(
  jsonb_instant(data -> 'createdAt'), extraction_source_time(data), created_at);
UPDATE extractions
  SET data = data || jsonb_build_object('createdAt', iso_instant(created_at))
  WHERE jsonb_instant(data -> 'createdAt') IS NULL;

COMMENT ON COLUMN extractions.created_at IS
  'The fact''s createdAt (0901_extraction_created_at.sql), kept by extractions_created_at.';

-- Keeps the column and the document's field one value, whoever writes: a
-- document with a `createdAt` sets the column; one without gets the column's
-- (the source time or now() for a new row, the old value on an update).
CREATE FUNCTION extractions_created_at() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE given timestamptz := jsonb_instant(NEW.data -> 'createdAt');
BEGIN
  IF given IS NOT NULL THEN
    NEW.created_at := given;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
  ELSE
    NEW.created_at := coalesce(extraction_source_time(NEW.data), NEW.created_at);
  END IF;
  NEW.data := NEW.data || jsonb_build_object('createdAt', iso_instant(NEW.created_at));
  RETURN NEW;
END
$$;
CREATE TRIGGER extractions_created_at BEFORE INSERT OR UPDATE ON extractions
  FOR EACH ROW EXECUTE FUNCTION extractions_created_at();

DROP INDEX extractions_created;
CREATE INDEX extractions_created ON extractions (created_at DESC, id DESC);
