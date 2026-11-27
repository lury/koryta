"""What the loader tells the SQL about PeoplePKW's lists, without a database."""

import math

import numpy as np
import pytest

from jobs.pkw_postgres import staging as load
from scrapers.pkw import headers
from scrapers.pkw.sources import sources

SQL_RULES = {
    "identity",
    "const",
    "sex",
    "yes_no",
    "mandate",
    "runoff_mandate",
    "district_teryt",
    "city_teryt",
}


def test_every_column_any_list_maps_has_a_rule_the_sql_knows():
    for config in sources:
        for field in {**headers.CSV_HEADERS, **config.headers}.values():
            rule, arg = load.rule_of(field)
            if field is None:
                assert rule is None
            else:
                assert rule in SQL_RULES, field
                assert (arg is not None) == (rule == "const")


def test_the_const_columns_carry_their_value():
    assert load.rule_of(headers.CSV_HEADERS["Sejmik"]) == ("const", "Rada sejmiku")
    assert load.rule_of(headers.CSV_HEADERS["Nr okr."]) == ("district_teryt", None)
    assert load.rule_of(headers.CSV_HEADERS["Siedziba OKW"]) == ("city_teryt", None)


def test_a_processor_the_sql_has_no_port_of_stops_the_load():
    with pytest.raises(ValueError, match="no SQL rule"):
        load.rule_of(headers.SetField("party", lambda x, _: x.upper()))


def test_every_list_has_a_key_of_its_own():
    found = load.lists()
    assert len({f.key for f in found}) == len(found)
    runoffs = [f for f in found if f.runoff]
    assert runoffs, "the 2024 mayoral run-offs are lists of their own"
    for runoff in runoffs:
        assert runoff.key != load.list_key(runoff.config, False)


def test_a_cell_is_stored_as_json_holds_it():
    assert load.cell(float("nan")) is None
    assert load.cell(np.int64(45)) == 45
    assert load.cell(np.float64(1.5)) == 1.5
    assert load.cell("Kowalski") == "Kowalski"
    assert not isinstance(load.cell(np.int64(1)), np.generic)
    assert math.isclose(load.cell(146512.0), 146512.0)
