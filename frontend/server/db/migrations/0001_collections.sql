-- One table per Firestore collection: the document id and the document as
-- jsonb (decision on 2026-11-26: lift and shift, not a relational redesign).
-- Generated columns only for the fields the hot paths filter, join and sort
-- on (docs/postgres/README.md, "Indeksy").
--
-- Ids are COLLATE "C" so that ordering by id is byte order, as Firestore's
-- `__name__` order is, and the primary key serves it.

CREATE FUNCTION jsonb_is_true(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(value = 'true'::jsonb, false) $$;

-- A string field, or null when it holds anything else.
CREATE FUNCTION jsonb_text(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}' END
$$;

CREATE TABLE nodes (
  id          text COLLATE "C" PRIMARY KEY,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  type        text GENERATED ALWAYS AS (jsonb_text(data -> 'type')) STORED,
  deleted     boolean GENERATED ALWAYS AS (jsonb_is_true(data -> 'deleted')) STORED,
  -- pageIsPublic (shared/model.ts), what `stats.isApproved` stores.
  is_approved boolean GENERATED ALWAYS AS
    (jsonb_is_true(data -> 'published') AND NOT jsonb_is_true(data -> 'deleted')) STORED
);
CREATE INDEX nodes_type_id ON nodes (type, id) WHERE NOT deleted;
CREATE INDEX nodes_type_approved ON nodes (type, id) WHERE is_approved;
CREATE INDEX nodes_parties ON nodes USING gin ((data -> 'parties')) WHERE type = 'person';
CREATE INDEX nodes_categories ON nodes USING gin ((data -> 'categories')) WHERE type = 'place';
CREATE INDEX nodes_krs ON nodes ((data ->> 'krsNumber')) WHERE type = 'place';
CREATE INDEX nodes_teryt ON nodes ((data ->> 'teryt') text_pattern_ops) WHERE type = 'region';

CREATE TABLE edges (
  id          text COLLATE "C" PRIMARY KEY,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  type        text GENERATED ALWAYS AS (jsonb_text(data -> 'type')) STORED,
  source      text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'source')) STORED,
  target      text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'target')) STORED,
  deleted     boolean GENERATED ALWAYS AS (jsonb_is_true(data -> 'deleted')) STORED,
  is_approved boolean GENERATED ALWAYS AS
    (jsonb_is_true(data -> 'published') AND NOT jsonb_is_true(data -> 'deleted')) STORED
);
CREATE INDEX edges_source ON edges (source, type) WHERE NOT deleted;
CREATE INDEX edges_target ON edges (target, type) WHERE NOT deleted;

CREATE TABLE revisions (
  id          text COLLATE "C" PRIMARY KEY,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- `nodeId` is the name revisions were filed under before `node_id`.
  node_id     text COLLATE "C" GENERATED ALWAYS AS
    (coalesce(jsonb_text(data -> 'node_id'), jsonb_text(data -> 'nodeId'))) STORED,
  -- ISO 8601 after the migration's normalisation, so it sorts as text.
  update_time text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'update_time')) STORED
);
CREATE INDEX revisions_node_time ON revisions (node_id, update_time DESC);

CREATE TABLE votes (
  id            text COLLATE "C" PRIMARY KEY,
  data          jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  node_id       text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'nodeId')) STORED,
  extraction_id text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'extractionId')) STORED,
  user_uid      text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'userUid')) STORED
);
CREATE INDEX votes_node ON votes (node_id) WHERE node_id IS NOT NULL;
CREATE INDEX votes_extraction ON votes (extraction_id) WHERE extraction_id IS NOT NULL;
CREATE INDEX votes_user ON votes (user_uid);

CREATE TABLE notes (
  id          text COLLATE "C" PRIMARY KEY,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  node_id     text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'nodeId')) STORED,
  user_uid    text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'userUid')) STORED
);
CREATE INDEX notes_node ON notes (node_id);
CREATE INDEX notes_user ON notes (user_uid);

CREATE TABLE extractions (
  id             text COLLATE "C" PRIMARY KEY,
  data           jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  person_node_id text COLLATE "C" GENERATED ALWAYS AS (jsonb_text(data -> 'personNodeId')) STORED
);
CREATE INDEX extractions_person ON extractions (person_node_id) WHERE person_node_id IS NOT NULL;

-- The rest of `koryta-pl`, id and document only until a port needs an index.
-- `edgeStatsDirty` and `nodeContentDirty` are not here: they are markers for
-- the minute sweep, which the views in 0002 replace.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'article_pages', 'feedback', 'feedback_limits', 'newsletter_limits',
    'comments', 'audit', 'users', 'mail', 'mail_campaigns', 'mail_tokens',
    'newsletter_subscribers', 'activity_daily', 'qa_releases', 'qa_checks',
    'stats', 'declaration_candidacies', 'declaration_extracts',
    'declaration_extract_images', 'declaration_answers',
    'declaration_reader_limits', 'declaration_reader_finds',
    'declaration_publications', 'declaration_publish_limits',
    'declaration_links', 'declaration_people'
  ] LOOP
    EXECUTE format(
      'CREATE TABLE %I (id text COLLATE "C" PRIMARY KEY, data jsonb NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now())', t);
  END LOOP;
END $$;

-- The `agent-tasks` database, which no reader of the site may touch.
CREATE SCHEMA ops;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks', 'jobs', 'job_runs', 'search_queries'] LOOP
    EXECUTE format(
      'CREATE TABLE ops.%I (id text COLLATE "C" PRIMARY KEY, data jsonb NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now())', t);
  END LOOP;
END $$;
