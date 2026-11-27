"""Where the nightly export from Postgres is, and its files' bytes
(`scrapers.koryta.pg_export` reads them). Here rather than there because
reading the environment, the disk and the network is a store's work."""

import os
import urllib.error
import urllib.request

from google.cloud import storage

#: A local path, ``gs://bucket/prefix`` or ``https://...`` of one export.
ENV = "KORYTA_EXPORT"


def export_source() -> str | None:
    """The export directory KORYTA_EXPORT names, or None to read Firestore's."""
    value = os.environ.get(ENV, "").strip()
    return value.rstrip("/") or None


def read_file(source: str, name: str) -> bytes | None:
    """One file of the export, or None when it has no such file."""
    if source.startswith("gs://"):
        bucket, _, prefix = source.removeprefix("gs://").partition("/")
        blob = storage.Client().bucket(bucket).blob(f"{prefix}/{name}".lstrip("/"))
        return blob.download_as_bytes() if blob.exists() else None
    if source.startswith(("http://", "https://")):
        try:
            with urllib.request.urlopen(f"{source}/{name}") as response:  # noqa: S310
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise
    path = os.path.join(source, name)
    if not os.path.exists(path):
        return None
    with open(path, "rb") as file:
        return file.read()
