"""Search the news for the board changes the bulletin has just shown.

`NewsWatchChanges` lists who joined or left a board of a company the site has a
page for, by the bulletin day that named the company. For each change since
`--since` this asks the news searches (`sources`) for the person and the
company over the 14 days either side of it, and hands every article found that
the site does not already have to the crawl: the url store when
`URL_STORE_URL` is set (`--queue url_store`, the crawler's `--custom-pipeline`
door, which `ArticleDoneUrls` reads), predator's Postgres queue
(`--queue postgres`), or nowhere (`--queue none`). The crawl fetches them and
the article pipeline parses, scores and reads the people in them as it does
everything else; nothing here judges an article.

Each run writes what it asked and found to `--out` (a jsonl: one line per
query, then the summary), and keeps each answer on disk under `--cache`, keyed
by source, query and day, so a rerun the same day asks nothing again.

    koryta_news_watch --since 2026-11-24
    koryta_news_watch --changes changes.json --queue none --out run.jsonl
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from jobs.news_watch.google_resolve import GoogleNewsResolver
from jobs.news_watch.handoff import hand_off, known_article_keys
from jobs.news_watch.http import DiskCache, PoliteClient
from jobs.news_watch.models import Candidate, NewsHit, NewsQuery
from jobs.news_watch.queries import WINDOW_DAYS, build_queries, fold
from jobs.news_watch.sources import (
    ALL_SOURCES,
    DEFAULT_SOURCES,
    GOOGLE_NEWS_INTERVAL_S,
    NewsSource,
    SourceError,
    build_sources,
)
from jobs.news_watch.urls import domain_of, normalize_url, url_key
from scrapers.news.changes import BoardChange
from stores.storage import warsaw_tz

#: EX_TEMPFAIL, as the other jobs have it: some searches did not answer, and
#: the next run (the cache keeps what did) asks them again.
EXIT_TRY_LATER = 75

DEFAULT_CACHE = Path("versioned") / "news_watch" / "cache"
DEFAULT_OUT_DIR = Path("versioned") / "news_watch" / "runs"


@dataclass
class QueryLog:
    query: str
    person: str
    company: str
    krs: str
    start: str
    end: str
    changes: list[str]
    #: Per source: hits, seconds, cached, error.
    sources: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass
class RunSummary:
    changes: int = 0
    queries: int = 0
    requests: dict[str, int] = field(default_factory=dict)
    errors: dict[str, int] = field(default_factory=dict)
    queries_with_hits: dict[str, int] = field(default_factory=dict)
    hits: int = 0
    candidates: int = 0
    known: int = 0
    #: Google News links left unresolved, so not queued.
    redirects: int = 0
    #: Google News links resolved to the publisher's URL.
    resolved: int = 0
    queued: int = 0
    queue: str = "none"


def warsaw_today() -> date:
    return datetime.now(warsaw_tz).date()


def names_person(hit: NewsHit, query: NewsQuery) -> bool:
    text = fold(f"{hit.title} {hit.snippet or ''}")
    return fold(query.surname) in text


def collect(
    queries: Sequence[NewsQuery],
    sources: Sequence[NewsSource],
    day: str,
    log: Any = print,
    deadline: float | None = None,
) -> tuple[list[QueryLog], list[tuple[NewsQuery, NewsHit]], dict[str, int]]:
    """Every query through every source, in turn; a failing source costs only
    its own answer. Past `deadline` (monotonic) no query is asked; each left
    counts as an error of the run's."""
    logs: list[QueryLog] = []
    found: list[tuple[NewsQuery, NewsHit]] = []
    errors: dict[str, int] = {}
    for index, query in enumerate(queries):
        if deadline is not None and time.monotonic() >= deadline:
            errors["not_asked"] = len(queries) - index
            log(f"  out of time: {len(queries) - index} queries left for later")
            break
        entry = QueryLog(
            query=query.text,
            person=query.person,
            company=query.company,
            krs=query.krs,
            start=query.start.isoformat(),
            end=query.end.isoformat(),
            changes=list(query.changes),
        )
        for source in sources:
            started = time.monotonic()
            try:
                result = source.search(query, day)
            except (SourceError, ValueError) as e:
                errors[source.name] = errors.get(source.name, 0) + 1
                entry.sources[source.name] = {
                    "error": str(e)[:300],
                    "seconds": round(time.monotonic() - started, 2),
                }
                log(f"  {source.name}: {query.text}: {str(e)[:120]}")
                continue
            entry.sources[source.name] = {
                "hits": len(result.hits),
                "seconds": round(result.response.seconds, 2),
                "cached": result.response.cached,
                "titles": [h.title for h in result.hits[:10]],
            }
            found.extend((query, hit) for hit in result.hits)
        logs.append(entry)
    return logs, found, errors


def resolve_redirects(
    found: Sequence[tuple[NewsQuery, NewsHit]],
    resolver: GoogleNewsResolver,
    limit: int,
) -> tuple[list[tuple[NewsQuery, NewsHit]], int]:
    """Google's links swapped for the publishers', at most `limit` of them;
    those naming the person first. The rest stay links, which are not queued."""
    order = sorted(
        (i for i, (_, hit) in enumerate(found) if hit.redirect),
        key=lambda i: not names_person(found[i][1], found[i][0]),
    )
    chosen = set(order[:limit])
    result: list[tuple[NewsQuery, NewsHit]] = []
    resolved = 0
    for index, (query, hit) in enumerate(found):
        url = resolver.resolve(hit.url) if index in chosen else None
        if url:
            resolved += 1
            hit = replace(hit, url=url, domain=domain_of(url), redirect=False)
        result.append((query, hit))
    return result, resolved


def candidates_from(
    found: Iterable[tuple[NewsQuery, NewsHit]], known: set[str]
) -> tuple[list[Candidate], int, int]:
    """One candidate per article, the redirects and the known ones apart."""
    by_key: dict[str, Candidate] = {}
    known_count = redirects = 0
    for query, hit in found:
        if hit.redirect:
            redirects += 1
            continue
        key = url_key(hit.url)
        if key in known:
            known_count += 1
            continue
        candidate = by_key.get(key)
        if candidate is None:
            candidate = by_key[key] = Candidate(
                url=normalize_url(hit.url),
                key=key,
                title=hit.title,
                domain=hit.domain,
                published=hit.published,
                person=query.person,
                company=query.company,
                krs=query.krs,
            )
        if hit.source not in candidate.sources:
            candidate.sources.append(hit.source)
        if query.key not in candidate.queries:
            candidate.queries.append(query.key)
        candidate.names_person = candidate.names_person or names_person(hit, query)
    ordered = sorted(by_key.values(), key=lambda c: (not c.names_person, c.key))
    return ordered, known_count, redirects


def read_changes_file(path: Path) -> list[BoardChange]:
    text = path.read_text()
    rows = (
        json.loads(text)
        if text.lstrip().startswith("[")
        else [json.loads(line) for line in text.splitlines() if line.strip()]
    )
    fields = set(BoardChange.__dataclass_fields__)
    return [
        BoardChange(**{k: v for k, v in row.items() if k in fields}) for row in rows
    ]


def changes_from_pipeline() -> list[BoardChange]:
    from conductor import setup_context  # noqa: PLC0415
    from scrapers.news.changes import NewsWatchChanges  # noqa: PLC0415
    from scrapers.stores import ProcessPolicy, required_resources  # noqa: PLC0415

    ctx, _ = setup_context(
        required_resources(NewsWatchChanges), policy=ProcessPolicy(set())
    )
    frame = NewsWatchChanges().read_or_process(ctx)
    fields = list(BoardChange.__dataclass_fields__)
    records = frame.reindex(columns=fields).astype(object)
    records = records.where(records.notna(), None)
    return [
        BoardChange(**{str(k): v for k, v in row.items()})
        for row in records.to_dict("records")
    ]


def select(changes: Iterable[BoardChange], since: date) -> list[BoardChange]:
    return [c for c in changes if c.bulletin_day >= since.isoformat()]


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="koryta_news_watch", description=__doc__)
    parser.add_argument(
        "--since",
        type=date.fromisoformat,
        help="the first bulletin day to search for (default: yesterday in Warsaw)",
    )
    parser.add_argument(
        "--changes",
        type=Path,
        help="a json or jsonl of board changes to use instead of NewsWatchChanges",
    )
    parser.add_argument(
        "--sources",
        default=",".join(DEFAULT_SOURCES),
        help=f"comma-separated, of {', '.join(ALL_SOURCES)}; brave runs only "
        "with a key",
    )
    parser.add_argument("--max-queries", type=int, default=20)
    parser.add_argument(
        "--max-resolve",
        type=int,
        default=40,
        help="Google News links resolved to the publisher's URL at most, two "
        "calls each; those naming the person first",
    )
    parser.add_argument(
        "--max-minutes",
        type=float,
        help="ask no query after this many minutes; the rest is left for later",
    )
    parser.add_argument(
        "--min-interval",
        type=float,
        default=0.0,
        help="seconds between two calls to one source, over its own minimum",
    )
    parser.add_argument("--window-days", type=int, default=WINDOW_DAYS)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--out", type=Path)
    parser.add_argument(
        "--known-articles",
        type=Path,
        help="a jsonl (or .zst) of site nodes whose sourceURL counts as known; "
        "default: the article pages of KorytaNodes",
    )
    parser.add_argument(
        "--queue",
        choices=("auto", "url_store", "postgres", "none"),
        default="auto",
        help="auto: the url store when URL_STORE_URL is set, else none",
    )
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> int:
    today = warsaw_today()
    since = args.since or today - timedelta(days=1)
    changes = (
        read_changes_file(args.changes) if args.changes else changes_from_pipeline()
    )
    chosen = select(changes, since)
    queries = build_queries(chosen, today, args.window_days)[: args.max_queries]
    names = tuple(s.strip() for s in args.sources.split(",") if s.strip())
    sources = build_sources(names, DiskCache(args.cache), args.min_interval)
    print(
        f"{len(chosen)} board changes since {since}, {len(queries)} queries, "
        f"sources: {', '.join(s.name for s in sources) or 'none'}"
    )

    deadline = time.monotonic() + args.max_minutes * 60 if args.max_minutes else None
    logs, found, errors = collect(
        queries, sources, today.isoformat(), deadline=deadline
    )
    resolver = GoogleNewsResolver(
        PoliteClient(
            "google_news_resolve",
            max(GOOGLE_NEWS_INTERVAL_S, args.min_interval),
            cache=DiskCache(args.cache),
        )
    )
    found, resolved = resolve_redirects(found, resolver, args.max_resolve)
    known = known_article_keys(args.known_articles)
    candidates, known_count, redirects = candidates_from(found, known)
    queue, queued = hand_off(candidates, args.queue)

    summary = RunSummary(
        changes=len(chosen),
        queries=len(queries),
        requests={
            **{s.name: getattr(s, "client").calls for s in sources},
            "google_news_resolve": resolver.client.calls,
        },
        errors=errors,
        queries_with_hits={
            s.name: sum(1 for q in logs if q.sources.get(s.name, {}).get("hits"))
            for s in sources
        },
        hits=len(found),
        candidates=len(candidates),
        known=known_count,
        redirects=redirects,
        resolved=resolved,
        queued=queued,
        queue=queue,
    )
    out = args.out or DEFAULT_OUT_DIR / f"{today.isoformat()}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as fh:
        for entry in logs:
            fh.write(json.dumps({"query": asdict(entry)}, ensure_ascii=False) + "\n")
        for candidate in candidates:
            fh.write(
                json.dumps({"candidate": asdict(candidate)}, ensure_ascii=False) + "\n"
            )
        fh.write(json.dumps({"summary": asdict(summary)}, ensure_ascii=False) + "\n")
    print(json.dumps(asdict(summary), ensure_ascii=False))
    print(f"written to {out}")
    return EXIT_TRY_LATER if errors else 0


def main(argv: Sequence[str] | None = None) -> int:
    return run(parse_args(sys.argv[1:] if argv is None else argv))
