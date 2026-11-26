"""koryta_wikidata_people: keep the Wikidata cache `WikidataPeople` reads.

    koryta_wikidata_people                     # tonight's people (KorytaNodes)
    koryta_wikidata_people --people-file p.jsonl
    koryta_wikidata_people --max-requests 40 --recheck-hours 0

For every person of koryta.pl with a pl.wikipedia link:

1. title -> QID: from the `page` and `page_props` dumps (`dump`), fetched again
   only when Wikimedia has a newer one; what the dumps lack or name as a
   redirect from wbgetentities (sites=plwiki, 50 titles a call), and what that
   lacks from pl.wikipedia (redirects resolved), which also tells a dead link
   from an article without an item;
2. the items' claims from wbgetentities (50 ids a call), slimmed
   (`stores.wikidata.slim_entity`). An item already in the cache is read again
   only when its `lastrevid` moved, which wbgetentities props=info tells for 50
   items in a few kilobytes - at most once per --recheck-hours;
3. the labels of the parties, positions, occupations and qualifiers they name,
   once each.

Exit 0 when all is cached, 75 when the request cap or Wikimedia's refusals left
some for the next run (what was fetched is kept), 1 on anything else.
"""

import argparse
import importlib
import json
import os
import sys
import time
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import requests

from jobs.wikidata_people import dump
from jobs.wikidata_people.http import BudgetExhausted, PoliteClient, UpstreamBusy
from stores import wikidata as cache
from stores.wikidata import TitleEntry

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
PLWIKI_API = "https://pl.wikipedia.org/w/api.php"
BATCH = 50
EXIT_TRY_LATER = 75


def batches(items: Iterable[str], size: int = BATCH) -> Iterator[list[str]]:
    ordered = sorted(items)
    for i in range(0, len(ordered), size):
        yield ordered[i : i + size]


@dataclass
class Cache:
    """The job's state: `stores.wikidata`'s four files, in memory."""

    directory: str
    titles: dict[str, TitleEntry] = field(default_factory=dict)
    entities: dict[str, dict[str, Any]] = field(default_factory=dict)
    labels: dict[str, str | None] = field(default_factory=dict)
    state: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls, directory: str) -> "Cache":
        def path(name: str) -> str:
            return os.path.join(directory, name)

        return cls(
            directory,
            cache.titles_from_json(cache.read_json(path(cache.TITLES), {})),
            cache.read_json(path(cache.ENTITIES), {}),
            cache.read_json(path(cache.LABELS), {}),
            cache.read_json(path(cache.STATE), {}),
        )

    def save(self) -> None:
        def path(name: str) -> str:
            return os.path.join(self.directory, name)

        cache.write_json(path(cache.TITLES), cache.titles_to_json(self.titles))
        cache.write_json(path(cache.ENTITIES), self.entities)
        cache.write_json(path(cache.LABELS), self.labels)
        cache.write_json(path(cache.STATE), self.state)


@dataclass
class Options:
    #: "dump" maps titles off the dumps first; "api" asks wbgetentities only.
    title_source: str = "dump"
    #: How often the dumps' validators and the items' revisions are checked.
    recheck: timedelta = timedelta(hours=20)


@dataclass
class Report:
    titles: int = 0
    from_dump: int = 0
    from_api: int = 0
    checked: int = 0
    changed: int = 0
    fetched: int = 0
    labels: int = 0

    def said(self) -> str:
        return (
            f"{self.titles} titles ({self.from_dump} from the dumps, "
            f"{self.from_api} from the API); {self.checked} revisions checked, "
            f"{self.changed} changed; {self.fetched} items fetched; "
            f"{self.labels} labels fetched"
        )


class Sync:
    def __init__(
        self, client: PoliteClient, store: Cache, options: Options, now: datetime
    ) -> None:
        self.client = client
        self.store = store
        self.options = options
        self.now = now
        self.report = Report()
        self.fresh: set[str] = set()

    def due(self, key: str) -> bool:
        last = self.store.state.get(key)
        if not last:
            return True
        return self.now - datetime.fromisoformat(last) >= self.options.recheck

    def mark(self, key: str) -> None:
        self.store.state[key] = self.now.isoformat(timespec="seconds")

    # -- 1. titles ---------------------------------------------------------

    def refresh_dumps(self) -> bool:
        """Whether the dumps on disk changed. Asked at most once a recheck."""
        directory = os.path.join(self.store.directory, "dumps")
        metas = self.store.state.setdefault("dumps", {})
        changed = False
        for name in (dump.PAGE, dump.PAGE_PROPS):
            was, metas[name] = dump.refresh(
                self.client, name, directory, metas.get(name, {})
            )
            changed |= was
        self.mark("dumps_checked_at")
        return changed

    def dump_version(self) -> str:
        metas = self.store.state.get("dumps", {})
        return "|".join(
            str(metas.get(name, {}).get("etag"))
            for name in (dump.PAGE, dump.PAGE_PROPS)
        )

    def map_titles_from_dump(self, titles: set[str]) -> set[str]:
        """Map every title the dump has; the rest, for the API."""
        started = time.monotonic()
        found = dump.resolve(os.path.join(self.store.directory, "dumps"), titles)
        rest = set(titles)
        for title, (page, qid) in found.items():
            if page.redirect:
                continue
            self.store.titles[title] = (
                TitleEntry("found", qid, "dump")
                if qid
                else TitleEntry("no_item", None, "dump")
            )
            self.report.from_dump += 1
            rest.discard(title)
        self.store.state["titles_dump"] = self.dump_version()
        print(
            f"Dumps: {len(titles) - len(rest)} of {len(titles)} titles mapped "
            f"in {time.monotonic() - started:.0f} s"
        )
        return rest

    def titles_to_ask(self, titles: set[str]) -> set[str]:
        unknown = {t for t in titles if t not in self.store.titles}
        if self.due("revisions_checked_at"):
            # Dead links and articles without an item, asked again: an article
            # gets written, an item gets linked.
            unknown |= {
                t
                for t in titles
                if t in self.store.titles and self.store.titles[t].status != "found"
            }
        if self.options.title_source != "dump":
            return unknown
        if self.due("dumps_checked_at"):
            self.refresh_dumps()
        if self.store.state.get(
            "titles_dump"
        ) != self.dump_version() and os.path.exists(
            os.path.join(self.store.directory, "dumps", dump.PAGE)
        ):
            return self.map_titles_from_dump(titles)
        return unknown

    def ask_wikidata_titles(self, titles: set[str]) -> set[str]:
        """Titles -> items by sitelink; the ones it has none for."""
        rest = set()
        for batch in batches(titles):
            body = self.client.post_json(
                WIKIDATA_API,
                "titles",
                {
                    "action": "wbgetentities",
                    "format": "json",
                    "sites": "plwiki",
                    "titles": "|".join(batch),
                    "props": "info|claims|labels|sitelinks",
                    "languages": "pl",
                    "sitefilter": "plwiki",
                },
            )
            by_title = {}
            for entity in body.get("entities", {}).values():
                if "missing" in entity:
                    continue
                title = entity.get("sitelinks", {}).get("plwiki", {}).get("title")
                by_title[title] = entity
            for title in batch:
                entity = by_title.get(title)
                if entity is None:
                    rest.add(title)
                    continue
                self.keep_entity(entity)
                self.store.titles[title] = TitleEntry(
                    "found", entity["id"], "wbgetentities"
                )
                self.report.from_api += 1
        return rest

    def ask_plwiki(self, titles: set[str]) -> None:
        """What pl.wikipedia says of titles Wikidata has no sitelink for:
        a redirect to an article with an item, an article without one, or none."""
        for batch in batches(titles):
            body = self.client.post_json(
                PLWIKI_API,
                "plwiki",
                {
                    "action": "query",
                    "format": "json",
                    "formatversion": "2",
                    "redirects": "1",
                    "prop": "pageprops",
                    "ppprop": "wikibase_item",
                    "titles": "|".join(batch),
                },
            )
            query = body.get("query", {})
            alias = {
                a["from"]: a["to"]
                for a in query.get("normalized", []) + query.get("redirects", [])
            }
            pages = {page["title"]: page for page in query.get("pages", [])}
            for title in batch:
                final = title
                for _ in range(3):
                    final = alias.get(final, final)
                page = pages.get(final, {"missing": True})
                qid = page.get("pageprops", {}).get("wikibase_item")
                target = final if final != title else None
                if page.get("missing") or page.get("invalid"):
                    entry = TitleEntry("dead", None, "plwiki", target)
                elif qid:
                    entry = TitleEntry("found", qid, "plwiki", target)
                else:
                    entry = TitleEntry("no_item", None, "plwiki", target)
                self.store.titles[title] = entry
                self.report.from_api += 1

    # -- 2. items ----------------------------------------------------------

    def keep_entity(self, entity: dict[str, Any]) -> None:
        slim = cache.slim_entity(entity)
        slim["fetched_at"] = self.now.isoformat(timespec="seconds")
        self.store.entities[slim["qid"]] = slim
        self.fresh.add(slim["qid"])
        self.report.fetched += 1

    def redirect_titles(self, old: str, new: str) -> None:
        for title, entry in self.store.titles.items():
            if entry.qid == old:
                self.store.titles[title] = TitleEntry(
                    entry.status, new, entry.source, entry.target
                )

    def forget_titles(self, qid: str) -> None:
        for title in [t for t, e in self.store.titles.items() if e.qid == qid]:
            del self.store.titles[title]

    def changed_items(self, qids: set[str]) -> set[str]:
        """The cached items whose revision moved since they were read."""
        changed = set()
        for batch in batches(qids):
            body = self.client.post_json(
                WIKIDATA_API,
                "revisions",
                {
                    "action": "wbgetentities",
                    "format": "json",
                    "ids": "|".join(batch),
                    "props": "info",
                },
            )
            for key, entity in body.get("entities", {}).items():
                self.report.checked += 1
                cached = self.store.entities.get(key, {})
                if "missing" in entity or entity.get("id", key) != key:
                    changed.add(key)
                elif entity.get("lastrevid") != cached.get("lastrevid"):
                    changed.add(key)
        self.report.changed += len(changed)
        return changed

    def fetch_items(self, qids: set[str]) -> None:
        for batch in batches(qids):
            body = self.client.post_json(
                WIKIDATA_API,
                "items",
                {
                    "action": "wbgetentities",
                    "format": "json",
                    "ids": "|".join(batch),
                    "props": "info|claims|labels",
                    "languages": "pl",
                },
            )
            for key, entity in body.get("entities", {}).items():
                if "missing" in entity:
                    # Deleted: its titles are asked again next run.
                    self.store.entities.pop(key, None)
                    self.forget_titles(key)
                    continue
                if entity["id"] != key:
                    self.redirect_titles(key, entity["id"])
                    self.store.entities.pop(key, None)
                self.keep_entity(entity)

    def fetch_labels(self) -> None:
        wanted: set[str] = set()
        for entity in self.store.entities.values():
            wanted |= cache.referenced_items(entity)
        for batch in batches(wanted - self.store.labels.keys()):
            body = self.client.post_json(
                WIKIDATA_API,
                "labels",
                {
                    "action": "wbgetentities",
                    "format": "json",
                    "ids": "|".join(batch),
                    "props": "labels",
                    "languages": "pl|en",
                },
            )
            for key, entity in body.get("entities", {}).items():
                labels = entity.get("labels", {})
                self.store.labels[key] = (
                    labels.get("pl") or labels.get("en") or {}
                ).get("value")
                self.report.labels += 1

    # -- the run -----------------------------------------------------------

    def run(self, titles: set[str]) -> None:
        self.report.titles = len(titles)
        ask = self.titles_to_ask(titles)
        if ask:
            self.ask_plwiki(self.ask_wikidata_titles(ask))
        qids = {
            e.qid
            for t, e in self.store.titles.items()
            if t in titles and e.status == "found" and e.qid
        }
        due = self.due("revisions_checked_at")
        cached = (qids & self.store.entities.keys()) - self.fresh
        if cached and due:
            self.fetch_items(self.changed_items(cached))
        self.fetch_items(qids - self.store.entities.keys())
        self.fetch_labels()
        if due:
            # Only once everything is in: a run cut short checks again.
            self.mark("revisions_checked_at")


def people_from_file(path: str) -> list[dict[str, Any]]:
    """People as the site's export writes them, one JSON object a line;
    .zst read with compression.zstd (3.14) or zstandard where installed."""
    with open(path, "rb") as f:
        raw = f.read()
    if path.endswith(".zst"):
        try:
            zstd: Any = importlib.import_module("compression.zstd")
        except ImportError:
            zstd = importlib.import_module("zstandard")
        raw = zstd.decompress(raw)
    return [json.loads(line) for line in raw.decode().splitlines() if line.strip()]


def people_from_nodes() -> list[dict[str, Any]]:
    from conductor import setup_context  # noqa: PLC0415
    from scrapers.koryta.download import KorytaNodes  # noqa: PLC0415

    ctx, _ = setup_context()
    nodes = KorytaNodes().read_or_process(ctx)
    return [{str(k): v for k, v in row.items()} for row in nodes.to_dict("records")]


def linked_titles(people: Iterable[dict[str, Any]]) -> set[str]:
    titles = set()
    for person in people:
        if person.get("type", "person") != "person":
            continue
        title = cache.title_from_url(person.get("wikipedia") or "")
        if title:
            titles.add(title)
    return titles


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="koryta_wikidata_people", description=__doc__)
    p.add_argument("--people-file", help="JSONL(.zst) of people, not KorytaNodes")
    p.add_argument("--cache-dir", default=cache.CACHE_DIR)
    p.add_argument("--max-requests", type=int, default=100)
    p.add_argument("--min-gap", type=float, default=1.0, help="seconds")
    p.add_argument("--recheck-hours", type=float, default=20.0)
    p.add_argument("--title-source", choices=("dump", "api"), default="dump")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    # Pipelines read sys.argv themselves; the job's flags must not reach them.
    sys.argv = sys.argv[:1]
    people = (
        people_from_file(args.people_file) if args.people_file else people_from_nodes()
    )
    titles = linked_titles(people)
    store = Cache.load(args.cache_dir)
    client = PoliteClient(requests.Session(), args.max_requests, min_gap=args.min_gap)
    options = Options(args.title_source, timedelta(hours=args.recheck_hours))
    sync = Sync(client, store, options, datetime.now(UTC))
    started = time.monotonic()
    code = 0
    try:
        sync.run(titles)
    except (BudgetExhausted, UpstreamBusy) as e:
        print(f"Stopped, the rest is the next run's: {e}")
        code = EXIT_TRY_LATER
    finally:
        store.save()
        print(f"Wikidata: {sync.report.said()}")
        print(
            f"Network: {client.stats.said()}; {time.monotonic() - started:.1f} s in all"
        )
    return code
