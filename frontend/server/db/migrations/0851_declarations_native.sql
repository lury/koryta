-- The declarations flow on explicit SQL (decision on 2026-11-26: native
-- Postgres): the day counters it takes from, and the indexes its reads use.

-- One more on a day's counter (`{count, day}` in declaration_reader_limits or
-- declaration_publish_limits) while it is under `cap`: the new count, or null
-- when the counter is full. One statement, so two takers cannot both pass.
CREATE FUNCTION declaration_take_count(
  tbl regclass, doc_id text, day text, cap numeric, extra jsonb DEFAULT '{}'::jsonb
) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE taken numeric;
BEGIN
  IF cap <= 0 THEN RETURN NULL; END IF;
  EXECUTE format($q$
    INSERT INTO %s AS t (id, data)
    VALUES ($1, jsonb_build_object('count', 1, 'day', $2) || $4)
    ON CONFLICT (id) DO UPDATE
      SET data = t.data || jsonb_build_object(
            'count', coalesce(docstore_num(t.data -> 'count'), 0) + 1, 'day', $2) || $4,
          updated_at = clock_timestamp()
      WHERE coalesce(docstore_num(t.data -> 'count'), 0) < $3
    RETURNING docstore_num(data -> 'count')$q$, tbl)
  INTO taken USING doc_id, day, cap, extra;
  RETURN taken;
END $$;

-- The queue's pages of open crops, by the order /api/declarations/next reads.
CREATE INDEX declaration_extracts_open
  ON declaration_extracts (priority, answer_count DESC, rand, id) WHERE status = 'open';

-- A reader's finds, newest first (/api/declarations/found).
CREATE INDEX declaration_reader_finds_uid_at
  ON declaration_reader_finds ((jsonb_text(data -> 'uid')), (jsonb_text(data -> 'at')) COLLATE "C" DESC, id DESC);

-- The publication records by state and the instants the passes order by.
CREATE INDEX declaration_publications_status
  ON declaration_publications ((jsonb_text(data -> 'status')));

-- The audit rows of one page (`pageAudit`).
CREATE INDEX audit_target ON audit ((jsonb_text(data -> 'target_id')));
