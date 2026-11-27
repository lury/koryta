-- /api/topics and /api/articles/topics read every topic and every
-- `tagged` edge (topicsAndTags, server/utils/topics.ts). Neither had an
-- index to use: nodes_type_id leaves out merged-away pages, which the
-- read keeps, and edges has none on its type, so each request scanned all
-- 9.4 million edges and 2 million nodes at x50 (0.5 s warm, 2 s cold).
-- Both sets are an editor's and stay small.
CREATE INDEX nodes_topics ON nodes (id) WHERE type = 'topic';
CREATE INDEX edges_tagged ON edges (id) WHERE type = 'tagged';
