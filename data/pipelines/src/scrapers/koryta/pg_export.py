"""The site's nightly export from Postgres, read in place of Firestore's.

`frontend/scripts/pg/export-jsonl.ts` writes one export as a directory
``date=<ISO timestamp>/`` holding ``<collection>.jsonl.zst`` (each line
``{"id": <document id>, "data": <document>}``) and ``export.json``, written
last, with ``exportedAt`` and the row count of every collection it took.

``KORYTA_EXPORT`` points the pipelines at one such directory: a local path,
``gs://bucket/prefix`` or ``https://...``. Set, `FirestoreCollection` and
`scrapers.koryta.snapshot` read it instead of listing
``gs://koryta-pl-crawled/hostname=koryta.pl``; unset, nothing changes.

The documents are the ones Firestore's export holds, in the shapes the
Postgres migration stores (frontend/server/db/normalize.ts): a timestamp is
an ISO 8601 string rather than a `datetime`, a reference such as
``revision_id`` the path ``revisions/<id>`` rather than a datastore ``Key``
(`reference_id` reads both), and a list Firestore kept as a ``{"0": ...}`` map
is a list.
"""

import json
from dataclasses import dataclass
from functools import cache

from stores.pg_export import ENV, export_source
from stores.pg_export import read_file as _read
from util.zst import read_maybe_zst

MANIFEST = "export.json"

__all__ = ["ENV", "PgExport", "configured_export", "open_export"]


@dataclass(frozen=True)
class PgExport:
    source: str
    exported_at: str
    collections: dict[str, int]

    def exports(self, collection: str) -> bool:
        return collection in self.collections

    def documents(self, collection: str) -> list[tuple[str, dict]]:
        """(document id, document) of every document of ``collection``."""
        content = _read(self.source, f"{collection}.jsonl.zst")
        if content is None:
            return []
        out = []
        for line in read_maybe_zst(content, ".zst").splitlines():
            if line.strip():
                row = json.loads(line)
                out.append((str(row["id"]), row["data"]))
        return out


@cache
def open_export(source: str) -> PgExport:
    """The export at ``source``; an error when its ``export.json`` is missing,
    which means the export is still being written or was cut short."""
    manifest = _read(source, MANIFEST)
    if manifest is None:
        raise FileNotFoundError(
            f"{source}/{MANIFEST} is missing: the export is incomplete or "
            f"{ENV} names the wrong directory"
        )
    data = json.loads(manifest)
    return PgExport(
        source=source,
        exported_at=str(data["exportedAt"]),
        collections=dict(data.get("collections", {})),
    )


def configured_export() -> PgExport | None:
    source = export_source()
    return open_export(source) if source else None
