"""Polite GETs: a pause between calls per source, backoff on 429, a disk cache."""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Protocol, cast

import requests


def user_agent() -> str:
    try:
        ver = version("pipelines")
    except PackageNotFoundError:
        ver = "0"
    return f"koryta-pipelines/{ver} (https://github.com/SzymonPajzert/koryta)"


#: Never under a second between two calls to one source.
MIN_INTERVAL_S = 1.0
RETRIES = 3
BACKOFF_S = 10.0
TIMEOUT_S = 45.0


class Session(Protocol):
    def get(self, url: str, **kwargs: Any) -> Any: ...


def _session() -> Session:
    return cast(Session, requests.Session())


@dataclass
class Response:
    status: int
    text: str
    seconds: float
    cached: bool = False


@dataclass
class DiskCache:
    """One file per source, query and day: a rerun the same day asks nothing."""

    root: Path

    def path(self, source: str, key: str, day: str) -> Path:
        digest = hashlib.sha1(key.encode()).hexdigest()[:20]
        return self.root / source / f"day={day}" / f"{digest}.json"

    def get(self, source: str, key: str, day: str) -> str | None:
        path = self.path(source, key, day)
        if not path.exists():
            return None
        return json.loads(path.read_text())["body"]

    def put(self, source: str, key: str, day: str, body: str) -> None:
        path = self.path(source, key, day)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"key": key, "body": body}, ensure_ascii=False))


@dataclass
class PoliteClient:
    """GETs for one source, at most one every `min_interval_s`."""

    source: str
    min_interval_s: float = MIN_INTERVAL_S
    session: Session = field(default_factory=_session)
    cache: DiskCache | None = None
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    retries: int = RETRIES
    backoff_s: float = BACKOFF_S
    calls: int = 0
    _last: float | None = None

    def _wait(self) -> None:
        interval = max(self.min_interval_s, MIN_INTERVAL_S)
        if self._last is not None:
            left = interval - (self.clock() - self._last)
            if left > 0:
                self.sleep(left)

    def get(
        self,
        url: str,
        params: dict[str, Any],
        cache_key: str,
        day: str,
        headers: dict[str, str] | None = None,
    ) -> Response:
        if self.cache is not None:
            body = self.cache.get(self.source, cache_key, day)
            if body is not None:
                return Response(200, body, 0.0, cached=True)
        all_headers = {"User-Agent": user_agent(), **(headers or {})}
        attempt = 0
        while True:
            self._wait()
            started = self.clock()
            self.calls += 1
            try:
                reply = self.session.get(
                    url, params=params, headers=all_headers, timeout=TIMEOUT_S
                )
                status, text = int(reply.status_code), str(reply.text)
            except requests.RequestException as e:
                status, text = 0, str(e)
            self._last = self.clock()
            seconds = self._last - started
            if (
                status == 429 or status >= 500 or status == 0
            ) and attempt < self.retries:
                attempt += 1
                self.sleep(self.backoff_s * 2 ** (attempt - 1))
                continue
            if status == 200 and self.cache is not None:
                self.cache.put(self.source, cache_key, day, text)
            return Response(status, text, seconds)
