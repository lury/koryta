"""The SQL ports in `sql/02_pkw_candidacy.sql` against the Python they copy.

Needs a Postgres at KORYTA_PKW_DSN with the schema applied
(`koryta_pkw_postgres --no-refresh`); skipped without one.
"""

import json

import psycopg
import pytest

from scrapers.pkw import headers
from scrapers.pkw.affiliations import membership_and_backing
from scrapers.pkw.process import given_names, statement
from stores.pkw_postgres import pkw_dsn
from util.polish import PkwFormat, parse_name


@pytest.fixture(scope="module")
def db():
    try:
        conn = psycopg.connect(pkw_dsn(), connect_timeout=2)
    except psycopg.OperationalError as e:
        pytest.skip(f"no Postgres at KORYTA_PKW_DSN: {e}")
    found = conn.execute("SELECT to_regproc('pkw.parse_name') IS NOT NULL").fetchone()
    if not found or not found[0]:
        pytest.skip("the pkw schema is not applied")
    yield conn
    conn.close()


NAMES = [
    ("Jan Kowalski", PkwFormat.First_Last),
    ("Jan Maria Kowalski", PkwFormat.First_Last),
    ("Anna Maria Zofia Nowak-Jeziorańska", PkwFormat.First_Last),
    ("Jan KOWALSKI", PkwFormat.First_LAST),
    ("Jan Maria NOWAK-JEZIORAŃSKA", PkwFormat.First_LAST),
    ("Maria de LA ŁĄCKA", PkwFormat.First_LAST),
    ("KOWALSKI Jan", PkwFormat.LAST_First),
    ("NOWAK JEZIORAŃSKI Jan Maria", PkwFormat.LAST_First),
    ("O'BRIEN Patrick", PkwFormat.LAST_First),
]


@pytest.mark.parametrize("name, fmt", NAMES)
def test_parse_name(db, name, fmt):
    got = db.execute(
        "SELECT first, middle, last FROM pkw.parse_name(%s, %s)", (name, fmt.name)
    ).fetchone()
    assert got == parse_name(name, fmt)


@pytest.mark.parametrize(
    "names",
    ["Henryk s. Stefana", "Maria c. Jana", "Franciszek,Marian", "Jan , Maria", "Jan"],
)
def test_given_names(db, names):
    got = db.execute("SELECT pkw.given_names(%s)", (names,)).fetchone()
    assert got == (given_names(names),)


@pytest.mark.parametrize(
    "cell",
    [
        "nie należy do partii politycznej, pop. SLD",
        "popierany przez PSL",
        "„członek Prawa i Sprawiedliwości”",
        "członek partii polit.popierany przez KO",
        "Prawo i Sprawiedliwość",
        "",
    ],
)
def test_membership_and_backing(db, cell):
    got = db.execute(
        "SELECT membership, backing FROM pkw.membership_and_backing(%s)", (cell,)
    ).fetchone()
    assert got == membership_and_backing(cell)


@pytest.mark.parametrize("value", ["  nie  należy\n do partii ", 3.0, 12, None, "x"])
def test_statement(db, value):
    got = db.execute("SELECT pkw.statement(%s::jsonb)", (json.dumps(value),)).fetchone()
    assert got == (statement(value),)


@pytest.mark.parametrize("value", ["T", "W", "B", "N", "", "2", " T ", None])
def test_mandate(db, value):
    got = db.execute(
        "SELECT pkw.apply_rule('mandate', NULL, %s::jsonb, '2018', 'samorządu')"
        " #>> '{}'",
        (json.dumps(value),),
    ).fetchone()
    assert got == (headers.parse_mandate(value, None),)  # type: ignore[arg-type]
