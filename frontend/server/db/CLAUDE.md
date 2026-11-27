# Postgres layer (`frontend/server/db`)

## Migrations

- Migrations live in `migrations/`, numbered, one file per change. Once deployed, a
  migration is immutable: fix it with a new one.
  Why: databases that already ran the old file never see an edit to it.
- After a bulk load or a large backfill, run `ANALYZE` on the touched tables.
  Why: stale statistics make the planner pick plans for an empty table.

## Derived data

- Derived data (stats, queues, counters) lives in tables maintained incrementally by
  `refresh_*_for(ids)` (`refresh_node_stats_for`, `refresh_node_derived_for`,
  `refresh_hospital_stats_for`; also `refresh_queue_tiers(now, ids)` and
  `refresh_node_revisions(ids)`), called inside the transaction of the write that changes
  its inputs (`writeEffects.ts`).
  Why: readers never see a write without its derived rows, and the cost scales with the write.
- A full refresh runs only as the nightly consistency check, and any difference it finds is a bug.
  Why: a full rebuild on the request path hides incremental bugs and grows with the database.
- `SET jit = off` on short incremental functions where a measurement shows JIT dominates.
  Why: JIT compile time can exceed the run time of a query that touches a handful of rows.

## Queries and indexes

- An index must match the exact expression the query uses; a partial index's predicate
  must be implied by the query's `WHERE`.
  Why: an index on a slightly different expression or predicate is silently unused.
- Do not filter on hot `jsonb` fields directly; add a generated or typed column and index it.
  Why: `jsonb` extraction cannot use statistics or ordinary indexes well.
- Set-based SQL over loops of single-row queries; aggregate with `GROUP BY` and window functions.
  Why: one round trip and one plan instead of N.
- Check a new or changed hot query with `EXPLAIN (ANALYZE, BUFFERS)` on a x10 database
  (`npm run seed:large -- --scale 10 --out <dir>`, then `npm run db:load -- --dir <dir>`),
  and keep `npm run test:golden` passing.
  Why: plans on seed-sized data differ from production plans.
- Reuse the SQL helpers already defined in migrations (search `CREATE FUNCTION`) before adding one.

## Performance budgets

- `tests/perf/budgets.json` holds the budget of every GET and write of the golden
  scenario: warm and cold latency at x10, the shared blocks a request's statements
  touch, the response size; `reads` and `writes` are the defaults. A new endpoint,
  SQL function or job, or a change to a hot path, declares its budget there in the
  same PR.
  Why: the budget is what the next change is held to.
- `npm run test:perf` replays the scenario (`scripts/pg/bench-api.ts`) against a
  running server on a x10 database copy, Postgres and the app in the test configuration
  (`config` in the file: 6 CPU / 24 GB and 4 CPU / 4 GB), and fails on any step over budget:
  `BENCH_URL=... BENCH_AUTH_URL=... BENCH_DATABASE_URL=... npm run test:perf`.
  Postgres needs `shared_preload_libraries = pg_stat_statements` for the blocks.
  Why: latency regressions show at x10, not on the test seed.
- Raise a budget only with a written reason in the PR, never to let a regression
  pass. Not without a design discussion: whole tables or types read into Node,
  per-row queries in a loop, unbounded responses, caches over slow queries.
  Why: each grows with the base.
- `tests/server/db/boundedQueries.pg.test.ts` runs in the normal pg suite: the list
  and search readers plan no sequential scan of `nodes`, `edges` or `revisions`
  (with `enable_seqscan = off`, a scan that is still sequential has no index) and
  answer no more rows than their cap.
  Why: an unbounded read is caught on the small seed, before anyone benchmarks.

## Tests

- Test against real Postgres through `tests/server/db/pgHarness.ts` (`openTestDatabase`),
  one database per test file; no mocked database client.
  Why: files run in parallel without wiping each other, and the SQL is actually executed.
- Each endpoint family has auth cases: anonymous, signed-in user, admin, and the
  revision-vs-direct-apply split where it applies.
  Why: permission bugs are the most expensive bugs on a public-records site.
