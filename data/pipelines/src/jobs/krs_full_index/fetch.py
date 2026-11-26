"""Asking api-krs for one company's odpis pełny, politely.

Every request, a retry or the second register's included, waits for the
pacer, so the rate holds whatever happens: 1 a second by default. A 5xx, a
429 or a timeout is retried with a growing wait (`BACKOFF_SECONDS`), or what
`Retry-After` asks for: all 36 504s of 2026-10-02 went through on the next
try. A 404 moves on to the other register; a 204 is an answer, the entry
struck off.

Conditional requests: api-krs sent no `ETag` and no `Last-Modified` on any of
the 66 answers of 2026-11-26, nor on this job's own, and answered
`If-Modified-Since` with a full 200 (measured 2026-11-26, see
`jobs.krs_full_index`). What saves a request is the bulletin: a company it has
not named since the read is not asked again at all. Should the server start
sending validators, they are kept and sent back, and a 304 is a cache hit.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

import requests

from jobs.krs_full_index.cache import Cached
from scrapers.krs.full_index import (
    SOURCE_CACHE,
    SOURCE_NETWORK,
    FullRead,
    last_entry,
    stated_on,
)
from scrapers.krs.register import (
    STATUS_FAILED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_STRUCK_OFF,
)

PELNY_URL = (
    "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/{krs}?rejestr={rejestr}&format=json"
)
REGISTERS = ("P", "S")
USER_AGENT = "koryta-pipelines/0.1"
TIMEOUT_SECONDS = 30
#: Waits before each retry; their count is the retries.
BACKOFF_SECONDS = (2.0, 4.0, 8.0)
#: The longest `Retry-After` honoured; past it the request is a failure.
MAX_RETRY_AFTER = 120.0
RETRIED = frozenset({429, 500, 502, 503, 504})


class Pacer:
    """At most one request per `interval` seconds, on `clock`."""

    def __init__(
        self,
        interval: float,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.interval = interval
        self.clock = clock
        self.sleep = sleep
        self.last: float | None = None

    def wait(self) -> None:
        if self.last is not None:
            left = self.interval - (self.clock() - self.last)
            if left > 0:
                self.sleep(left)
        self.last = self.clock()


@dataclass
class Traffic:
    """What a run sent and got back."""

    requests: int = 0
    bytes: int = 0
    seconds: float = 0.0
    retries: int = 0
    not_modified: int = 0
    statuses: dict[str, int] = field(default_factory=dict)
    #: Did any answer carry a validator a conditional request could use.
    validators_seen: int = 0


@dataclass
class Answer:
    """One company's answer: the read for the log, the raw body for the disk."""

    read: FullRead
    raw: bytes | None = None
    etag: str | None = None
    last_modified: str | None = None


class Fetcher:
    def __init__(
        self,
        session: requests.Session,
        pacer: Pacer,
        now: Callable[[], datetime],
        run: str | None = None,
        max_requests: int | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.session = session
        self.pacer = pacer
        self.now = now
        self.run = run
        self.max_requests = max_requests
        self.sleep = sleep
        self.clock = clock
        self.traffic = Traffic()

    def exhausted(self) -> bool:
        return (
            self.max_requests is not None and self.traffic.requests >= self.max_requests
        )

    def _get(self, url: str, headers: dict[str, str]) -> requests.Response | None:
        if self.exhausted():
            raise RequestCapReached(self.traffic.requests)
        self.pacer.wait()
        started = self.clock()
        try:
            response = self.session.get(url, timeout=TIMEOUT_SECONDS, headers=headers)
        finally:
            self.traffic.requests += 1
            self.traffic.seconds += self.clock() - started
        self.traffic.bytes += len(response.content or b"")
        key = str(response.status_code)
        self.traffic.statuses[key] = self.traffic.statuses.get(key, 0) + 1
        if response.headers.get("ETag") or response.headers.get("Last-Modified"):
            self.traffic.validators_seen += 1
        return response

    def _patiently(
        self, url: str, headers: dict[str, str]
    ) -> tuple[requests.Response | None, str | None]:
        """The response, retried on what a retry may fix; or None and why."""
        error: str | None = None
        for attempt in range(len(BACKOFF_SECONDS) + 1):
            try:
                response = self._get(url, headers)
            except requests.RequestException as problem:
                response, error = None, f"{type(problem).__name__}: {problem}"[:200]
            else:
                if response is not None and response.status_code not in RETRIED:
                    return response, None
                error = (
                    f"HTTP {response.status_code}" if response is not None else error
                )
            if attempt == len(BACKOFF_SECONDS):
                break
            self.traffic.retries += 1
            self.sleep(retry_after(response) or BACKOFF_SECONDS[attempt])
        return None, error

    def ask(
        self, krs: str, hint: str | None = None, cached: Cached | None = None
    ) -> Answer:
        """Both registers, the likelier first, until one answers."""

        def read(
            status: str, rejestr=None, body=None, error=None, source=SOURCE_NETWORK
        ) -> FullRead:
            return FullRead(
                krs=krs,
                read_at=self.now().isoformat(timespec="seconds"),
                status=status,
                rejestr=rejestr,
                stated_on=stated_on(body),
                last_entry=last_entry(body),
                body=body,
                error=error,
                run=self.run,
                source=source,
            )

        order = (
            [hint] + [r for r in REGISTERS if r != hint]
            if hint in REGISTERS
            else list(REGISTERS)
        )
        for rejestr in order:
            headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
            if cached is not None and cached.rejestr == rejestr:
                if cached.etag:
                    headers["If-None-Match"] = cached.etag
                if cached.last_modified:
                    headers["If-Modified-Since"] = cached.last_modified
            response, error = self._patiently(
                PELNY_URL.format(krs=krs, rejestr=rejestr), headers
            )
            if response is None:
                return Answer(read(STATUS_FAILED, rejestr, error=error))
            if response.status_code == 304 and cached is not None:
                self.traffic.not_modified += 1
                return Answer(read(cached.status, rejestr, source=SOURCE_CACHE))
            if response.status_code == 204:
                return Answer(read(STATUS_STRUCK_OFF, rejestr))
            if response.status_code == 404:
                continue
            if response.status_code != 200:
                return Answer(
                    read(STATUS_FAILED, rejestr, error=f"HTTP {response.status_code}")
                )
            try:
                data = response.json()
            except ValueError as problem:
                return Answer(
                    read(STATUS_FAILED, rejestr, error=f"not JSON: {problem}"[:200])
                )
            if isinstance(data, dict) and "odpis" in data:
                return Answer(
                    read(STATUS_OK, rejestr, body=data),
                    raw=response.content,
                    etag=response.headers.get("ETag"),
                    last_modified=response.headers.get("Last-Modified"),
                )
            if not (isinstance(data, dict) and data.get("title") == "Not Found"):
                return Answer(
                    read(STATUS_FAILED, rejestr, error=f"200: {str(data)[:200]}")
                )
        return Answer(read(STATUS_NOT_FOUND))


class RequestCapReached(RuntimeError):
    """`--max-requests` is spent; nothing more is asked this run."""


def retry_after(response: requests.Response | None) -> float | None:
    """The seconds a `Retry-After` asks for, within `MAX_RETRY_AFTER`."""
    if response is None:
        return None
    value = response.headers.get("Retry-After")
    try:
        seconds = float(value) if value is not None else None
    except ValueError:
        return None
    return (
        min(seconds, MAX_RETRY_AFTER) if seconds is not None and seconds >= 0 else None
    )
