-- The indexes behind the handlers ported from Firestore to explicit SQL
-- (decision on 2026-11-26): the extraction facts, the admin summary's queues.
-- The declaration reads use the jsonb_path_ops indexes of 0401.

-- A value JavaScript calls truthy: present, and not null, false, 0 or "".
CREATE FUNCTION jsonb_truthy(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT value IS NOT NULL
    AND value NOT IN ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb)
$$;

-- /api/extractions: newest first, and one article's facts.
CREATE INDEX extractions_created ON extractions
  ((jsonb_text(data -> 'createdAt')) COLLATE "C" DESC, id DESC);
CREATE INDEX extractions_article ON extractions ((jsonb_text(data -> 'articleUrl')));

-- /api/admin/summary: nodes with a revision waiting, and the edge proposals.
CREATE INDEX nodes_has_unapproved ON nodes (id)
  WHERE data #> '{revisions,has_unapproved}' = 'true'::jsonb;
CREATE INDEX revisions_pending_edges ON revisions (update_time DESC, id DESC)
  WHERE data -> 'collection' = '"edges"'::jsonb AND data -> 'status' = '"pending"'::jsonb;
