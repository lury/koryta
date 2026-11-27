"""Reading the index: pace, retries, the disk cache, the backfill's cursor and
the bulletin's daily update - over api-krs answers recorded on 2026-11-26."""

import itertools
import json
from datetime import datetime
from pathlib import Path

import pandas as pd
import pytest
import requests
import zstandard

import jobs.krs_full_index as job
from jobs.krs_full_index import fetch
from jobs.krs_full_index.cache import ResponseCache
from scrapers.krs.full_index import (
    REASON_NEVER,
    SOURCE_CACHE,
    FullRead,
    decompress,
    fold,
    ledger_of,
    queue_for_index,
)
from scrapers.krs.register import STATUS_FAILED, STATUS_OK, STATUS_STRUCK_OFF

FIXTURES = Path(__file__).parents[3] / "scrapers/krs/tests/fixtures/odpis_pelny"
A, B, S = "0000037863", "0001273959", "0000163560"
NOT_FOUND = json.dumps({"title": "Not Found", "status": 404}).encode()


def recorded(name: str) -> bytes:
    return (
        zstandard.ZstdDecompressor()
        .decompressobj()
        .decompress((FIXTURES / f"{name}.json.zst").read_bytes())
    )


class Response:
    def __init__(
        self, status_code: int, content: bytes = b"", headers: dict | None = None
    ):
        self.status_code = status_code
        self.content = content
        self.headers = headers or {}

    def json(self):
        return json.loads(self.content)


class Api:
    """api-krs as recorded: each company in its register, 404 in the other.
    `script` puts answers ahead of that for one URL."""

    def __init__(self, script: dict[str, list[Response]] | None = None):
        self.bodies = {
            (A, "P"): recorded(f"{A}-P"),
            (B, "P"): recorded(f"{B}-P"),
            (S, "S"): recorded(f"{S}-S"),
        }
        self.script = script or {}
        self.asked: list[str] = []
        self.headers: list[dict] = []

    def get(self, url, timeout, headers):
        self.asked.append(url)
        self.headers.append(headers)
        if self.script.get(url):
            return self.script[url].pop(0)
        krs = url.split("OdpisPelny/")[1].split("?")[0]
        rejestr = url.split("rejestr=")[1][0]
        content = self.bodies.get((krs, rejestr))
        return Response(200, content) if content else Response(404, NOT_FOUND)


def url(krs, rejestr="P"):
    return fetch.PELNY_URL.format(krs=krs, rejestr=rejestr)


class Clock:
    def __init__(self):
        self.t = 0.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.t += seconds


def when() -> datetime:
    return datetime.fromisoformat("2026-11-26T03:10:00+01:00")


def fetcher(api, clock=None, max_requests=None, interval=1.0, now=when):
    clock = clock or Clock()
    return fetch.Fetcher(
        api,  # type: ignore[arg-type]
        fetch.Pacer(interval, clock, clock.sleep),
        now,
        "run-1",
        max_requests,
        sleep=clock.sleep,
        clock=clock,
    )


class Store:
    """The shared cache's create-only bucket."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def put(self, name: str, data: bytes) -> str:
        assert name not in self.objects, f"{name} written twice"
        self.objects[name] = data
        return name

    def reads(self) -> list[FullRead]:
        return [
            FullRead.from_line(line)
            for name, data in self.objects.items()
            for line in decompress(name, data).decode().split("\n")
            if line
        ]


def run(todo, api, tmp_path, store=None, **kw):
    store = store or Store()
    summary = job.RunSummary(run="run-1", started="2026-11-26T03:10:00+01:00")
    clock = kw.pop("clock", None) or Clock()
    code = job.read_index(
        todo,
        fetcher(api, clock, kw.pop("max_requests", None), now=kw.pop("now", when)),
        ResponseCache(str(tmp_path / "cache")),
        # A run of its own each time, as every real run has.
        job.PartLog(store.put, f"run-{next(RUNS)}", kw.pop("flush_every", 200)),
        summary,
        **kw,
    )
    return code, summary, store


RUNS = itertools.count()


def never(*numbers, rejestr=None):
    return [job.QueuedRead(k, REASON_NEVER, rejestr) for k in numbers]


# ------------------------------------------------------------------ fetching
def test_requests_keep_their_distance_whatever_answers():
    api = Api()
    clock = Clock()
    f = fetcher(api, clock)

    f.ask(A)
    f.ask(S)  # P is a 404 first: two requests

    assert len(api.asked) == 3
    assert clock.slept == [1.0, 1.0]
    assert api.headers[0]["User-Agent"] == fetch.USER_AGENT


def test_a_504_and_a_timeout_are_tried_again_after_a_growing_wait():
    class Flaky(Api):
        def __init__(self):
            super().__init__({url(A): [Response(504)]})
            self.timed_out = False

        def get(self, url_, timeout, headers):
            if not self.timed_out and url_ == url(A) and len(self.asked) == 1:
                self.timed_out = True
                self.asked.append(url_)
                raise requests.Timeout("read timed out")
            return super().get(url_, timeout, headers)

    api, clock = Flaky(), Clock()

    answer = fetcher(api, clock).ask(A)

    assert answer.read.status == STATUS_OK
    assert len(api.asked) == 3
    # Pacing waits of 1 s around backoffs of 2 and 4.
    assert [s for s in clock.slept if s > 1] == [2.0, 4.0]


def test_retry_after_is_honoured_and_a_server_that_never_answers_is_a_failure():
    api = Api({url(A): [Response(503, headers={"Retry-After": "7"})] * 4})

    answer = fetcher(api, interval=0).ask(A)

    assert (answer.read.status, answer.read.error) == (STATUS_FAILED, "HTTP 503")
    assert len(api.asked) == 4


def test_the_register_hint_saves_the_wrong_registers_404():
    api = Api()

    answer = fetcher(api).ask(S, hint="S")

    assert answer.read.rejestr == "S" and api.asked == [url(S, "S")]


def test_a_204_is_a_company_struck_off():
    api = Api({url(B): [Response(204)]})

    assert fetcher(api).ask(B).read.status == STATUS_STRUCK_OFF


def test_validators_are_sent_back_and_a_304_is_the_disks_answer(tmp_path):
    first = Api({url(A): [Response(200, recorded(f"{A}-P"), {"ETag": '"v1"'})]})
    run(never(A), first, tmp_path)
    second = Api({url(A): [Response(304)]})

    code, summary, store = run(
        [job.QueuedRead(A, "changed", "P", changed_on="2026-11-26")], second, tmp_path
    )

    assert second.headers[0]["If-None-Match"] == '"v1"'
    assert (summary.requests, summary.not_modified, summary.cache_hits) == (1, 1, 1)
    [read] = store.reads()
    assert read.status == STATUS_OK and read.body and read.source == SOURCE_CACHE


def test_a_request_cap_stops_the_run_with_the_rest_left(tmp_path):
    code, summary, store = run(never(A, B, S), Api(), tmp_path, max_requests=2)

    assert code == job.EXIT_TRY_LATER and summary.stopped == job.REQUEST_CAP
    assert [r.krs for r in store.reads()] == [A, B]


# ------------------------------------------------------- backfill and cursor
def test_a_stopped_backfill_carries_on_where_the_log_ends(tmp_path):
    tracked = [A, B, S]
    store = Store()
    asked = iter([False, False, True])

    first = Api()
    queue = queue_for_index(tracked, pd.DataFrame(), {})
    run(
        queue,
        first,
        tmp_path,
        store,
        should_stop=lambda: ("SIGTERM", 0) if next(asked) else ("", 0),
    )

    held = pd.DataFrame([e.__dict__ for e in ledger_of(fold(store.reads()))])
    second = Api()
    queue = queue_for_index(tracked, held, {})
    code, summary, _ = run(queue, second, tmp_path, store)

    # Lowest number first: 37863, 163560, then 1273959.
    assert [q.krs for q in queue] == [B]
    assert second.asked == [url(B)]
    assert (code, summary.cursor) == (0, B)
    assert sorted(r.krs for r in store.reads()) == sorted(tracked)


def test_answers_a_killed_run_left_on_disk_are_not_asked_for_again(tmp_path):
    # The first run read everything and died before its part was written.
    run(never(A, B), Api(), tmp_path, Store(), flush_every=10_000)
    lost = Store()

    api = Api()
    code, summary, store = run(never(A, B), api, tmp_path, lost)

    assert api.asked == [] and summary.cache_hits == 2
    assert {r.krs: (r.status, r.source) for r in store.reads()} == {
        A: (STATUS_OK, SOURCE_CACHE),
        B: (STATUS_OK, SOURCE_CACHE),
    }
    assert store.reads()[0].body == json.loads(recorded(f"{A}-P"))


# ------------------------------------------------------------ the bulletin
def test_the_daily_update_reads_only_what_the_bulletin_named_since(tmp_path):
    store = Store()
    week_ago = lambda: datetime.fromisoformat("2026-11-20T03:10:00+01:00")  # noqa: E731
    run(never(A, B), Api(), tmp_path, store, now=week_ago)
    held = pd.DataFrame([e.__dict__ for e in ledger_of(fold(store.reads()))])

    # The bulletin named A on the 25th, B on the 19th, before its read.
    queue = queue_for_index([A, B], held, {A: "2026-11-25", B: "2026-11-19"})
    todo = job.plan(queue, [], daily=True, backfill=0)
    api = Api()
    code, summary, store = run(todo, api, tmp_path, store)

    assert [(q.krs, q.reason, q.rejestr) for q in todo] == [(A, "changed", "P")]
    # The disk's copy is older than the entry: asked again, its register known.
    assert api.asked == [url(A)]
    assert (summary.requests, summary.cache_hits) == (1, 0)


def test_the_disks_copy_read_after_the_bulletins_day_stands(tmp_path):
    run(never(A), Api(), tmp_path)

    api = Api()
    _, summary, _ = run(
        [job.QueuedRead(A, "changed", "P", "2026-11-25")], api, tmp_path
    )

    assert api.asked == [] and summary.cache_hits == 1


def test_the_plan_takes_the_listed_then_the_days_changes_then_the_backfill():
    queue = [
        job.QueuedRead("1", "failed"),
        job.QueuedRead("2", "changed"),
        job.QueuedRead("3", REASON_NEVER),
        job.QueuedRead("4", REASON_NEVER),
    ]

    assert [q.krs for q in job.plan(queue, ["4"], daily=True, backfill=1)] == [
        "4",
        "1",
        "2",
        "3",
    ]
    assert [q.krs for q in job.plan(queue, [], daily=False, backfill=5)] == ["3", "4"]


def test_a_dry_run_asks_nothing(monkeypatch, capsys):
    monkeypatch.setattr(job, "build_queue", lambda args: never(A, B))

    assert job.main(["--daily", "--backfill", "1", "--dry-run"]) == 0
    assert "this run reads 1" in capsys.readouterr().out


def test_listed_numbers_refuse_what_is_not_a_krs(tmp_path):
    path = tmp_path / "list.txt"
    path.write_text("37863 # ZUS\n\n1273959\n")
    assert job.listed_numbers(str(path)) == [A, B]
    path.write_text("Gmina\n")
    with pytest.raises(ValueError):
        job.listed_numbers(str(path))
