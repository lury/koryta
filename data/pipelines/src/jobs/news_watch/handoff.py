"""What the site already has, and the crawl's queue for the rest."""

from __future__ import annotations

import io
import json
import os
from collections.abc import Iterable, Iterator, Sequence
from pathlib import Path

from jobs.news_watch.models import Candidate
from jobs.news_watch.urls import url_key

#: What the url store files the urls under, for anybody counting the doors.
SOURCE = "news_watch"


def _decompress(raw: bytes) -> bytes:
    try:
        from compression import zstd  # type: ignore[import-not-found]  # noqa: PLC0415

        return zstd.decompress(raw)
    except ImportError:
        import zstandard  # type: ignore[import-not-found]  # noqa: PLC0415

        return zstandard.ZstdDecompressor().stream_reader(io.BytesIO(raw)).read()


def _lines(path: Path) -> Iterator[str]:
    raw = path.read_bytes()
    if path.suffix == ".zst":
        raw = _decompress(raw)
    yield from raw.decode().splitlines()


def keys_of(rows: Iterable[dict]) -> set[str]:
    keys = set()
    for row in rows:
        url = row.get("sourceURL")
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            keys.add(url_key(url))
    return keys


def known_article_keys(path: Path | None) -> set[str]:
    """The articles the site has a page for, by `url_key`."""
    if path is not None:
        return keys_of(json.loads(line) for line in _lines(path) if line.strip())
    from conductor import setup_context  # noqa: PLC0415
    from scrapers.koryta.download import KorytaNodes  # noqa: PLC0415
    from scrapers.stores import ProcessPolicy, required_resources  # noqa: PLC0415

    ctx, _ = setup_context(required_resources(KorytaNodes), policy=ProcessPolicy(set()))
    nodes = KorytaNodes().read_or_process(ctx)
    articles = nodes[nodes["type"] == "article"]
    return keys_of(articles[["sourceURL"]].to_dict("records"))


def hand_off(candidates: Sequence[Candidate], queue: str) -> tuple[str, int]:
    """The candidates into the named queue; which one it was, and how many
    it took in that it did not have."""
    if queue == "auto":
        queue = "url_store" if os.environ.get("URL_STORE_URL") else "none"
    if queue == "none" or not candidates:
        return queue, 0
    if queue == "url_store":
        from external.url_store_client import UrlIn, UrlStoreClient  # noqa: PLC0415

        with UrlStoreClient.from_env() as client:
            reply = client.create_urls(
                UrlIn(c.url, source=SOURCE, context=c.context()) for c in candidates
            )
        return queue, reply.inserted
    if queue == "postgres":
        from scrapers.article.postgres_queue import (  # noqa: PLC0415
            PostgresClient,
            PostgresCrawlQueue,
        )
        from scrapers.stores import NewUrl  # noqa: PLC0415

        pg = PostgresClient.from_env(max_size=1)
        try:
            # 0 is the front of the queue: somebody asked for these.
            PostgresCrawlQueue(pg).put([NewUrl(c.url, 0) for c in candidates])
        finally:
            pg.close()
        return queue, len(candidates)
    raise ValueError(f"unknown queue {queue!r}")
