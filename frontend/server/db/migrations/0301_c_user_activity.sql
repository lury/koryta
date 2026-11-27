-- Package C: the indexes behind a person's own record (/api/me's
-- contributions, /api/interactions/mine), the activity feed's window scans,
-- comments by page and the feedback queue. ISO times sort as text in "C".

CREATE INDEX revisions_update_user ON revisions
  ((data ->> 'update_user') COLLATE "C", update_time DESC);
CREATE INDEX revisions_human_time ON revisions (update_time DESC)
  WHERE data -> 'update_automatic' = 'false'::jsonb;

CREATE INDEX votes_user_time ON votes
  (user_uid, ((data ->> 'updatedAt') COLLATE "C") DESC);
CREATE INDEX votes_time ON votes (((data ->> 'updatedAt') COLLATE "C") DESC);
CREATE INDEX notes_time ON notes (((data ->> 'updatedAt') COLLATE "C") DESC);
CREATE INDEX audit_at ON audit (((data ->> 'at') COLLATE "C") DESC);

CREATE INDEX comments_node ON comments (((data ->> 'nodeId') COLLATE "C"));
CREATE INDEX comments_edge ON comments (((data ->> 'edgeId') COLLATE "C"));

CREATE INDEX feedback_status_time ON feedback
  ((data ->> 'adminStatus'), ((data ->> 'createdAt') COLLATE "C") DESC);
