"""What a news search is asked, what it answers, and what goes to the crawl."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class NewsQuery:
    """One person at one company, searched over one window of days."""

    person: str
    company: str
    krs: str
    start: date
    end: date
    #: The changes this query stands for: `kind:role:change_date`.
    changes: tuple[str, ...] = ()

    @property
    def text(self) -> str:
        """Both names quoted: a hit has to name the person and the company."""
        return f'"{self.person}" "{self.company}"'

    @property
    def key(self) -> str:
        """What the cache and the dedupe know a query by."""
        raw = f"{self.text}|{self.start.isoformat()}|{self.end.isoformat()}"
        return hashlib.sha1(raw.encode()).hexdigest()[:16]

    @property
    def surname(self) -> str:
        return self.person.split()[-1] if self.person.split() else self.person


@dataclass(frozen=True)
class NewsHit:
    """One article a source returned for a query."""

    source: str
    url: str
    title: str
    domain: str
    #: ISO date or datetime, as the source gave it; None when it gave none.
    published: str | None = None
    snippet: str | None = None
    #: The publisher's own URL is not known (a Google News redirect).
    redirect: bool = False


@dataclass
class Candidate:
    """An article to crawl, with every query and source that found it."""

    url: str
    key: str
    title: str
    domain: str
    published: str | None
    person: str
    company: str
    krs: str
    sources: list[str] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    #: The surname is in the title or the snippet.
    names_person: bool = False

    def context(self) -> dict[str, object]:
        """What the url store keeps with the url, for whoever reads it later."""
        return {
            "person": self.person,
            "company": self.company,
            "krs": self.krs,
            "sources": self.sources,
            "queries": self.queries,
            "title": self.title,
            "published": self.published,
        }
