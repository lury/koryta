"""pl.wikipedia title -> QID from the SQL dumps, without the API.

`page_props` alone names pages by id only, so it takes two dumps: `page` for
title -> page id (and whether it is a redirect), `page_props` for page id ->
`wikibase_item`. Both are refreshed twice a month; a conditional request finds
out whether ours is still the newest without downloading it.
"""

import gzip
import os
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Any

from jobs.wikidata_people.http import PoliteClient

DUMPS = "https://dumps.wikimedia.org/plwiki/latest"
PAGE = "plwiki-latest-page.sql.gz"
PAGE_PROPS = "plwiki-latest-page_props.sql.gz"
CHUNK = 1 << 20

#: (page_id, 0, 'title', is_redirect, ...: an article's row of `page`.
PAGE_ROW = re.compile(rb"\((\d+),0,'((?:[^'\\]|\\.)*)',([01]),")
#: (pp_page, 'wikibase_item', 'Q...', ...: a row of `page_props`.
ITEM_ROW = re.compile(rb"\((\d+),'wikibase_item','(Q\d+)',")


@dataclass(frozen=True)
class Page:
    page_id: int
    redirect: bool


def refresh(
    client: PoliteClient, name: str, directory: str, meta: dict[str, Any]
) -> tuple[bool, dict[str, Any]]:
    """Make the dump on disk the newest; whether it changed, and its validators.

    With a copy on disk the request carries its ETag and Last-Modified, and a
    304 costs one round trip and no bytes."""
    path = os.path.join(directory, name)
    headers = {}
    if os.path.exists(path) and meta:
        if meta.get("etag"):
            headers["If-None-Match"] = meta["etag"]
        if meta.get("last_modified"):
            headers["If-Modified-Since"] = meta["last_modified"]
    response = client.request(
        "GET", f"{DUMPS}/{name}", "dump", headers=headers, stream=True
    )
    with response:
        if response.status_code == 304:
            return False, meta
        os.makedirs(directory, exist_ok=True)
        part = f"{path}.part"
        size = 0
        with open(part, "wb") as f:
            for chunk in response.raw.stream(CHUNK, decode_content=False):
                f.write(chunk)
                size += len(chunk)
        client.stats.wire_bytes += size
        os.replace(part, path)
        return True, {
            "etag": response.headers.get("ETag"),
            "last_modified": response.headers.get("Last-Modified"),
            "size": size,
        }


def _lines(path: str) -> Iterator[bytes]:
    """The lines holding rows. MariaDB 10.11 writes `INSERT INTO ... VALUES`
    and then a row a line; older dumps put a statement's rows on its line."""
    with gzip.open(path, "rb") as f:
        yield from _lines_of(f)


def _lines_of(f: Iterable[bytes]) -> Iterator[bytes]:
    for line in f:
        if line.startswith((b"(", b"INSERT INTO")):
            yield line


def _sql_escaped(title: str) -> bytes:
    """A title as mysqldump writes it: underscores, quotes backslashed."""
    text = title.replace(" ", "_").replace("\\", "\\\\")
    return text.replace("'", "\\'").replace('"', '\\"').encode()


def pages_named(lines: Iterable[bytes], titles: Iterable[str]) -> dict[str, Page]:
    """The article of each title that has one, by the title asked for."""
    wanted = {_sql_escaped(t): t for t in titles}
    found: dict[str, Page] = {}
    for line in lines:
        for match in PAGE_ROW.finditer(line):
            title = wanted.get(match.group(2))
            if title is not None:
                found[title] = Page(int(match.group(1)), match.group(3) == b"1")
    return found


def items_of(lines: Iterable[bytes], page_ids: set[int]) -> dict[int, str]:
    found: dict[int, str] = {}
    for line in lines:
        for match in ITEM_ROW.finditer(line):
            page = int(match.group(1))
            if page in page_ids:
                found[page] = match.group(2).decode()
    return found


def resolve(
    directory: str, titles: Iterable[str]
) -> dict[str, tuple[Page, str | None]]:
    """Title -> (its page, its QID or None), for the titles the dump has."""
    pages = pages_named(_lines(os.path.join(directory, PAGE)), titles)
    ids = {p.page_id for p in pages.values() if not p.redirect}
    items = items_of(_lines(os.path.join(directory, PAGE_PROPS)), ids)
    return {t: (p, items.get(p.page_id)) for t, p in pages.items()}
