"""WikidataPeople: the job's cache read into a row a person.

The entities are wbgetentities answers recorded on 2026-11-26
(`jobs/wikidata_people/tests/fixtures`), slimmed as the job slims them.
"""

import io
import json
from pathlib import Path

import pandas as pd
import pytest

from analysis.wikidata_people import (
    SitePerson,
    WikidataPeople,
    birth_date,
    build_rows,
    check_birth,
    linked_people,
    parse_time,
)
from entities.wikidata import WikidataItem, WikidataPerson
from scrapers.stores import Context, ProcessPolicy, iterate_pipeline
from scrapers.stores.file import LocalFile
from scrapers.test_tree import MockIO, MockUtils, MockWeb
from stores import file
from stores import wikidata as cache
from stores.wikidata import TitleEntry, slim_entity, title_from_url

FIXTURES = Path(__file__).parents[2] / "jobs/wikidata_people/tests/fixtures"
KIERWINSKI = "Q11767619"
PTAK = "Q110692416"


@pytest.fixture(scope="module")
def entities() -> dict[str, dict]:
    raw = json.loads((FIXTURES / "wbgetentities-items.json").read_text())
    return {q: slim_entity(e) for q, e in raw["entities"].items()}


LABELS = {
    "Q19269361": "poseł na Sejm Rzeczypospolitej Polskiej",
    "Q27169": "poseł do Parlamentu Europejskiego",
    "Q156868": "Platforma Obywatelska",
    "Q7208888": "okręg wyborczy nr 4 do PE",
    "Q9334969": "Sejm RP VII kadencji",
}


def person(title: str, birth: str | None = None, link: str | None = None):
    return SitePerson(
        id=title.replace(" ", "-"),
        name=title,
        wikipedia=link or "https://pl.wikipedia.org/wiki/" + title.replace(" ", "_"),
        birth_date=birth,
    )


TITLES = {
    "Marcin Kierwiński": TitleEntry("found", KIERWINSKI, "dump"),
    "Arkadiusz Ptak": TitleEntry("found", PTAK, "dump"),
    "Shivan Fate": TitleEntry("dead", None, "plwiki"),
    "Bez Elementu": TitleEntry("no_item", None, "dump"),
}


# ─── links ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url, title",
    [
        ("https://pl.wikipedia.org/wiki/Beata_Szyd%C5%82o", "Beata Szydło"),
        ("https://pl.m.wikipedia.org/wiki/jan_Nowak#Życiorys", "Jan Nowak"),
        ("https://pl.wikipedia.org/w/index.php?title=Jan_Nowak", "Jan Nowak"),
        ("https://en.wikipedia.org/wiki/Jan_Nowak", None),
        ("https://pl.wikipedia.org/wiki/Kategoria:Posłowie", None),
        ("", None),
    ],
)
def test_a_link_names_its_article_as_the_wiki_titles_it(url, title):
    assert title_from_url(url) == title


# ─── what an item says ───────────────────────────────────────


def test_times_keep_their_precision():
    assert parse_time({"time": "+1976-04-19T00:00:00Z", "precision": 11}) == (
        "1976-04-19",
        "day",
    )
    assert parse_time({"time": "+2015-10-00T00:00:00Z", "precision": 10}) == (
        "2015-10",
        "month",
    )
    assert parse_time({"time": "+1976-00-00T00:00:00Z", "precision": 9}) == (
        "1976",
        "year",
    )
    # A decade, or a date before the common era, is no birth date to compare.
    assert parse_time({"time": "+1970-00-00T00:00:00Z", "precision": 8}) == (
        None,
        None,
    )
    assert parse_time(None) == (None, None)


def test_a_preferred_day_wins_over_a_normal_year(entities):
    # Ptak's item gives 1976-04-19 (preferred) and 1976 (normal).
    assert birth_date(entities[PTAK]) == ("1976-04-19", "day", False)


def test_a_birth_date_given_twice_at_the_same_rank_is_disputed():
    entity = {
        "claims": {
            "P569": [
                {
                    "rank": "normal",
                    "value": {"time": "+1950-01-02T00:00:00Z", "precision": 11},
                },
                {
                    "rank": "normal",
                    "value": {"time": "+1951-01-02T00:00:00Z", "precision": 11},
                },
                {
                    "rank": "deprecated",
                    "value": {"time": "+1900-01-02T00:00:00Z", "precision": 11},
                },
            ]
        }
    }
    assert birth_date(entity) == ("1950-01-02", "day", True)


def test_positions_carry_their_dates_district_and_every_term(entities):
    [row] = build_rows([person("Marcin Kierwiński")], TITLES, entities, LABELS)

    sejm = row.positions[0]
    assert (sejm.qid, sejm.label) == ("Q19269361", LABELS["Q19269361"])
    assert (sejm.start, sejm.start_precision) == ("2011", "year")
    assert (sejm.end, sejm.end_precision) == ("2024", "year")
    assert [t.qid for t in sejm.terms] == [
        "Q71709885",
        "Q9334969",
        "Q22056381",
        "Q123110896",
    ]
    assert sejm.terms[1].label == "Sejm RP VII kadencji"

    pe = row.positions[1]
    assert (pe.start, pe.end) == ("2024-07-16", "2024-09-25")
    assert pe.district == WikidataItem("Q7208888", "okręg wyborczy nr 4 do PE")
    # Month precision on an end date: October 2015, no day.
    [minister] = [p for p in row.positions if p.qid == "Q9335058"]
    assert (minister.end, minister.end_precision) == ("2015-10", "month")


def test_parties_carry_their_dates_and_labels(entities):
    [row] = build_rows([person("Marcin Kierwiński")], TITLES, entities, LABELS)

    po = row.parties[0]
    assert (po.qid, po.label, po.start_precision) == (
        "Q156868",
        "Platforma Obywatelska",
        "year",
    )
    assert po.end is None
    assert [p.qid for p in row.parties] == ["Q156868", "Q9323603", "Q3366252"]
    assert [o.qid for o in row.occupations] == ["Q82955"]
    assert [c.qid for c in row.citizenships] == ["Q36"]


# ─── against the site ────────────────────────────────────────


@pytest.mark.parametrize(
    "site, wikidata, check",
    [
        ("1976-04-19", "1976-04-19", "exact"),
        ("1976-04-19", "1976", "year_only"),
        ("1976", "1976-04-19", "year_only"),
        ("1976-04-19", "1976-04", "year_only"),
        ("1985-05-12", "1985-05-21", "different"),
        ("1979-07-16", "1976", "different"),
        (None, "1976", "site_missing"),
        ("1976-04-19", None, "wikidata_missing"),
    ],
)
def test_birth_dates_are_compared_as_far_as_the_vaguer_goes(site, wikidata, check):
    assert check_birth(site, wikidata) == check


def test_each_link_gets_its_status(entities):
    rows = build_rows(
        [
            person("Arkadiusz Ptak", birth="1976-04-19"),
            person("Shivan Fate"),
            person("Bez Elementu"),
            person("Nowy Artykuł"),
            person("X", link="https://en.wikipedia.org/wiki/X"),
        ],
        TITLES,
        entities,
        LABELS,
    )

    assert [(r.link_status, r.qid, r.birth_check) for r in rows] == [
        ("ok", PTAK, "exact"),
        ("dead", None, None),
        ("no_item", None, None),
        ("not_fetched", None, None),
        ("not_plwiki", None, None),
    ]
    assert rows[0].lastrevid == 2574891570


def test_only_people_with_a_link_and_not_merged_are_read():
    nodes = pd.DataFrame(
        [
            {
                "id": "a",
                "type": "person",
                "name": "A",
                "wikipedia": "https://pl.wikipedia.org/wiki/A",
                "birthDate": "1970-01-01",
                "merged_into": None,
            },
            {
                "id": "b",
                "type": "person",
                "name": "B",
                "wikipedia": None,
                "birthDate": None,
                "merged_into": None,
            },
            {
                "id": "c",
                "type": "person",
                "name": "C",
                "wikipedia": "https://pl.wikipedia.org/wiki/C",
                "birthDate": "",
                "merged_into": "a",
            },
            {
                "id": "d",
                "type": "place",
                "name": "D",
                "wikipedia": "https://pl.wikipedia.org/wiki/D",
                "birthDate": None,
                "merged_into": None,
            },
            {
                "id": "e",
                "type": "person",
                "name": "E",
                "wikipedia": "https://pl.wikipedia.org/wiki/E",
                "birthDate": float("nan"),
                "merged_into": float("nan"),
            },
        ]
    )
    assert linked_people(nodes) == [
        SitePerson("a", "A", "https://pl.wikipedia.org/wiki/A", "1970-01-01"),
        SitePerson("e", "E", "https://pl.wikipedia.org/wiki/E", None),
    ]


# ─── the pipeline ────────────────────────────────────────────


class CacheIO(MockIO):
    def __init__(self, files: dict[str, str]) -> None:
        self.files = files

    def read_data(self, fs):
        assert isinstance(fs, LocalFile) and fs.folder == "downloaded"
        if fs.filename not in self.files:
            raise FileNotFoundError(fs.filename)
        return file.FromBytesIO(self.files[fs.filename].encode(), fs.filename)


def context(io_: MockIO) -> Context:
    return Context(
        io=io_,
        rejestr_io=None,
        con=None,  # type: ignore[arg-type]
        utils=MockUtils(),
        web=MockWeb(),
        nlp=None,
        refresh_policy=ProcessPolicy.with_default(),
    )


NODES = pd.DataFrame(
    [
        {
            "id": "k",
            "type": "person",
            "name": "Marcin Kierwiński",
            "wikipedia": "https://pl.wikipedia.org/wiki/Marcin_Kierwi%C5%84ski",
            "birthDate": "1976-01-01",
            "merged_into": None,
        },
        {
            "id": "p",
            "type": "person",
            "name": "Arkadiusz Ptak",
            "wikipedia": "https://pl.wikipedia.org/wiki/Arkadiusz_Ptak",
            "birthDate": "1976-04-19",
            "merged_into": None,
        },
    ]
)


def test_the_pipeline_reads_the_cache_and_its_rows_read_back(entities):
    def path(name: str) -> str:
        return f"{cache.CACHE_FOLDER}/{name}"

    io_ = CacheIO(
        {
            path(cache.TITLES): json.dumps(cache.titles_to_json(TITLES)),
            path(cache.ENTITIES): json.dumps(entities),
            path(cache.LABELS): json.dumps(LABELS),
        }
    )
    pipeline = WikidataPeople()
    pipeline.nodes._cached_result = NODES

    df = pipeline.process(context(io_))

    # Through jsonl and back, as the next pipeline would read it.
    text = df.to_json(orient="records", lines=True)
    again = pd.read_json(io.StringIO(text), lines=True, dtype=WikidataPeople.dtype)
    rows: list[WikidataPerson] = list(iterate_pipeline(again, WikidataPerson))
    assert [(r.id, r.link_status, r.birth_check) for r in rows] == [
        ("k", "ok", "different"),
        ("p", "ok", "exact"),
    ]
    assert rows[0].positions[1].district == WikidataItem(
        "Q7208888", "okręg wyborczy nr 4 do PE"
    )
    assert rows[1].birth_date == "1976-04-19"


def test_without_the_cache_everyone_is_not_fetched():
    pipeline = WikidataPeople()
    pipeline.nodes._cached_result = NODES

    df = pipeline.process(context(CacheIO({})))

    assert df["link_status"].tolist() == ["not_fetched", "not_fetched"]
