-- The pages of /api/edges/recentEmployments (readEmployedPage) put an
-- explicit null start last: they ordered by `start IS NULL` first, which
-- no index has, so each page sorted every published employment - 12 s for
-- the first 60 at x50, 250 thousand blocks read. The same order said as
-- NULLS LAST, with an index in it; the one it replaces served nothing else
-- (homeTimeline and serviceMilestones read edges_live_published_employments).
DROP INDEX edges_published_employments;
CREATE INDEX edges_published_employments ON edges
  ((jsonb_text(data -> 'start_date')) COLLATE "C" DESC NULLS LAST, id DESC)
  WHERE type = 'employed' AND data -> 'published' = 'true'::jsonb;
