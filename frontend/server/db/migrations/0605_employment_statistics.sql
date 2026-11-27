-- How many published, dated employments there are, for the planner: without
-- it the conditions of homeTimeline's scan (readPublishedEmployments) were
-- taken as independent, 7.5 thousand rows were expected of 243 thousand on
-- the x10 seed, and the plan sorted all of them rather than reading the
-- first 20 thousand of edges_live_published_employments (346 ms against
-- 24 ms).
CREATE STATISTICS edges_employment_stats
  ON type, (data -> 'published'), (jsonb_text(data -> 'start_date') IS NOT NULL) FROM edges;
ANALYZE edges;
