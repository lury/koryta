"""The Wikidata job against recorded answers: no network.

The fixtures are wbgetentities and pl.wikipedia answers recorded on
2026-11-26 (claims cut to the properties read, references dropped): Marcin
Kierwiński (Q11767619) for parties and positions with qualifiers, Arkadiusz
Ptak (Q110692416) for a preferred day beside a year, and two dead links.
"""

import copy
import gzip
import io
import json
from pathlib import Path
from typing import Any

import pytest

import jobs.wikidata_people as job
from jobs.wikidata_people import Cache, Options, Sync, dump
from jobs.wikidata_people.http import (
    BudgetExhausted,
    PoliteClient,
    UpstreamBusy,
    retry_after,
    user_agent,
)

FIXTURES = Path(__file__).parent / "fixtures"
KIERWINSKI = "Marcin Kierwiński"
PTAK = "Arkadiusz Ptak"
DEAD = "Shivan Fate"


def fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / f"{name}.json").read_text())


def sql(table: str, rows: list[str], one_line: bool = False) -> bytes:
    """A dump as mysqldump writes it: MariaDB 10.11's row a line, or the
    older statement on one line."""
    head = f"-- MariaDB dump\nCREATE TABLE `{table}` (...);\n"
    if one_line:
        body = f"INSERT INTO `{table}` VALUES " + ",".join(rows) + ";\n"
    else:
        body = f"INSERT INTO `{table}` VALUES\n" + ",\n".join(rows) + ";\n"
    return gzip.compress((head + body).encode())


PAGE_DUMP = sql(
    "page",
    [
        "(100,0,'Marcin_Kierwiński',0,0,0.1,'20261101','20261101',1,10,'wikitext',NULL)",
        "(200,0,'Arkadiusz_Ptak',0,0,0.2,'20261101','20261101',1,10,'wikitext',NULL)",
        # A talk page of the same name is not the article.
        "(201,1,'Arkadiusz_Ptak',0,0,0.2,'20261101','20261101',1,10,'wikitext',NULL)",
    ],
)
PROPS_DUMP = sql(
    "page_props",
    [
        "(100,'wikibase_item','Q11767619',NULL)",
        "(100,'page_image_free','X.jpg',NULL)",
        "(200,'wikibase_item','Q110692416',NULL)",
        "(201,'wikibase_item','Q999',NULL)",
    ],
)


class FakeRaw:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def stream(self, size: int, decode_content: bool = False):
        for i in range(0, len(self.body), size):
            yield self.body[i : i + size]


class FakeResponse:
    def __init__(
        self, status: int, body: bytes = b"", headers: dict[str, str] | None = None
    ) -> None:
        self.status_code = status
        self.content = body
        self.headers = headers or {}
        self.raw = FakeRaw(body)

    def json(self) -> Any:
        return json.loads(self.content)

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        pass


def answer(body: Any) -> FakeResponse:
    return FakeResponse(200, json.dumps(body).encode())


class FakeWikimedia:
    """Stands in for requests.Session, answering from the fixtures."""

    def __init__(self) -> None:
        self.headers: dict[str, str] = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.items = fixture("wbgetentities-items")["entities"]
        #: Revisions the server reports now, by QID, where they moved.
        self.revisions: dict[str, int] = {}
        self.queued: list[FakeResponse] = []

    def kinds(self) -> list[str]:
        return [kind for kind, _ in self.calls]

    def request(self, method, url, timeout=None, data=None, headers=None, stream=False):
        if self.queued:
            self.calls.append(("queued", {}))
            return self.queued.pop(0)
        for name, body, etag in (
            (dump.PAGE, PAGE_DUMP, '"page-1"'),
            (dump.PAGE_PROPS, PROPS_DUMP, '"props-1"'),
        ):
            if url.endswith(name):
                self.calls.append(("dump", headers or {}))
                if (headers or {}).get("If-None-Match") == etag:
                    return FakeResponse(304)
                return FakeResponse(200, body, {"ETag": etag})
        data = data or {}
        if "pl.wikipedia.org" in url:
            self.calls.append(("plwiki", data))
            return answer(fixture("plwiki-query"))
        if "titles" in data:
            self.calls.append(("titles", data))
            return answer(self.by_titles(data["titles"].split("|")))
        ids = data["ids"].split("|")
        self.calls.append((data["props"], data))
        if data["props"] == "info":
            return answer({"entities": {q: self.info(q) for q in ids}})
        if data["props"] == "labels":
            return answer(
                {
                    "entities": {
                        q: {"id": q, "labels": {"pl": {"value": f"etykieta {q}"}}}
                        for q in ids
                    }
                }
            )
        return answer({"entities": {q: self.item(q) for q in ids}})

    def item(self, qid: str) -> dict[str, Any]:
        item = copy.deepcopy(self.items[qid])
        item["lastrevid"] = self.revisions.get(qid, item["lastrevid"])
        return item

    def info(self, qid: str) -> dict[str, Any]:
        item = self.item(qid)
        return {"id": qid, "lastrevid": item["lastrevid"], "type": "item"}

    def by_titles(self, titles: list[str]) -> dict[str, Any]:
        found: dict[str, Any] = {}
        for i, title in enumerate(titles):
            match = [
                e for e in self.items.values() if e["labels"]["pl"]["value"] == title
            ]
            if match:
                entity = copy.deepcopy(match[0])
                entity["sitelinks"] = {"plwiki": {"site": "plwiki", "title": title}}
                found[entity["id"]] = entity
            else:
                found[f"-{i + 1}"] = {"site": "plwiki", "title": title, "missing": ""}
        return {"entities": found, "success": 1}


TITLES = {KIERWINSKI, PTAK, DEAD}


@pytest.fixture
def wikimedia() -> FakeWikimedia:
    return FakeWikimedia()


def run(
    wikimedia: FakeWikimedia,
    directory: Path,
    now: str = "2026-11-26T03:00:00+00:00",
    titles: set[str] = TITLES,
    options: Options | None = None,
    max_requests: int = 100,
) -> Sync:
    from datetime import datetime  # noqa: PLC0415

    store = Cache.load(str(directory))
    client = PoliteClient(wikimedia, max_requests, sleep=lambda s: None)  # type: ignore[arg-type]
    sync = Sync(client, store, options or Options(), datetime.fromisoformat(now))
    try:
        sync.run(titles)
    finally:
        store.save()
    return sync


# ─── a first run ─────────────────────────────────────────────


def test_a_cold_run_maps_titles_off_the_dumps_and_reads_every_item_once(
    wikimedia, tmp_path
):
    sync = run(wikimedia, tmp_path)

    assert wikimedia.kinds() == [
        "dump",
        "dump",
        "titles",  # only the title the dumps lack
        "plwiki",
        "info|claims|labels",
        "labels",
    ]
    store = Cache.load(str(tmp_path))
    assert store.titles[KIERWINSKI].qid == "Q11767619"
    assert store.titles[KIERWINSKI].source == "dump"
    assert store.titles[DEAD].status == "dead"
    assert store.entities["Q11767619"]["lastrevid"] == 2568493618
    assert store.labels["Q19269361"] == "etykieta Q19269361"
    assert sync.report.from_dump == 2
    assert sync.report.fetched == 2
    assert wikimedia.headers["User-Agent"] == user_agent()
    assert user_agent().startswith("koryta-pipelines/")


def test_without_the_dumps_titles_come_from_wbgetentities(wikimedia, tmp_path):
    run(wikimedia, tmp_path, options=Options(title_source="api"))

    # The item comes whole with its sitelink: nothing to fetch after it.
    assert wikimedia.kinds() == ["titles", "plwiki", "labels"]
    store = Cache.load(str(tmp_path))
    assert store.titles[PTAK].source == "wbgetentities"
    assert store.entities["Q110692416"]["label"] == PTAK


# ─── the runs after it ───────────────────────────────────────


def test_a_second_run_inside_the_recheck_window_makes_no_request(wikimedia, tmp_path):
    run(wikimedia, tmp_path)
    wikimedia.calls.clear()

    run(wikimedia, tmp_path, now="2026-11-26T12:00:00+00:00")

    assert wikimedia.calls == []


def test_the_next_night_checks_revisions_and_fetches_nothing_unchanged(
    wikimedia, tmp_path
):
    run(wikimedia, tmp_path)
    before = Cache.load(str(tmp_path)).entities
    wikimedia.calls.clear()

    sync = run(wikimedia, tmp_path, now="2026-11-27T03:00:00+00:00")

    # Both dumps answer 304 to their own ETag; the dead link is asked again.
    assert wikimedia.kinds() == ["dump", "dump", "titles", "plwiki", "info"]
    assert [c[1]["If-None-Match"] for c in wikimedia.calls[:2]] == [
        '"page-1"',
        '"props-1"',
    ]
    assert sync.report.checked == 2
    assert sync.report.fetched == 0
    assert Cache.load(str(tmp_path)).entities == before


def test_only_the_item_whose_revision_moved_is_read_again(wikimedia, tmp_path):
    run(wikimedia, tmp_path)
    wikimedia.calls.clear()
    wikimedia.revisions["Q110692416"] = 2574891571

    sync = run(wikimedia, tmp_path, now="2026-11-27T03:00:00+00:00")

    [(_, fetched)] = [c for c in wikimedia.calls if c[0] == "info|claims|labels"]
    assert fetched["ids"] == "Q110692416"
    assert sync.report.changed == 1
    entities = Cache.load(str(tmp_path)).entities
    assert entities["Q110692416"]["lastrevid"] == 2574891571
    assert entities["Q11767619"]["fetched_at"] == "2026-11-26T03:00:00+00:00"


def test_a_run_stopped_by_the_cap_keeps_what_it_got_and_finishes_next_time(
    wikimedia, tmp_path
):
    with pytest.raises(BudgetExhausted):
        run(wikimedia, tmp_path, max_requests=4)
    store = Cache.load(str(tmp_path))
    assert store.entities == {}
    assert "revisions_checked_at" not in store.state
    wikimedia.calls.clear()

    run(wikimedia, tmp_path, now="2026-11-26T03:05:00+00:00")

    # The dumps were checked minutes ago and are not asked again.
    assert wikimedia.kinds() == ["titles", "plwiki", "info|claims|labels", "labels"]
    assert set(Cache.load(str(tmp_path)).entities) == {"Q11767619", "Q110692416"}


def test_main_exits_75_at_the_cap_and_saves(wikimedia, tmp_path, monkeypatch):
    people = tmp_path / "people.jsonl"
    people.write_text(
        "\n".join(
            json.dumps({"id": str(i), "type": "person", "wikipedia": url})
            for i, url in enumerate(
                [
                    "https://pl.wikipedia.org/wiki/Marcin_Kierwi%C5%84ski",
                    "https://pl.wikipedia.org/wiki/Arkadiusz_Ptak",
                    "https://pl.wikipedia.org/wiki/Shivan_Fate",
                    "https://en.wikipedia.org/wiki/Someone",
                ]
            )
        )
    )
    monkeypatch.setattr(job.requests, "Session", lambda: wikimedia)
    cache_dir = tmp_path / "cache"
    argv = ["--people-file", str(people), "--cache-dir", str(cache_dir)]

    assert job.main([*argv, "--max-requests", "3", "--min-gap", "0"]) == 75
    assert (cache_dir / "dumps" / dump.PAGE).read_bytes() == PAGE_DUMP
    assert job.main([*argv, "--min-gap", "0"]) == 0
    assert len(json.loads((cache_dir / "entities.json").read_text())) == 2


# ─── politeness ──────────────────────────────────────────────


def test_a_429_waits_out_its_retry_after():
    wikimedia = FakeWikimedia()
    wikimedia.queued = [
        FakeResponse(429, b"", {"Retry-After": "7"}),
        FakeResponse(503, b""),
        answer({"ok": 1}),
    ]
    waits: list[float] = []
    client = PoliteClient(wikimedia, 10, sleep=waits.append)  # type: ignore[arg-type]

    assert client.post_json("https://www.wikidata.org/w/api.php", "items", {}) == {
        "ok": 1
    }
    # 7 s as asked, then the 503's backoff with no Retry-After.
    assert [w for w in waits if w >= 5] == [7.0, 10.0]
    assert client.stats.requests == 3
    assert client.stats.retries == 2


def test_a_retry_after_past_the_longest_wait_gives_up():
    wikimedia = FakeWikimedia()
    wikimedia.queued = [FakeResponse(429, b"", {"Retry-After": "3600"})]
    client = PoliteClient(wikimedia, 10, sleep=lambda s: None)  # type: ignore[arg-type]

    with pytest.raises(UpstreamBusy):
        client.request("GET", "https://www.wikidata.org/w/api.php", "items")


def test_requests_keep_the_gap_between_them():
    wikimedia = FakeWikimedia()
    wikimedia.queued = [answer({}), answer({})]
    now = [0.0]
    waits: list[float] = []
    client = PoliteClient(
        wikimedia,  # type: ignore[arg-type]
        10,
        min_gap=1.0,
        sleep=waits.append,
        clock=lambda: now[0],
    )
    client.request("GET", "https://x", "a")
    now[0] = 0.25
    client.request("GET", "https://x", "a")

    assert waits == [0.75]


def test_retry_after_as_an_http_date():
    from datetime import UTC, datetime  # noqa: PLC0415

    now = datetime(2026, 11, 26, 3, 0, 0, tzinfo=UTC)
    headers = {"Retry-After": "Thu, 26 Nov 2026 03:00:30 GMT"}
    assert retry_after(headers, now) == 30.0
    assert retry_after({}, now) is None


# ─── the dumps ───────────────────────────────────────────────


def test_the_dump_finds_articles_by_title_and_skips_other_namespaces():
    lines = list(dump._lines_of(io.BytesIO(gzip.decompress(PAGE_DUMP))))
    pages = dump.pages_named(lines, {KIERWINSKI, PTAK, DEAD})

    assert pages == {
        KIERWINSKI: dump.Page(100, False),
        PTAK: dump.Page(200, False),
    }


def test_the_dump_reads_quoted_titles_redirects_and_one_line_statements():
    page = sql(
        "page",
        [
            r"(7,0,'Jan_\'Janek\'_Nowak',0,0,0.5,'2026','2026',1,1,'wikitext',NULL)",
            "(8,0,'Stary_tytuł',1,0,0.5,'2026','2026',1,1,'wikitext',NULL)",
        ],
        one_line=True,
    )
    lines = list(dump._lines_of(io.BytesIO(gzip.decompress(page))))

    assert dump.pages_named(lines, {"Jan 'Janek' Nowak", "Stary tytuł"}) == {
        "Jan 'Janek' Nowak": dump.Page(7, False),
        "Stary tytuł": dump.Page(8, True),
    }


def test_page_props_give_the_item_of_each_page_asked_for():
    lines = list(dump._lines_of(io.BytesIO(gzip.decompress(PROPS_DUMP))))

    assert dump.items_of(lines, {100, 201}) == {100: "Q11767619", 201: "Q999"}
