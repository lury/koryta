import json

import pytest
import zstandard

from scrapers.koryta import pg_export, snapshot
from scrapers.koryta.download import FirestoreCollection


def write_export(directory, collections, manifest=True):
    for name, rows in collections.items():
        lines = "".join(
            json.dumps({"id": doc_id, "data": doc}) + "\n" for doc_id, doc in rows
        )
        (directory / f"{name}.jsonl.zst").write_bytes(
            zstandard.ZstdCompressor().compress(lines.encode())
        )
    if manifest:
        (directory / "export.json").write_text(
            json.dumps(
                {
                    "exportedAt": "2026-11-26T01:00:00.000Z",
                    "collections": {k: len(v) for k, v in collections.items()},
                }
            )
        )


@pytest.fixture
def export(tmp_path, monkeypatch):
    write_export(
        tmp_path,
        {
            "nodes": [
                ("p1", {"type": "person", "name": "A"}),
                ("c1", {"type": "place", "name": "B"}),
                ("p2", {"type": "person", "name": "C", "id": "stored"}),
            ],
            "votes": [],
        },
    )
    monkeypatch.setenv(pg_export.ENV, str(tmp_path))
    pg_export.open_export.cache_clear()
    yield tmp_path
    pg_export.open_export.cache_clear()


def test_firestore_collection_reads_the_export_rows_as_it_builds_them(export):
    df = FirestoreCollection("nodes", "person", "2020-01-01").process(None)
    rows = df.to_dict(orient="records")
    # A stored `id` wins, as in the Firestore branch.
    assert sorted(r["id"] for r in rows) == ["p1", "stored"]
    assert {r["date"] for r in rows} == {"2026-11-26T01:00:00.000Z"}


def test_snapshot_reads_one_export(export):
    date = snapshot.latest_export(None)
    assert date == "2026-11-26T01:00:00.000Z"
    assert snapshot.is_complete(None, date)
    assert snapshot.is_exported(None, date, "votes")
    assert not snapshot.is_exported(None, date, "audit")
    docs = {d["id"]: d for d in snapshot.read_collection(None, date, "nodes")}
    assert docs["p2"]["stored_id"] == "stored"
    assert docs["c1"]["name"] == "B"


def test_an_export_without_its_manifest_is_refused(tmp_path, monkeypatch):
    write_export(tmp_path, {"nodes": []}, manifest=False)
    monkeypatch.setenv(pg_export.ENV, str(tmp_path))
    pg_export.open_export.cache_clear()
    with pytest.raises(FileNotFoundError):
        pg_export.configured_export()
    pg_export.open_export.cache_clear()


def test_unset_reads_firestore(monkeypatch):
    monkeypatch.delenv(pg_export.ENV, raising=False)
    assert pg_export.configured_export() is None
