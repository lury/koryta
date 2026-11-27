"""One request at a time to Wikimedia, as its API etiquette asks.

Sequential, at least `min_gap` seconds apart, with a User-Agent naming the
project, and a 429/503 answered by waiting out its Retry-After. Every request
counts against a cap; the run that reaches it stops and leaves the rest to the
next one.
"""

import email.utils
import importlib.metadata
import time
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import requests

REPOSITORY = "https://github.com/SzymonPajzert/koryta"
TIMEOUT_SECONDS = 120


def user_agent() -> str:
    try:
        version = importlib.metadata.version("pipelines")
    except importlib.metadata.PackageNotFoundError:
        version = "0"
    return f"koryta-pipelines/{version} ({REPOSITORY})"


class BudgetExhausted(Exception):
    """The run has made as many requests as it may."""


class UpstreamBusy(Exception):
    """Wikimedia kept refusing, or asked for a longer wait than we give."""


@dataclass
class Stats:
    requests: int = 0
    #: As they came over the wire: gzipped where the server gzipped.
    wire_bytes: int = 0
    seconds: float = 0.0
    retries: int = 0
    by_kind: Counter[str] = field(default_factory=Counter)

    def said(self) -> str:
        return (
            f"{self.requests} requests ({dict(self.by_kind)}), "
            f"{self.wire_bytes / 1e6:.2f} MB, {self.seconds:.1f} s in flight, "
            f"{self.retries} retried"
        )


def retry_after(headers: Mapping[str, str], now: datetime) -> float | None:
    """Retry-After in seconds, given as seconds or as an HTTP date."""
    value = headers.get("Retry-After")
    if not value:
        return None
    if value.strip().isdigit():
        return float(value)
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, (when - now).total_seconds())


class PoliteClient:
    def __init__(  # noqa: PLR0913
        self,
        session: requests.Session,
        max_requests: int,
        min_gap: float = 1.0,
        max_retries: int = 5,
        max_wait: float = 300.0,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.session = session
        self.session.headers["User-Agent"] = user_agent()
        self.max_requests = max_requests
        self.min_gap = min_gap
        self.max_retries = max_retries
        self.max_wait = max_wait
        self.sleep = sleep
        self.clock = clock
        self.stats = Stats()
        self._last: float | None = None

    def _send(self, method: str, url: str, kind: str, **kwargs: Any):
        if self.stats.requests >= self.max_requests:
            raise BudgetExhausted(f"{self.max_requests} requests made")
        if self._last is not None:
            gap = self.clock() - self._last
            if gap < self.min_gap:
                self.sleep(self.min_gap - gap)
        self.stats.requests += 1
        self.stats.by_kind[kind] += 1
        started = self.clock()
        try:
            return self.session.request(
                method, url, timeout=TIMEOUT_SECONDS, **kwargs
            ), None
        except requests.RequestException as e:
            return None, e
        finally:
            self._last = self.clock()
            self.stats.seconds += self._last - started

    def request(
        self, method: str, url: str, kind: str, **kwargs: Any
    ) -> requests.Response:
        """The answer to one request, retried on 429, 5xx and network errors.

        Raises BudgetExhausted at the cap, UpstreamBusy when the retries run
        out or the server asks to wait longer than `max_wait`, and
        requests.HTTPError for any other refusal."""
        for attempt in range(self.max_retries + 1):
            response, error = self._send(method, url, kind, **kwargs)
            if response is not None and response.status_code < 500:
                if response.status_code != 429:
                    if not kwargs.get("stream"):
                        self.stats.wire_bytes += int(
                            response.headers.get("Content-Length")
                            or len(response.content)
                        )
                    response.raise_for_status()
                    return response
            if attempt == self.max_retries:
                break
            wait = None
            if response is not None:
                wait = retry_after(response.headers, datetime.now(UTC))
                response.close()
            if wait is None:
                wait = 5.0 * 2**attempt
            if wait > self.max_wait:
                raise UpstreamBusy(f"asked to wait {wait:.0f} s for {url}")
            status = response.status_code if response is not None else error
            print(f"{kind}: {status}, waiting {wait:.0f} s")
            self.stats.retries += 1
            self.sleep(wait)
        raise UpstreamBusy(f"{self.max_retries + 1} tries of {url} failed")

    def post_json(self, url: str, kind: str, data: Mapping[str, str]) -> Any:
        body = self.request("POST", url, kind, data=dict(data)).json()
        if "error" in body:
            raise UpstreamBusy(f"{kind}: {body['error']}")
        return body
