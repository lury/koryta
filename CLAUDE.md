# Quality Assurance Rules

1. Prefer communication
   Whenever you're unsure about a big design decision, you can ask for clarification.

1. Clean changes
   Before modifying files at the beginning of your run, initialize a new change using jj:
   `jj new -m 'Description of the change'`

   You are free to pick a short description based on the prompt from the user.
   Do not use the feat: style: format. Just a normal description of the feature.

1. Be location dependent
   Claude Code loads the CLAUDE.md of a directory once you work on a file in it.
   - Frontend: `frontend/CLAUDE.md` and the skills in `frontend/.claude/skills`;
     also `frontend/app/CLAUDE.md` and `frontend/server/db/CLAUDE.md`.
   - Pipelines: `data/pipelines/CLAUDE.md` and the skills in `data/pipelines/.claude/skills`.

1. **Failure Protocol**:
   - If the checks fail, do NOT ask for review. Analyze the error, fix the code, and re-run the tests.
   - Only request review once tests pass.

1. Comments
   Keep code comments short, saying only what will still make sense for someone reading the code.
   Cite a decision of people by their date ("decision on 2026-11-12"), not by name
   or a quote of the reply. The quote, the task id and what the code used to do
   can go in the commit message if they are needed.

1. Allow modifications
   You can modify those rules, especially if asked to do something that seems worth keeping in mind.

## Architecture

- Postgres is the single source of truth; Firebase is used for Auth only.
  Why: one store means one set of invariants, one backup and one query planner to reason about.
- No Firestore-shaped adapters, no read/write backend flags, no Firestore fallback.
  Why: a second path doubles every test and hides which one production actually runs.
- Stack: TypeScript on Node 24 in the app (Nuxt/Nitro, Vuetify), Python in `data/pipelines`,
  Go only in `data/compressor`.
  Why: every extra runtime is another toolchain, image and security feed to maintain.
- A new language, runtime or heavy dependency needs a written justification in the PR.
- Search before writing: reuse existing helpers, SQL functions and components.
  Why: duplicates drift apart, and `npm run check:duplication` is kept at zero.

## Performance

- Measure before optimising: golden replay (`npm run test:golden`),
  `EXPLAIN (ANALYZE, BUFFERS)`, and a benchmark at realistic scale
  (`npm run seed:large -- --scale 10 --out <dir>`, or `--scale 50`, then
  `npm run db:load -- --dir <dir>`).
  Why: a guess optimises the wrong thing; production-sized data changes the plan.
- Fix the root cause. A cache is an optimisation, never a correctness requirement,
  and never a band-aid that changes what a response means.
  Why: a cache that hides a slow query also hides the next bug in it.
- Compute in SQL what SQL can compute (set-based queries, `GROUP BY`, window functions);
  never pull whole tables into Node.
  Why: memory and latency grow with the table, not with the answer.
- No unbounded list endpoints: every list is paginated or capped.
  Why: one large response can stall the Nitro process for everyone.
- Every new endpoint, SQL function or job, and every change to a hot path, declares
  its budget in `frontend/tests/perf/budgets.json` (latency at x10, blocks read,
  response size) in the same PR, and `npm run test:perf` passes.
  Why: a budget nobody checks is a description, not a limit.
- Raising a budget needs a written justification in the PR; a budget is never raised
  to make a regression pass.
  Why: otherwise the budget follows the code instead of holding it.
- Forbidden without a design discussion first: reading a whole table or type into
  the app to filter, count or join; per-row queries in a loop; unbounded responses;
  a cache that hides a slow query.
  Why: each of these grows with the base, and each passed review before.
- Report the measured numbers, before and after at x10, in the PR description.
  Why: the reviewer checks the claim, not the intent.

## Bugs and debt

- A bug found while working: fix it if it is within the change's scope; otherwise file a
  GitHub issue with problem, evidence (permalink to a commit), repro, proposed fix and
  definition of done.
  Why: an unfiled finding is lost; an unrelated fix makes the PR hard to review.
- Boy-scout rule: pay down debt in the files you are already changing; do not widen
  the change into unrelated files.
  Why: debt shrinks steadily while each PR stays reviewable.

## Tests

- Test against a real Postgres (the per-file database harness), not mocks of the database.
  Why: mocks pass while the SQL is wrong.
- When replacing or deleting tests, every old case gets an equivalent or a written reason.
  Why: a rewrite is where coverage silently disappears.

## Docker

- Pin base images to a version; multi-stage builds; dependencies installed before code is copied;
  `RUN --mount=type=cache` for package managers; runtime stage runs as a non-root `USER`.
  Why: reproducible, fast rebuilds and a smaller attack surface.
- No secrets in images, `ARG` or build `ENV`.
