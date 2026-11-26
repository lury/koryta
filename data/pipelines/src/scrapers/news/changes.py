"""The board changes the bulletin shows at the companies the site has a page for.

The bulletin (`KRSUpdates`) names only the KRS numbers with an entry on a day,
not what the entry did. What it did is in the company's people: a seat whose
start or end is the day of a register entry. `PeopleKRSCombined` dates each
seat by the entry that began and ended it (from the odpis pełny, or rejestr.io
where it is newer), so a seat dated on, or a few days before, a bulletin day of
its company is the change that bulletin day announced.

Only the management and supervisory board count: a prokurent's or an
attorney's appointment is rarely news.
"""

import typing
from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd

from entities.company import short_name
from scrapers.koryta.download import KorytaNodes
from scrapers.krs.columns import iso_dates, padded_krs
from scrapers.krs.odpis_people import PeopleKRSCombined
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import Context, Pipeline

#: The posts whose change is worth a search, as `PeopleKRS` names them.
WATCHED_ROLES = frozenset({"Zarząd", "Rada Nadzorcza"})

#: How many days after a seat's dated entry its bulletin day may fall. The
#: bulletin lists an entry on the day the court made it, which is the day the
#: seat carries; a day's slack covers an entry made late in the evening.
BULLETIN_LAG_DAYS = 3

APPOINTED = "appointed"
LEFT = "left"


@dataclass(frozen=True)
class BoardChange:
    """One person joining or leaving one board, as one bulletin day showed it."""

    krs: str
    company: str
    person: str
    role: str
    kind: str
    #: The day the seat began or ended, ISO.
    change_date: str
    #: The bulletin day that named the company for it, ISO.
    bulletin_day: str
    first_name: str | None = None
    last_name: str | None = None


def company_label(name: str | None) -> str | None:
    """The name a reporter would write: no legal form, no town in brackets.

    The site's names end with the town ("AQUANET (Poznań)"), the register's
    with the form ("... SPÓŁKA AKCYJNA W KRAKOWIE"); neither is in an article.
    """
    if not isinstance(name, str) or not name.strip():
        return None
    text = name.strip()
    if text.endswith(")") and " (" in text:
        text = text[: text.rindex(" (")]
    text = short_name(text) or text
    # "SPÓŁKA AKCYJNA W KRAKOWIE": the seat after the form goes with it.
    for marker in (" SPÓŁKA AKCYJNA", " SPÓŁKA Z OGRANICZONĄ", " SP. Z O.O."):
        index = text.upper().find(marker)
        if index > 0:
            text = text[:index]
    return " ".join(text.replace('"', " ").replace("„", " ").replace("”", " ").split())


def tracked_companies(nodes: pd.DataFrame) -> dict[str, str]:
    """KRS number to the name of the site's page, for every company page."""
    if nodes.empty or "krsNumber" not in nodes.columns:
        return {}
    places = nodes[(nodes["type"] == "place") & nodes["krsNumber"].notna()]
    places = places[places["krsNumber"].astype(str).str.strip() != ""]
    krs = padded_krs(places["krsNumber"])
    return dict(zip(krs, places["name"].fillna("").astype(str)))


def _bulletin_days(updates: pd.DataFrame) -> dict[str, list[date]]:
    if updates.empty:
        return {}
    frame = pd.DataFrame(
        {"krs": padded_krs(updates["krs"]), "date": iso_dates(updates["date"])}
    ).dropna()
    days: dict[str, list[date]] = {}
    for krs, day in zip(frame["krs"], frame["date"]):
        if day:
            days.setdefault(krs, []).append(date.fromisoformat(str(day)[:10]))
    return {krs: sorted(set(found)) for krs, found in days.items()}


def _first_day_on_or_after(days: list[date], day: date, lag: int) -> date | None:
    for candidate in days:
        if day <= candidate <= day + timedelta(days=lag):
            return candidate
    return None


def changes_from(
    people: pd.DataFrame,
    updates: pd.DataFrame,
    companies: typing.Mapping[str, str],
    lag_days: int = BULLETIN_LAG_DAYS,
) -> list[BoardChange]:
    """Every watched seat at a tracked company dated just before a bulletin day."""
    days = _bulletin_days(updates)
    if people.empty or not days:
        return []
    frame = people[people["employed_role"].isin(WATCHED_ROLES)].copy()
    frame["krs"] = padded_krs(frame["employed_krs"])
    frame = frame[frame["krs"].isin(companies.keys()) & frame["krs"].isin(days)]
    found: set[BoardChange] = set()
    for row in frame.itertuples(index=False):
        krs = str(row.krs)
        for kind, value in ((APPOINTED, row.employed_start), (LEFT, row.employed_end)):
            if not isinstance(value, str) or len(value) < 10:
                continue
            seat_day = date.fromisoformat(value[:10])
            bulletin = _first_day_on_or_after(days[krs], seat_day, lag_days)
            if bulletin is None:
                continue
            found.add(
                BoardChange(
                    krs=krs,
                    company=companies[krs],
                    person=str(row.full_name),
                    role=str(row.employed_role),
                    kind=kind,
                    change_date=seat_day.isoformat(),
                    bulletin_day=bulletin.isoformat(),
                    first_name=_text(row.first_name),
                    last_name=_text(row.last_name),
                )
            )
    return sorted(found, key=lambda c: (c.bulletin_day, c.krs, c.person, c.kind))


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


class NewsWatchChanges(Pipeline[BoardChange]):
    """The board changes of the site's companies, by the bulletin day."""

    filename = "news_watch_changes"
    dtype = {"krs": str, "change_date": str, "bulletin_day": str}

    updates: KRSUpdates
    people: PeopleKRSCombined
    nodes: KorytaNodes

    @property
    def output_class(self) -> typing.Type:
        return BoardChange

    def process(self, ctx: Context) -> pd.DataFrame:
        companies = tracked_companies(self.nodes.read_or_process(ctx))
        changes = changes_from(
            self.people.read_or_process(ctx),
            self.updates.read_or_process(ctx),
            companies,
        )
        print(f"  {len(changes):,} board changes at {len(companies):,} companies")
        columns = list(BoardChange.__dataclass_fields__)
        return pd.DataFrame([c.__dict__ for c in changes], columns=columns)
