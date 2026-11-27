"""PKW's candidate lists into Postgres, and PeoplePKW's candidacies as views.

    koryta_pkw_postgres [--dsn postgres://...] [--no-refresh]

Loads every list `scrapers.pkw.sources` names into `pkw_raw` (`staging.py`):
COPY, a list at a time, skipped when its file's sha256 and its reader are
what was loaded before. Then refreshes `pkw.mapped` and `pkw.candidacy`, the
SQL of `sql/02_pkw_candidacy.sql`, which is PeoplePKW's output as a table.
The DSN comes from --dsn or KORYTA_PKW_DSN.
"""

import argparse
import os
import time

import psycopg

from conductor import setup_context
from jobs.pkw_postgres.staging import load
from scrapers.map.teryt import Teryt

DEFAULT_DSN = "postgres://postgres:dev@127.0.0.1:5432/koryta_pkg_f"


def dsn_from_env() -> str:
    return os.environ.get("KORYTA_PKW_DSN", DEFAULT_DSN)


def refresh(conn: psycopg.Connection) -> dict[str, float]:
    """Refresh the views, timing each."""
    took = {}
    for view in ("pkw.mapped", "pkw.candidacy"):
        started = time.perf_counter()
        conn.execute(f"REFRESH MATERIALIZED VIEW {view}")  # type: ignore[call-overload]
        conn.commit()
        took[view] = round(time.perf_counter() - started, 2)
    conn.execute("ANALYZE pkw.candidacy")
    conn.commit()
    return took


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dsn", default=None)
    parser.add_argument("--no-refresh", action="store_true")
    args = parser.parse_args(argv)

    ctx, _ = setup_context()
    teryt = Teryt()
    teryt.process(ctx)
    with psycopg.connect(args.dsn or dsn_from_env()) as conn:
        started = time.perf_counter()
        done = load(conn, ctx, teryt)
        print(
            f"load: {done['loaded']} lists loaded, {done['unchanged']} unchanged, "
            f"{time.perf_counter() - started:.1f} s",
            flush=True,
        )
        if not args.no_refresh:
            print(f"refresh: {refresh(conn)}", flush=True)
