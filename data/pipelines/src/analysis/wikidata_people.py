"""`WikidataPeople`: what Wikidata says about the people koryta.pl links to
pl.wikipedia, and where it disagrees with the site.

A fold of the cache `jobs.wikidata_people` keeps (`stores.wikidata`) over
tonight's people (`KorytaNodes`). The job asks Wikidata; this only reads, so
without the job's cache every person comes out `not_fetched`.
"""

import json
import os
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass, fields
from typing import Any, cast

import pandas as pd

from entities.wikidata import (
    BirthCheck,
    LinkStatus,
    Precision,
    WikidataItem,
    WikidataMembership,
    WikidataPerson,
    WikidataPosition,
)
from scrapers.koryta.download import KorytaNodes
from scrapers.stores import Context, LocalFile, Pipeline
from stores import wikidata as cache

PRECISION: dict[int, Precision] = {11: "day", 10: "month", 9: "year"}

#: The string columns read_json would otherwise guess at: a birth date that is
#: only a year comes back as an int.
DTYPE = {
    "id": str,
    "name": str,
    "wikipedia": str,
    "title": str,
    "link_status": str,
    "qid": str,
    "birth_date": str,
    "birth_precision": str,
    "site_birth_date": str,
    "birth_check": str,
}


@dataclass(frozen=True)
class SitePerson:
    id: str
    name: str
    wikipedia: str
    birth_date: str | None


def parse_time(value: Any) -> tuple[str | None, Precision | None]:
    """A Wikidata time as "1965-05-12", "1965-05" or "1965", with its
    precision; (None, None) for none, before year 1 or vaguer than a year."""
    if not isinstance(value, dict):
        return None, None
    precision = PRECISION.get(value.get("precision") or 0)
    time = value.get("time") or ""
    if precision is None or not time.startswith("+"):
        return None, None
    year, month, day = time[1:11].split("-")
    match precision:
        case "day":
            return f"{year}-{month}-{day}", precision
        case "month":
            return f"{year}-{month}", precision
    return year, precision


def _usable(statements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [s for s in statements if s.get("rank") != "deprecated"]


def _best(statements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The statements Wikidata's truthy view keeps: the preferred, if any."""
    usable = _usable(statements)
    preferred = [s for s in usable if s.get("rank") == "preferred"]
    return preferred or usable


def _item(qid: Any, labels: Mapping[str, str]) -> WikidataItem | None:
    return WikidataItem(qid, labels.get(qid)) if isinstance(qid, str) else None


def _first(statement: dict[str, Any], qualifier: str) -> Any:
    values = statement.get("qualifiers", {}).get(qualifier, [])
    return values[0] if values else None


def birth_date(entity: Mapping[str, Any]) -> tuple[str | None, Precision | None, bool]:
    """The date of birth, its precision and whether the item gives more than
    one at its best rank (the first is kept)."""
    dates = [
        parse_time(s.get("value"))
        for s in _best(entity.get("claims", {}).get("P569", []))
    ]
    dates = [d for d in dates if d[0] is not None]
    if not dates:
        return None, None, False
    return dates[0][0], dates[0][1], len(set(dates)) > 1


def memberships(
    entity: Mapping[str, Any], labels: Mapping[str, str]
) -> list[WikidataMembership]:
    found = []
    for statement in _usable(entity.get("claims", {}).get("P102", [])):
        qid = statement.get("value")
        if not isinstance(qid, str):
            continue
        start, start_precision = parse_time(_first(statement, "P580"))
        end, end_precision = parse_time(_first(statement, "P582"))
        found.append(
            WikidataMembership(
                qid, labels.get(qid), start, start_precision, end, end_precision
            )
        )
    return found


def positions(
    entity: Mapping[str, Any], labels: Mapping[str, str]
) -> list[WikidataPosition]:
    found = []
    for statement in _usable(entity.get("claims", {}).get("P39", [])):
        qid = statement.get("value")
        if not isinstance(qid, str):
            continue
        start, start_precision = parse_time(_first(statement, "P580"))
        end, end_precision = parse_time(_first(statement, "P582"))
        found.append(
            WikidataPosition(
                qid,
                labels.get(qid),
                start,
                start_precision,
                end,
                end_precision,
                of=_item(_first(statement, "P642"), labels),
                district=_item(_first(statement, "P768"), labels),
                terms=[
                    WikidataItem(qid, labels.get(qid))
                    for qid in statement.get("qualifiers", {}).get("P2937", [])
                ],
            )
        )
    return found


def items(
    entity: Mapping[str, Any], prop: str, labels: Mapping[str, str]
) -> list[WikidataItem]:
    found: list[WikidataItem] = []
    for statement in _usable(entity.get("claims", {}).get(prop, [])):
        item = _item(statement.get("value"), labels)
        if item is not None and item not in found:
            found.append(item)
    return found


def check_birth(site: str | None, wikidata: str | None) -> BirthCheck:
    """Whether the two dates agree, as far as the vaguer one goes."""
    if not site:
        return "site_missing"
    if not wikidata:
        return "wikidata_missing"
    if site == wikidata:
        return "exact"
    shorter, longer = sorted((site, wikidata), key=len)
    return "year_only" if longer.startswith(shorter) else "different"


def person_row(
    person: SitePerson,
    titles: Mapping[str, cache.TitleEntry],
    entities: Mapping[str, Mapping[str, Any]],
    labels: Mapping[str, str],
) -> WikidataPerson:
    title = cache.title_from_url(person.wikipedia)
    row = WikidataPerson(
        id=person.id,
        name=person.name,
        wikipedia=person.wikipedia,
        title=title,
        link_status="not_plwiki",
        site_birth_date=person.birth_date,
    )
    if title is None:
        return row
    entry = titles.get(title)
    if entry is None:
        row.link_status = "not_fetched"
        return row
    if entry.status != "found":
        row.link_status = cast(LinkStatus, entry.status)
        return row
    row.qid = entry.qid
    entity = entities.get(entry.qid or "")
    if entity is None:
        row.link_status = "not_fetched"
        return row
    row.link_status = "ok"
    row.lastrevid = entity.get("lastrevid")
    row.birth_date, row.birth_precision, row.birth_date_disputed = birth_date(entity)
    row.birth_check = check_birth(person.birth_date, row.birth_date)
    row.parties = memberships(entity, labels)
    row.positions = positions(entity, labels)
    row.occupations = items(entity, "P106", labels)
    row.citizenships = items(entity, "P27", labels)
    return row


def linked_people(nodes: pd.DataFrame) -> list[SitePerson]:
    """The site's people with a Wikipedia link, merged duplicates left out."""

    def text(value: Any) -> str | None:
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return None
        return str(value).strip() or None

    people = []
    for row in nodes.to_dict(orient="records"):
        if row.get("type") != "person" or text(row.get("merged_into")):
            continue
        link = text(row.get("wikipedia"))
        if link is None:
            continue
        people.append(
            SitePerson(
                id=str(row["id"]),
                name=text(row.get("name")) or "",
                wikipedia=link,
                birth_date=text(row.get("birthDate")),
            )
        )
    return people


def build_rows(
    people: Iterable[SitePerson],
    titles: Mapping[str, cache.TitleEntry],
    entities: Mapping[str, Mapping[str, Any]],
    labels: Mapping[str, str],
) -> list[WikidataPerson]:
    return [person_row(p, titles, entities, labels) for p in people]


class WikidataPeople(Pipeline[WikidataPerson]):
    filename = "wikidata_people"
    dtype = DTYPE

    nodes: KorytaNodes

    @property
    def output_class(self):
        return WikidataPerson

    def read_cache(self, ctx: Context, name: str) -> Any:
        ref = LocalFile(os.path.join(cache.CACHE_FOLDER, name), "downloaded")
        try:
            return json.loads(ctx.io.read_data(ref).read_string())
        except FileNotFoundError:
            print(
                f"No {name} in downloaded/{cache.CACHE_FOLDER}: run "
                "koryta_wikidata_people first; its people come out not_fetched"
            )
            return {}

    def process(self, ctx: Context) -> pd.DataFrame:
        people = linked_people(self.nodes.read_or_process(ctx))
        rows = build_rows(
            people,
            cache.titles_from_json(self.read_cache(ctx, cache.TITLES)),
            self.read_cache(ctx, cache.ENTITIES),
            self.read_cache(ctx, cache.LABELS),
        )
        summary(rows)
        columns = [f.name for f in fields(WikidataPerson)]
        return pd.DataFrame([asdict(r) for r in rows], columns=columns)


def summary(rows: list[WikidataPerson]) -> None:
    links = pd.Series([r.link_status for r in rows]).value_counts().to_dict()
    births = pd.Series([r.birth_check for r in rows if r.birth_check])
    print(
        f"WikidataPeople: {len(rows)} people with a link {links}; "
        f"birth dates {births.value_counts().to_dict()}"
    )
