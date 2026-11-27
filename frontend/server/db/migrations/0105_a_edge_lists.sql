-- The published employments newest first: the scan of homeTimeline and
-- serviceMilestones and the pages of recentEmployments (server/db/edgeLists.ts).
CREATE INDEX edges_published_employments ON edges
  ((jsonb_text(data -> 'start_date')) COLLATE "C" DESC, id DESC)
  WHERE type = 'employed' AND data -> 'published' = 'true'::jsonb;

-- The relations citing an article (/api/edges/byReference).
CREATE INDEX edges_references ON edges USING gin ((data -> 'references'));
