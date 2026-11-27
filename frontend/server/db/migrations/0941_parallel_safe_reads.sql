-- The read-only row functions the refreshes and the readers select from,
-- marked PARALLEL SAFE. They are inlined into the calling query, but the
-- planner decides whether a query may run in parallel before it inlines
-- them, from the declared marking, and the default is UNSAFE: every
-- full refresh ran on one core (no Gather in the plan of
-- SELECT * FROM node_stats_rows() even with the parallel costs at zero).
-- They read tables and call only PARALLEL SAFE helpers; they write
-- nothing and use no temporary tables. node_group_sizes_near and
-- node_group_affected stay as they are: a function with a SET clause
-- (jit = off) cannot run in a parallel worker.
ALTER FUNCTION live_edges(text[]) PARALLEL SAFE;
ALTER FUNCTION place_ancestor_rows(text[]) PARALLEL SAFE;
ALTER FUNCTION node_target_rows(text[]) PARALLEL SAFE;
ALTER FUNCTION node_stats_rows(text[]) PARALLEL SAFE;
ALTER FUNCTION node_category_rows(text[]) PARALLEL SAFE;
ALTER FUNCTION node_area_rows(text[]) PARALLEL SAFE;
ALTER FUNCTION hospital_place_rows(text[]) PARALLEL SAFE;
ALTER FUNCTION hospital_seat_rows(text[]) PARALLEL SAFE;
ALTER FUNCTION hospital_stats(text, text) PARALLEL SAFE;
ALTER FUNCTION queue_tiers(timestamptz, text[]) PARALLEL SAFE;
ALTER FUNCTION node_revisions(text[]) PARALLEL SAFE;
ALTER FUNCTION first_revisions(text[]) PARALLEL SAFE;
ALTER FUNCTION line_places(text[]) PARALLEL SAFE;
ALTER FUNCTION search_lines(timestamptz, text[], text[], text[]) PARALLEL SAFE;
ALTER FUNCTION database_count_rows() PARALLEL SAFE;
