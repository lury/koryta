"""Keep the free KRS index current: api-krs's odpis pełny of every tracked company.

The job half of `scrapers.krs.full_index` - see its module doc for what the
index is and what it replaces. Each run rebuilds `KrsIndexQueue` (the
companies the site tracks, against the log and the bulletin), asks api-krs
for the odpis pełny of its head, and appends every answer to `READ_LOG` in
the shared cache as write-once parts:

    koryta_krs_full_index --daily                  # the night: what the bulletin named
    koryta_krs_full_index --backfill 12000         # by hand: every tracked company
    koryta_krs_full_index --daily --backfill 600 --max-minutes 25
    koryta_krs_full_index --krs-file sample.txt --no-pipelines --log-dir out/
                                       # a list; nothing else read or written

`--daily` reads the failed reads and the companies the bulletin named on or
after the day they were read - about 55 a day, a minute. `--backfill N` reads
N never read, lowest KRS first. The cursor is the log: a stopped backfill
rebuilds the queue and carries on from the lowest number the log lacks. Every
answer is also kept on disk (`--cache-dir`, `jobs.krs_full_index.cache`),
keyed by the KRS and the state of the odpis, so a run killed before its part
reached the log loses no request: the next one takes the answer off the disk.

One request a second by default (`--interval`), every retry included. A full
backfill of the ~12.7k tracked companies is 12.7k to 17.4k requests - one a
company where the register is known (`KRSRegisterEntries`, an earlier read),
two where the job has to try P before S: 41 for a sample of 30 on 2026-11-26,
1.36 s a company in all - so 3.5 to 4.8 hours at that pace. The odpis pełny
comes for a company struck off or in liquidation too, where the odpis
aktualny answers 204: 30 of 30 in that sample, 5 of which had.

Stopping is free at any point: Ctrl+C, SIGTERM, `--max-minutes` or
`--max-requests` ends the run after the company in hand, what was read
flushed first. Exit codes: 0 when everything planned was read or the run was
asked to stop; 75 when the time or the request cap left companies, or api-krs
stopped answering; 1 for anything else.

A run that asks anything reports to koryta.pl/admin/procesy as
`krs_full_index` and writes a summary to
gs://koryta-pl-sharedcache/jobs/krs_full_index/runs/ - requests, bytes, time,
cache hits, how the reads came out - or with `--log-dir` beside its parts.
"""

import argparse
import json
import os
import signal
import sys
import time
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime
from functools import partial

import pandas as pd
import requests
import zstandard
from uuid_extensions import uuid7str  # type: ignore

from jobs.krs_full_index.cache import Cached, ResponseCache
from jobs.krs_full_index.fetch import (
    USER_AGENT,
    Answer,
    Fetcher,
    Pacer,
    RequestCapReached,
)
from scrapers.krs.full_index import (
    DAILY_REASONS,
    READ_LOG,
    REASON_NEVER,
    SOURCE_CACHE,
    FullRead,
    QueuedRead,
)
from scrapers.krs.register import (
    STATUS_FAILED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_STRUCK_OFF,
)
from stores.config import DOWNLOADED_DIR
from stores.job_runs import ERRORS_KEPT, FinalState, JobRun
from stores.storage import Client, warsaw_tz

JOB = "krs_full_index"
UNIT = "odpisów"
RUNS_PREFIX = "jobs/krs_full_index/runs/"
DEFAULT_CACHE = os.path.join(DOWNLOADED_DIR, "krs_full_index")
#: Rebuilt before the queue is read: the log and the bulletin grow every day.
REFRESH = {"KRSUpdates", "KrsFullOdpisLedger", "KrsIndexQueue"}

#: Reads per part: ~200 odpisy pełne is ~13 MB of JSON, ~1 MB compressed, and
#: under four minutes at 1 a second - the most a hard kill can lose from the
#: log, and the disk cache still has it.
FLUSH_EVERY = 200
MAX_CONSECUTIVE_FAILURES = 20
EXIT_FAILED = 1
EXIT_TRY_LATER = 75
DEADLINE = "deadline"
REQUEST_CAP = "request cap"
STATUSES = (STATUS_OK, STATUS_STRUCK_OFF, STATUS_NOT_FOUND, STATUS_FAILED)


def now() -> datetime:
    return datetime.now(warsaw_tz)


class PartLog:
    """Buffers reads and writes each batch as one new, never-rewritten part.

    `put(name, data)` must refuse a name that exists - `Client.create_object`
    in a real run, a local directory with `--log-dir`.
    """

    def __init__(
        self, put: Callable[[str, bytes], str], run: str, flush_every: int = FLUSH_EVERY
    ):
        self.put = put
        self.run = run
        self.flush_every = flush_every
        self.pending: list[FullRead] = []
        self.written: list[str] = []
        self.reads_written = 0
        self.raw_bytes = 0
        self.stored_bytes = 0

    def add(self, read: FullRead) -> None:
        self.pending.append(read)
        if len(self.pending) >= self.flush_every:
            self.flush()

    def part_name(self) -> str:
        day = self.pending[0].read_at[:10]
        return (
            f"{READ_LOG.prefix}date={day}/{self.run}-{len(self.written):05d}.jsonl.zst"
        )

    def flush(self) -> str | None:
        if not self.pending:
            return None
        lines = "".join(read.to_line() + "\n" for read in self.pending).encode("utf-8")
        # Deterministic, so a retried flush sends the bytes the first try did.
        data = zstandard.ZstdCompressor(level=3).compress(lines)
        url = self.put(self.part_name(), data)
        self.written.append(url)
        self.reads_written += len(self.pending)
        self.raw_bytes += len(lines)
        self.stored_bytes += len(data)
        self.pending = []
        return url


def local_put(root: str, name: str, data: bytes) -> str:
    path = os.path.join(root, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "xb") as f:
        f.write(data)
    return path


@dataclass
class RunSummary:
    run: str
    started: str
    finished: str = ""
    mode: list[str] = field(default_factory=list)
    planned: int = 0
    reasons: dict[str, int] = field(default_factory=dict)
    done: int = 0
    statuses: dict[str, int] = field(default_factory=lambda: dict.fromkeys(STATUSES, 0))
    #: Answers taken off the disk, no request made.
    cache_hits: int = 0
    requests: int = 0
    retries: int = 0
    bytes: int = 0
    request_seconds: float = 0.0
    wall_seconds: float = 0.0
    http: dict[str, int] = field(default_factory=dict)
    not_modified: int = 0
    validators_seen: int = 0
    logged: int = 0
    log_raw_bytes: int = 0
    log_stored_bytes: int = 0
    #: The last never-read company the backfill read: where it carries on.
    cursor: str | None = None
    stopped: str = ""
    errors: list[str] = field(default_factory=list)
    exit_code: int | None = None

    def counters(self) -> dict[str, float]:
        return {
            **self.statuses,
            "cache_hits": self.cache_hits,
            "requests": self.requests,
            "bytes": self.bytes,
        }


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="koryta_krs_full_index", description=(__doc__ or "").split("\n")[0]
    )
    p.add_argument(
        "--daily",
        action="store_true",
        help="Read the failed reads and the companies the bulletin named "
        "since they were read.",
    )
    p.add_argument(
        "--backfill",
        type=int,
        default=0,
        help="Read this many tracked companies never read, lowest KRS first. "
        "Default: %(default)s.",
    )
    p.add_argument(
        "--krs-file",
        help="Read the KRS numbers in this file first, one a line, # comments.",
    )
    p.add_argument(
        "--no-pipelines",
        action="store_true",
        help="With --krs-file: build no pipeline, so no bulletin either - a "
        "cached answer is current.",
    )
    p.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Seconds between requests, retries included. Default: %(default)s.",
    )
    p.add_argument(
        "--max-minutes",
        type=float,
        help="Stop this many minutes after the start and leave the rest (exit 75).",
    )
    p.add_argument(
        "--max-requests",
        type=int,
        help="Send at most this many requests this run (exit 75 when it cuts "
        "the plan).",
    )
    p.add_argument(
        "--cache-dir",
        default=DEFAULT_CACHE,
        help="The disk cache of answers. Default: %(default)s.",
    )
    p.add_argument(
        "--log-dir",
        help="Write the parts and the summary here instead of the shared cache.",
    )
    p.add_argument("--user-agent", default=USER_AGENT, help="Default: %(default)s.")
    p.add_argument("--flush-every", type=int, default=FLUSH_EVERY)
    p.add_argument(
        "--dry-run", action="store_true", help="Report the plan; ask nothing."
    )
    p.add_argument("--no-backup", action="store_true", help="As `koryta --no-backup`.")
    return p


def listed_numbers(path: str) -> list[str]:
    numbers: dict[str, None] = {}
    with open(path) as f:
        for line_number, line in enumerate(f, 1):
            text = line.split("#", 1)[0].strip()
            if not text:
                continue
            if not text.isdigit() or len(text) > 10:
                raise ValueError(f"{path}:{line_number}: not a KRS number: {text!r}")
            numbers[text.zfill(10)] = None
    return list(numbers)


def plan(
    queue: Sequence[QueuedRead], listed: Sequence[str], daily: bool, backfill: int
) -> list[QueuedRead]:
    """What a run reads: the listed, then the daily reasons, then
    `backfill` never read."""
    by_krs = {q.krs: q for q in queue}
    todo = [
        QueuedRead(
            k,
            "listed",
            by_krs[k].rejestr if k in by_krs else None,
            by_krs[k].changed_on if k in by_krs else None,
        )
        for k in listed
    ]
    seen = set(listed)
    if daily:
        todo += [q for q in queue if q.reason in DAILY_REASONS and q.krs not in seen]
    never = [q for q in queue if q.reason == REASON_NEVER and q.krs not in seen]
    return todo + never[: max(backfill, 0)]


def queue_from(frame: pd.DataFrame | None) -> list[QueuedRead]:
    if frame is None or frame.empty:
        return []

    def text(value) -> str | None:
        return (
            None
            if value is None
            or (isinstance(value, float) and pd.isna(value))
            or value == ""
            else str(value)
        )

    return [
        QueuedRead(
            str(r["krs"]).zfill(10),
            str(r["reason"]),
            text(r.get("rejestr")),
            text(r.get("changed_on")),
        )
        for r in frame.to_dict("records")
    ]


def current_on_disk(cached: Cached | None, changed_on: str | None) -> bool:
    """Whether the disk's answer still stands: read after the bulletin last named it."""
    if cached is None or cached.status == STATUS_FAILED:
        return False
    return changed_on is None or cached.read_at[:10] > changed_on


def from_disk(cache: ResponseCache, cached: Cached, run: str) -> FullRead | None:
    body = cache.body(cached) if cached.status == STATUS_OK else None
    if cached.status == STATUS_OK and body is None:
        return None
    return FullRead(
        krs=cached.krs,
        read_at=cached.read_at,
        status=cached.status,
        rejestr=cached.rejestr,
        stated_on=cached.stated_on,
        last_entry=cached.last_entry,
        body=body,
        run=run,
        source=SOURCE_CACHE,
    )


def keep(cache: ResponseCache, answer: Answer) -> None:
    read = answer.read
    if read.status == STATUS_FAILED or read.source == SOURCE_CACHE:
        return
    cache.put(
        Cached(
            krs=read.krs,
            read_at=read.read_at,
            status=read.status,
            rejestr=read.rejestr,
            stated_on=read.stated_on,
            last_entry=read.last_entry,
            etag=answer.etag,
            last_modified=answer.last_modified,
        ),
        answer.raw,
    )


def settle(summary: RunSummary, fetcher: Fetcher, log: PartLog, wall: float) -> None:
    """What the run sent and logged, into its summary."""
    traffic = fetcher.traffic
    summary.requests, summary.retries = traffic.requests, traffic.retries
    summary.bytes = traffic.bytes
    summary.request_seconds = round(traffic.seconds, 3)
    summary.http, summary.not_modified = dict(traffic.statuses), traffic.not_modified
    summary.validators_seen = traffic.validators_seen
    summary.logged = log.reads_written
    summary.log_raw_bytes, summary.log_stored_bytes = log.raw_bytes, log.stored_bytes
    summary.wall_seconds = wall


def read_index(
    todo: Sequence[QueuedRead],
    fetcher: Fetcher,
    cache: ResponseCache,
    log: PartLog,
    summary: RunSummary,
    status: JobRun | None = None,
    should_stop: Callable[[], tuple[str, int]] = lambda: ("", 0),
    tick: Callable[[], float] = time.monotonic,
) -> int:
    """Read every company of `todo`, from the disk where it still stands."""
    started = tick()
    code = 0
    failures = 0
    try:
        for item in todo:
            stopped, code = should_stop()
            if stopped:
                summary.stopped = stopped
                break
            cached = cache.latest(item.krs)
            read = (
                from_disk(cache, cached, log.run)
                if cached and current_on_disk(cached, item.changed_on)
                else None
            )
            if read is not None:
                summary.cache_hits += 1
            else:
                try:
                    answer = fetcher.ask(
                        item.krs,
                        item.rejestr or (cached.rejestr if cached else None),
                        cached,
                    )
                except RequestCapReached:
                    summary.stopped, code = REQUEST_CAP, EXIT_TRY_LATER
                    break
                read = answer.read
                if read.source == SOURCE_CACHE and cached is not None:
                    # A 304: the disk's body is the answer.
                    read = from_disk(cache, cached, log.run) or read
                    summary.cache_hits += 1
                keep(cache, answer)
            log.add(read)
            summary.done += 1
            summary.statuses[read.status] = summary.statuses.get(read.status, 0) + 1
            if item.reason == REASON_NEVER:
                summary.cursor = item.krs
            if read.status == STATUS_FAILED:
                failures += 1
                if len(summary.errors) < ERRORS_KEPT:
                    summary.errors.append(f"{item.krs}: {read.error}")
            else:
                failures = 0
            if status is not None:
                status.progress(summary.done, counters=summary.counters())
            if failures >= MAX_CONSECUTIVE_FAILURES:
                summary.stopped, code = (
                    f"{failures} reads in a row failed",
                    EXIT_TRY_LATER,
                )
                break
    except KeyboardInterrupt:
        summary.stopped, code = "przerwany", 0
    finally:
        log.flush()
        settle(summary, fetcher, log, round(tick() - started, 3))
    return code


def stop_rule(
    deadline: float | None,
    signalled: Callable[[], bool],
    tick: Callable[[], float] = time.monotonic,
):
    def stop_now() -> tuple[str, int]:
        if signalled():
            return "SIGTERM", 0
        if deadline is not None and tick() >= deadline:
            return DEADLINE, EXIT_TRY_LATER
        return "", 0

    return stop_now


def write_summary(summary: RunSummary, log_dir: str | None) -> str:
    summary.finished = now().isoformat(timespec="seconds")
    name = f"{RUNS_PREFIX}date={summary.started[:10]}/{summary.run}.json"
    data = json.dumps(asdict(summary), ensure_ascii=False, indent=1).encode("utf-8")
    try:
        if log_dir:
            return local_put(log_dir, name, data)
        assert READ_LOG.bucket is not None
        return Client().create_object(READ_LOG.bucket, name, data, "application/json")
    except Exception as problem:  # noqa: BLE001 - the reads are logged either way
        print(f"Could not write the run summary {name}: {problem}")
        return ""


def summary_line(summary: RunSummary, planned: int, path: str) -> str:
    return (
        f"Read {summary.done} of {planned} {summary.statuses}: "
        f"{summary.requests} requests ({summary.retries} retries), "
        f"{summary.bytes:,} bytes, {summary.request_seconds:.1f} s waiting on "
        f"api-krs, {summary.wall_seconds:.1f} s in all; {summary.cache_hits} "
        f"from the disk; {summary.logged} logged; summary {path or 'not written'}"
        + (f"; stopped: {summary.stopped}" if summary.stopped else "")
    )


def log_writer(log_dir: str | None) -> Callable[[str, bytes], str]:
    """Where the parts go: a local directory, else the shared cache."""
    if log_dir:
        return partial(local_put, log_dir)
    assert READ_LOG.bucket is not None
    return partial(
        Client().create_object, READ_LOG.bucket, content_type="application/zstd"
    )


def build_queue(args) -> list[QueuedRead]:
    from conductor import setup_context  # noqa: PLC0415 - not for --no-pipelines
    from scrapers.krs.full_index import KrsIndexQueue  # noqa: PLC0415
    from scrapers.stores import ProcessPolicy  # noqa: PLC0415

    ctx, _ = setup_context(policy=ProcessPolicy(set(REFRESH)))
    return queue_from(KrsIndexQueue().read_or_process(ctx))


def main(argv: Sequence[str] | None = None) -> int:
    started = time.monotonic()
    args = parser().parse_args(argv)
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    sys.argv = sys.argv[:1]
    if args.no_pipelines and not args.krs_file:
        print("--no-pipelines reads nothing but --krs-file")
        return EXIT_FAILED
    listed = listed_numbers(args.krs_file) if args.krs_file else []
    queue = [] if args.no_pipelines else build_queue(args)
    todo = plan(queue, listed, args.daily, args.backfill)
    reasons = Counter(q.reason for q in todo)
    owed = Counter(q.reason for q in queue)
    print(
        f"Queue: {len(queue)} tracked companies owed a read {dict(owed)}; "
        f"this run reads {len(todo)} {dict(reasons)}"
    )
    if args.dry_run or not todo:
        return 0

    run = uuid7str()
    summary = RunSummary(
        run=run,
        started=now().isoformat(timespec="seconds"),
        mode=[
            m
            for m, on in (
                ("daily", args.daily),
                ("backfill", args.backfill > 0),
                ("listed", bool(listed)),
            )
            if on
        ],
        planned=len(todo),
        reasons=dict(reasons),
    )
    put = log_writer(args.log_dir)
    session = requests.Session()
    session.headers["User-Agent"] = args.user_agent
    fetcher = Fetcher(session, Pacer(args.interval), now, run, args.max_requests)
    signalled = False

    def on_sigterm(signum, frame):
        nonlocal signalled
        signalled = True

    deadline = started + args.max_minutes * 60 if args.max_minutes else None
    previous = signal.signal(signal.SIGTERM, on_sigterm)
    with JobRun(JOB, run_id=run, unit=UNIT, total=len(todo)) as status:
        try:
            code = read_index(
                todo,
                fetcher,
                ResponseCache(args.cache_dir),
                PartLog(put, run, args.flush_every),
                summary,
                status,
                stop_rule(deadline, lambda: signalled),
            )
        finally:
            signal.signal(signal.SIGTERM, previous)
        summary.exit_code = code
        path = write_summary(summary, args.log_dir)
        refusing = code and summary.stopped not in (DEADLINE, REQUEST_CAP)
        state: FinalState = (
            "failed" if refusing else "partial" if summary.stopped else "succeeded"
        )
        status.finish(
            state,
            stop_reason=summary.stopped or None,
            errors=summary.errors,
            exit_code=code,
            counters=summary.counters(),
            done=summary.done,
            summary_path=path or None,
        )
    print(summary_line(summary, len(todo), path))
    return code
