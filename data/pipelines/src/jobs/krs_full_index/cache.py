"""api-krs's answers on disk, keyed by the company and the state its odpis speaks for.

One directory per KRS number. Each odpis body is written once, as
`<rejestr>-<last entry>-<stan z dnia>.json.zst`, so two states of a company
never overwrite each other, and `latest.json` says which is the newest and
when it was read - what the job compares with the bulletin before it asks
again. A 204 or a 404 is kept as a `latest.json` with no body.

The disk is the job's, not the pipelines': these are what a run killed before
its part reached the log leaves behind, and what a warm rerun answers from
without a request.
"""

import json
import os
from dataclasses import asdict, dataclass

import zstandard


@dataclass
class Cached:
    """What `latest.json` says about one company."""

    krs: str
    read_at: str
    status: str
    rejestr: str | None = None
    stated_on: str | None = None
    last_entry: int | None = None
    #: The body's file in the company's directory, None with no body.
    file: str | None = None
    bytes: int = 0
    #: Validators the server sent, for a conditional request next time.
    #: api-krs sent neither on 2026-11-26; kept should it start.
    etag: str | None = None
    last_modified: str | None = None


class ResponseCache:
    def __init__(self, root: str):
        self.root = root

    def _dir(self, krs: str) -> str:
        return os.path.join(self.root, krs)

    def latest(self, krs: str) -> Cached | None:
        path = os.path.join(self._dir(krs), "latest.json")
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return None
        try:
            return Cached(
                **{k: v for k, v in data.items() if k in Cached.__dataclass_fields__}
            )
        except TypeError:
            return None

    def body(self, cached: Cached) -> dict | None:
        if not cached.file:
            return None
        try:
            with open(os.path.join(self._dir(cached.krs), cached.file), "rb") as f:
                raw = zstandard.ZstdDecompressor().decompressobj().decompress(f.read())
        except (OSError, zstandard.ZstdError):
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return None

    def put(self, cached: Cached, raw: bytes | None) -> Cached:
        """Keep an answer: the body under its state's name, then `latest.json`."""
        directory = self._dir(cached.krs)
        os.makedirs(directory, exist_ok=True)
        if raw is not None:
            cached.file = (
                f"{cached.rejestr or '-'}-{cached.last_entry or 0:05d}-"
                f"{cached.stated_on or 'unknown'}.json.zst"
            )
            cached.bytes = len(raw)
            self._write(
                os.path.join(directory, cached.file),
                zstandard.ZstdCompressor(level=3).compress(raw),
            )
        self._write(
            os.path.join(directory, "latest.json"),
            json.dumps(asdict(cached), ensure_ascii=False).encode("utf-8"),
        )
        return cached

    @staticmethod
    def _write(path: str, data: bytes) -> None:
        # Renamed into place, so a kill mid-write never leaves half a file
        # that reads as an answer.
        temporary = f"{path}.part"
        with open(temporary, "wb") as f:
            f.write(data)
        os.replace(temporary, path)
