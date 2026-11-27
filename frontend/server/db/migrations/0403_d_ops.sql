-- The ops schema (`agent-tasks`): the equality filters of
-- the task list, the jobs page and the run requests, and the order of the
-- search log.
CREATE INDEX tasks_data ON ops.tasks USING gin (data jsonb_path_ops);
CREATE INDEX jobs_data ON ops.jobs USING gin (data jsonb_path_ops);
CREATE INDEX job_runs_data ON ops.job_runs USING gin (data jsonb_path_ops);
CREATE INDEX search_queries_at ON ops.search_queries ((data ->> 'at') COLLATE "C");

-- Firestore's TTL on `expireAt` (newsletter requests nobody confirmed, the
-- search log), which was set in the console and is no part of the
-- repository: deleted here by `expire_documents()`, which the server runs
-- every hour (server/plugins/expire-documents.ts).
CREATE INDEX search_queries_expire ON ops.search_queries ((data ->> 'expireAt') COLLATE "C");
CREATE INDEX newsletter_subscribers_expire
  ON newsletter_subscribers ((data ->> 'expireAt') COLLATE "C")
  WHERE data ? 'expireAt';

CREATE FUNCTION expire_documents() RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  cutoff text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  gone int;
  more int;
BEGIN
  DELETE FROM ops.search_queries
    WHERE (data ->> 'expireAt') COLLATE "C" < cutoff;
  GET DIAGNOSTICS gone = ROW_COUNT;
  DELETE FROM newsletter_subscribers
    WHERE data ? 'expireAt' AND (data ->> 'expireAt') COLLATE "C" < cutoff;
  GET DIAGNOSTICS more = ROW_COUNT;
  RETURN gone + more;
END $$;
