"""The two cells the first row-for-row check against PeoplePKW caught."""

import json

import pytest

from jobs.pkw_postgres.tests.test_sql_parity import db  # noqa: F401
from scrapers.pkw.process import statement, strip_if_not_none


@pytest.mark.parametrize(
    "value",
    ['Komitet Wyborczy "Wspólność" \xa0\xa0\xa0', " Jan　", " a "],
)
def test_strip_takes_off_what_python_does(db, value):  # noqa: F811
    got = db.execute("SELECT pkw.strip(%s)", (value,)).fetchone()
    assert got == (strip_if_not_none(value),)


@pytest.mark.parametrize("value", [True, False, "Kowalski"])
def test_a_bool_cell_is_text_as_python_makes_it(db, value):  # noqa: F811
    got = db.execute(
        "SELECT pkw.strip(pkw.text_cell(%s::jsonb))", (json.dumps(value),)
    ).fetchone()
    assert got == (strip_if_not_none(value),)


def test_a_statement_settles_no_break_spaces(db):  # noqa: F811
    value = "nie\xa0należy  do\xa0partii"
    got = db.execute("SELECT pkw.statement(%s::jsonb)", (json.dumps(value),)).fetchone()
    assert got == (statement(value),)
