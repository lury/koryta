"""A Google News link (`news.google.com/rss/articles/<id>`) to the publisher's URL.

The id has been opaque since 2024 (`CBMi...AU_yqL...`): it no longer carries
the URL, so it cannot be decoded offline. The article page carries a signature
and a timestamp (`data-n-a-sg`, `data-n-a-ts`), and the page's own
`batchexecute` call (`Fbv4je`) trades them with the id for the URL: two calls
per article. In the EU the page first redirects to consent.google.com; the
`SOCS` cookie says the consent screen was answered.

A resolved link never changes, so its answer is kept on disk without a day.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from jobs.news_watch.http import PoliteClient

ARTICLE_URL = "https://news.google.com/rss/articles/{id}"
BATCH_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
COOKIES = {"SOCS": "CAI"}
#: The cache's day for answers that never go stale.
FOREVER = "forever"

_SIGNATURE = re.compile(r'data-n-a-sg="([^"]+)"')
_TIMESTAMP = re.compile(r'data-n-a-ts="([^"]+)"')


def article_id(link: str) -> str | None:
    parts = urlsplit(link)
    if parts.hostname != "news.google.com" or "/articles/" not in parts.path:
        return None
    return parts.path.rsplit("/articles/", 1)[1].strip("/") or None


def page_params(html: str) -> tuple[str, str] | None:
    """The signature and the timestamp the article page carries."""
    signature, timestamp = _SIGNATURE.search(html), _TIMESTAMP.search(html)
    if not signature or not timestamp:
        return None
    return signature.group(1), timestamp.group(1)


def batch_form(aid: str, timestamp: str, signature: str) -> dict[str, str]:
    """The form the page's `Fbv4je` call posts."""
    request = [
        "garturlreq",
        [
            ["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1]
            + [None] * 5
            + [0, 1],
            "X",
            "X",
            1,
            [1, 1, 1],
            1,
            1,
            None,
            0,
            0,
            None,
            0,
        ],
        aid,
        int(timestamp),
        signature,
    ]
    envelope = [
        [["Fbv4je", json.dumps(request, separators=(",", ":")), None, "generic"]]
    ]
    return {"f.req": json.dumps(envelope, separators=(",", ":"))}


def parse_batch(text: str) -> str | None:
    """The URL out of the `batchexecute` answer: `)]}'`, then a JSON frame."""
    for chunk in text.split("\n"):
        chunk = chunk.strip()
        if not chunk.startswith("[["):
            continue
        try:
            frames = json.loads(chunk)
        except json.JSONDecodeError:
            continue
        for frame in frames:
            if len(frame) > 2 and frame[0] == "wrb.fr" and frame[1] == "Fbv4je":
                if not isinstance(frame[2], str):
                    return None
                inner = json.loads(frame[2])
                url = inner[1] if len(inner) > 1 else None
                return url if isinstance(url, str) and url.startswith("http") else None
    return None


@dataclass
class GoogleNewsResolver:
    client: PoliteClient

    def resolve(self, link: str) -> str | None:
        """The publisher's URL, or None when Google would not say."""
        aid = article_id(link)
        if aid is None:
            return None
        page = self.client.get(
            ARTICLE_URL.format(id=aid), {}, f"page:{aid}", FOREVER, cookies=COOKIES
        )
        if page.status != 200:
            return None
        params = page_params(page.text)
        if params is None:
            return None
        signature, timestamp = params
        answer = self.client.post(
            BATCH_URL,
            batch_form(aid, timestamp, signature),
            f"batch:{aid}",
            FOREVER,
            headers={"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
            cookies=COOKIES,
        )
        if answer.status != 200:
            return None
        return parse_batch(answer.text)
