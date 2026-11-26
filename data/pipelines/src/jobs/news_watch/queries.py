"""Board changes into searches: one per person and company and window."""

from __future__ import annotations

import unicodedata
from collections.abc import Iterable
from datetime import date, timedelta

from jobs.news_watch.models import NewsQuery
from scrapers.news.changes import BoardChange, company_label

#: Days searched either side of a change. An appointment is news on the day of
#: the resolution, which the court enters a week or three later.
WINDOW_DAYS = 14

#: Names that say what a company is, not which one: a phrase search for
#: "PRZEDSIĘBIORSTWO ENERGETYKI CIEPLNEJ" finds every town's. Such a company is
#: searched by its town, which the site's name carries in brackets.
_GENERIC_STARTS = (
    "PRZEDSIĘBIORSTWO",
    "SAMODZIELNY PUBLICZNY",
    "SPZOZ",
    "ZAKŁAD",
    "MIEJSKIE PRZEDSIĘBIORSTWO",
    "MIEJSKI ZAKŁAD",
    "GMINNY ZAKŁAD",
    "SPÓŁDZIELNIA",
    "STOWARZYSZENIE",
    "FUNDACJA",
    "TOWARZYSTWO BUDOWNICTWA",
    "SZPITAL",
    "CENTRUM",
)

#: A name longer than this is one the register spells and nobody writes.
_MAX_PHRASE_WORDS = 4


def fold(text: str) -> str:
    """Lowercase, no diacritics, `ł` included, which NFKD keeps."""
    text = text.lower().replace("ł", "l")
    return "".join(
        ch
        for ch in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(ch)
    )


def _town(site_name: str) -> str | None:
    name = site_name.strip()
    if name.endswith(")") and " (" in name:
        return name[name.rindex(" (") + 2 : -1].strip() or None
    return None


def company_phrase(site_name: str) -> str | None:
    """What a query names the company by; see `_GENERIC_STARTS`."""
    label = company_label(site_name)
    if not label:
        return None
    upper = label.upper()
    generic = upper.startswith(_GENERIC_STARTS)
    if generic or len(label.split()) > _MAX_PHRASE_WORDS:
        town = _town(site_name)
        if town:
            return town
        if generic:
            return None
    return label.title() if label.isupper() else label


def person_phrase(change: BoardChange) -> str:
    """First name and surname: middle names are not in the press."""
    if change.first_name and change.last_name:
        first = change.first_name.split()[0]
        return f"{first.title()} {change.last_name.title()}"
    words = change.person.split()
    if len(words) > 2:
        words = [words[0], words[-1]]
    return " ".join(w.title() if w.isupper() else w for w in words)


def build_queries(
    changes: Iterable[BoardChange],
    today: date,
    window_days: int = WINDOW_DAYS,
) -> list[NewsQuery]:
    """One query per person and company; changes whose windows overlap share
    one, covering both. A window never ends after `today`."""
    grouped: dict[tuple[str, str], list[tuple[date, date, str, str, str]]] = {}
    for change in changes:
        phrase = company_phrase(change.company)
        if not phrase:
            continue
        person = person_phrase(change)
        day = date.fromisoformat(change.change_date)
        start = day - timedelta(days=window_days)
        end = min(day + timedelta(days=window_days), today)
        tag = f"{change.kind}:{change.role}:{change.change_date}"
        grouped.setdefault((fold(person), change.krs), []).append(
            (start, end, tag, person, phrase)
        )

    queries: list[NewsQuery] = []
    for (_, krs), windows in grouped.items():
        windows.sort()
        merged: list[list] = []
        for start, end, tag, person, phrase in windows:
            if merged and start <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], end)
                merged[-1][2].append(tag)
            else:
                merged.append([start, end, [tag], person, phrase])
        for start, end, tags, person, phrase in merged:
            queries.append(
                NewsQuery(
                    person=person,
                    company=phrase,
                    krs=krs,
                    start=start,
                    end=end,
                    changes=tuple(sorted(set(tags))),
                )
            )
    return sorted(queries, key=lambda q: (q.end, q.krs, q.person), reverse=True)
