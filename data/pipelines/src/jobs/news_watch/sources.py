"""The news searches, each behind `NewsSource`.

- GDELT DOC 2.0 (`gdelt`): free, keyless, Polish sources by `sourcelang`, the
  last three months. Its 429 says "one every 5 seconds"; it gets 30
  (`GDELT_INTERVAL_S`).
- Google News RSS (`google_news`): free and keyless, a call every 2 s. Its
  links are Google's; `google_resolve` swaps them for the publishers' URLs,
  which are what the crawl fetches. Used as low-volume discovery: about 20
  searches a night (decision on 2026-11-26).
- Brave Search news (`brave`): a key in `BRAVE_SEARCH_API_KEY`, metered. Its
  standard plans allow no storing of results, so its answers are not cached.

Bing's Search API was retired on 2025-08-11 and Google's Custom Search JSON
API takes no new customers; neither is here.
"""

from __future__ import annotations

import json
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Protocol

from jobs.news_watch.http import DiskCache, PoliteClient, Response
from jobs.news_watch.models import NewsHit, NewsQuery
from jobs.news_watch.urls import domain_of

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
GOOGLE_NEWS_URL = "https://news.google.com/rss/search"
BRAVE_URL = "https://api.search.brave.com/res/v1/news/search"
BRAVE_KEY_ENV = "BRAVE_SEARCH_API_KEY"

MAX_RECORDS = 50

#: GDELT's 429 asks for one call in 5 s; measured on 2026-11-26, sequential
#: calls 20 s apart (10-20 s each) still drew a 429 on every other query.
GDELT_INTERVAL_S = 30.0
GOOGLE_NEWS_INTERVAL_S = 2.0


class SourceError(Exception):
    """The source answered with something other than results."""


@dataclass
class SearchResult:
    hits: list[NewsHit]
    response: Response


class NewsSource(Protocol):
    name: str

    def search(self, query: NewsQuery, day: str) -> SearchResult: ...


def _ok(response: Response, source: str) -> str:
    if response.status != 200:
        raise SourceError(f"{source}: HTTP {response.status}: {response.text[:200]}")
    return response.text


# -- GDELT ------------------------------------------------------------------


def gdelt_params(query: NewsQuery) -> dict[str, str]:
    start = datetime.combine(query.start, datetime.min.time())
    end = datetime.combine(query.end, datetime.min.time()) + timedelta(days=1)
    return {
        "query": f"{query.text} sourcelang:polish",
        "mode": "ArtList",
        "format": "json",
        "maxrecords": str(MAX_RECORDS),
        "sort": "DateDesc",
        "startdatetime": start.strftime("%Y%m%d%H%M%S"),
        "enddatetime": end.strftime("%Y%m%d%H%M%S"),
    }


def parse_gdelt(body: str) -> list[NewsHit]:
    """ArtList JSON; `{}` when nothing matched, plain text when refused."""
    text = body.strip()
    if not text:
        return []
    if not text.startswith("{"):
        raise SourceError(f"gdelt: {text[:200]}")
    data = json.loads(text, strict=False)
    hits = []
    for article in data.get("articles") or []:
        url = article.get("url")
        if not url:
            continue
        seen = article.get("seendate") or ""
        published = None
        if len(seen) >= 8:
            published = f"{seen[:4]}-{seen[4:6]}-{seen[6:8]}"
        hits.append(
            NewsHit(
                source="gdelt",
                url=url,
                title=(article.get("title") or "").strip(),
                domain=article.get("domain") or domain_of(url),
                published=published,
            )
        )
    return hits


@dataclass
class GdeltSource:
    client: PoliteClient
    name: str = "gdelt"

    def search(self, query: NewsQuery, day: str) -> SearchResult:
        params = gdelt_params(query)
        response = self.client.get(GDELT_URL, params, query.key, day)
        return SearchResult(parse_gdelt(_ok(response, self.name)), response)


# -- Google News RSS --------------------------------------------------------


def google_news_params(query: NewsQuery) -> dict[str, str]:
    after = query.start - timedelta(days=1)
    before = query.end + timedelta(days=1)
    return {
        "q": f"{query.text} after:{after.isoformat()} before:{before.isoformat()}",
        "hl": "pl",
        "gl": "PL",
        "ceid": "PL:pl",
    }


def parse_google_news(body: str) -> list[NewsHit]:
    """The RSS items. A title ends with " - <publisher>"; the link is Google's."""
    # An RSS feed declares no entities; one that does is refused unread.
    if "<!ENTITY" in body or "<!DOCTYPE" in body:
        raise SourceError("google_news: a feed with a DTD")
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise SourceError(f"google_news: {e}") from e
    hits = []
    for item in root.iter("item"):
        link = (item.findtext("link") or "").strip()
        if not link:
            continue
        title = (item.findtext("title") or "").strip()
        source = item.find("source")
        publisher = source.get("url", "") if source is not None else ""
        if source is not None and source.text and title.endswith(f" - {source.text}"):
            title = title[: -len(source.text) - 3]
        published = None
        if date_text := item.findtext("pubDate"):
            try:
                published = (
                    parsedate_to_datetime(date_text)
                    .astimezone(timezone.utc)
                    .date()
                    .isoformat()
                )
            except (TypeError, ValueError):
                published = None
        hits.append(
            NewsHit(
                source="google_news",
                url=link,
                title=title,
                domain=domain_of(publisher) if publisher else domain_of(link),
                published=published,
                redirect="news.google.com" in link,
            )
        )
    return hits


@dataclass
class GoogleNewsSource:
    client: PoliteClient
    name: str = "google_news"

    def search(self, query: NewsQuery, day: str) -> SearchResult:
        response = self.client.get(
            GOOGLE_NEWS_URL, google_news_params(query), query.key, day
        )
        return SearchResult(parse_google_news(_ok(response, self.name)), response)


# -- Brave ------------------------------------------------------------------


def brave_params(query: NewsQuery) -> dict[str, str]:
    return {
        "q": query.text,
        "country": "PL",
        "search_lang": "pl",
        "count": str(MAX_RECORDS),
        "freshness": f"{query.start.isoformat()}to{query.end.isoformat()}",
    }


def parse_brave(body: str) -> list[NewsHit]:
    data = json.loads(body)
    hits = []
    for result in data.get("results") or []:
        url = result.get("url")
        if not url:
            continue
        page_age = result.get("page_age") or ""
        hits.append(
            NewsHit(
                source="brave",
                url=url,
                title=(result.get("title") or "").strip(),
                domain=(result.get("meta_url") or {}).get("hostname") or domain_of(url),
                published=page_age[:10] or None,
                snippet=result.get("description"),
            )
        )
    return hits


@dataclass
class BraveSource:
    client: PoliteClient
    key: str = field(repr=False, default="")
    name: str = "brave"

    def search(self, query: NewsQuery, day: str) -> SearchResult:
        response = self.client.get(
            BRAVE_URL,
            brave_params(query),
            query.key,
            day,
            headers={"X-Subscription-Token": self.key, "Accept": "application/json"},
        )
        return SearchResult(parse_brave(_ok(response, self.name)), response)


# -- the set ----------------------------------------------------------------

DEFAULT_SOURCES = ("gdelt", "google_news", "brave")
ALL_SOURCES = ("gdelt", "google_news", "brave")


def build_sources(
    names: tuple[str, ...], cache: DiskCache | None, min_interval_s: float = 0.0
) -> list[NewsSource]:
    """The named sources that can run here. Brave without a key is left out."""
    sources: list[NewsSource] = []
    for name in names:
        if name == "gdelt":
            client = PoliteClient(
                "gdelt", max(GDELT_INTERVAL_S, min_interval_s), cache=cache
            )
            sources.append(GdeltSource(client))
        elif name == "google_news":
            client = PoliteClient(
                "google_news", max(GOOGLE_NEWS_INTERVAL_S, min_interval_s), cache=cache
            )
            sources.append(GoogleNewsSource(client))
        elif name == "brave":
            key = os.environ.get(BRAVE_KEY_ENV, "")
            if key:
                client = PoliteClient("brave", max(1.0, min_interval_s), cache=None)
                sources.append(BraveSource(client, key))
        else:
            raise ValueError(
                f"unknown source {name!r}; known: {', '.join(ALL_SOURCES)}"
            )
    return sources
