-- /api/edges/pending: the first 50 edges whose revision_id is stored as
-- null, by id (edgesWithNullRevisionPg). Walking the primary key until 50
-- of them turned up read most of the 9.4 million edges at x50: 12 s cold.
CREATE INDEX edges_awaiting_review ON edges (id) WHERE data -> 'revision_id' = 'null'::jsonb;
