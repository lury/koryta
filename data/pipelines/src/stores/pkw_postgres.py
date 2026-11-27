"""PeoplePKW's candidacies read from Postgres (`pkw.candidacy`).

The columns are `entities.person.PKW`'s, in its order, with the text fields
as text - an age or a TERYT a workbook wrote as a number is its digits - and
`birth_year` a float with NaN for none, as the frame PeoplePKW builds.
"""

import os

import pandas as pd
import psycopg

from entities.person import PKW

COLUMNS = [name for name in PKW.__dataclass_fields__]
#: Held as jsonb, as the list's cell was; the rest are text already.
JSONB = {"sex", "age", "teryt_candidacy", "teryt_living"}


def pkw_dsn() -> str:
    return os.environ.get(
        "KORYTA_PKW_DSN", "postgres://postgres:dev@127.0.0.1:5432/koryta_pkg_f"
    )


def candidacies_sql(where: str = "") -> str:
    select = ", ".join(f"{c} #>> '{{}}' AS {c}" if c in JSONB else c for c in COLUMNS)
    return f"SELECT {select} FROM pkw.candidacy {where} ORDER BY n"


def read_candidacies(dsn: str | None = None, batch: int = 100_000) -> pd.DataFrame:
    """Every candidacy, in PeoplePKW's order."""
    columns: dict[str, list] = {c: [] for c in COLUMNS}
    with psycopg.connect(dsn or pkw_dsn()) as conn:
        # A named cursor streams, rather than hold 2M rows twice.
        with conn.cursor(name="pkw_candidacies") as cur:
            cur.itersize = batch
            cur.execute(candidacies_sql())  # type: ignore[call-overload]
            for row in cur:
                for name, value in zip(COLUMNS, row):
                    columns[name].append(value)
    df = pd.DataFrame(columns)
    df["birth_year"] = pd.to_numeric(df["birth_year"], errors="coerce").astype(float)
    return df
