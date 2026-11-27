
You are working in a Python environment managed by uv.
Always use `.venv/bin/python` or `.venv/bin/pytest` to run scripts and tests.
`uv sync --all-groups` rebuilds `.venv` from `uv.lock` if it is missing or stale.
The workspace root is the `data/pipelines` directory of the checkout you are in.
Run and inspect pipelines with the `koryta` CLI (see the `koryta-cli` skill).

## Data processing

- Use pandas only where vectorised analysis is really needed. Read spreadsheets with
  calamine; do transforms in DuckDB or pyarrow.
  Why: pandas is the slowest and most memory-hungry option for loading and reshaping.
- No DataFrame built from a list of dicts in a hot path; build Arrow tables or let DuckDB
  read the source directly.
  Why: per-row Python objects dominate runtime and memory at production volume.

## Outputs

- Write large tabular outputs as Parquet with zstd compression.
  Why: typed, columnar and several times smaller than CSV/JSONL.
- Text artefacts over 2 MB that no human reads (JSONL, CSV, logs) are written as `.zst`
  (zstd level 3). Readers accept both `.gz` and `.zst`; use `src/util/zst.py`.
  Why: smaller and faster than gzip, while older `.gz` artefacts stay readable.
- Object names are unique per URL, including the query string.
  Why: two pages that differ only in `?id=` must not overwrite each other.

## Incremental runs

- Skip unchanged work: conditional requests (`ETag` / `If-Modified-Since`) for downloads,
  input hashes for derived steps. Rebuild everything only when explicitly asked
  (`--refresh`, never by deleting cache files).
  Why: full rebuilds waste hours and load the sources we depend on.
