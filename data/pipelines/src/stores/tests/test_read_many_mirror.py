"""What `Conductor.read_many` hands back when the mirror is older than the bucket.

The compressed mirror is rebuilt by hand, so it is usually behind: on
2026-09-28 its newest archive was dated 2026-07-31 and lacked 7,989 of the
38,339 rejestr.io objects. Stopping at the archive served the register as it
stood two months earlier, without a word.
"""

from datetime import date
from pathlib import Path

import pytest

from conductor import Conductor
from scrapers.stores import CloudStorage
from scrapers.stores.file import DownloadableFile, NotInMirrorError
from stores.storage import CRAWLED_BUCKET


def name(path: str) -> str:
    return f"hostname=rejestr.io/api/v2/org/{path}"


def url(path: str) -> str:
    return f"gs://{CRAWLED_BUCKET}/{name(path)}"


class FakeMirror:
    bulk_reads_enabled = True

    def __init__(
        self,
        objects: dict[str, bytes] | None,
        covered: tuple[str, set[str]] | None = None,
    ):
        self.objects = objects
        self.covered = covered

    def covered_until(self, host: str):
        return self.covered

    def _resolve_tar_paths(self, host: str) -> list[Path]:
        if self.objects is None:
            raise NotInMirrorError(host)
        return [Path("from=2026-05-27.date=2026-07-31.tar.gz")]

    def iter_objects(self, host: str):
        assert self.objects is not None
        yield from self.objects.items()


class FakeStorage:
    """A bucket listing whose objects count their own downloads."""

    def __init__(self, objects: dict[str, str], broken: frozenset[str] = frozenset()):
        self.objects = objects
        self.broken = broken
        self.downloaded: list[str] = []
        self.seeded: list[tuple[str, set[str]]] = []
        self.listed: list[CloudStorage] = []

    def seed_listing_ranges(self, ref: CloudStorage, names) -> None:
        self.seeded.append((ref.prefix, set(names)))

    def list_blobs(self, ref: CloudStorage):
        self.listed.append(ref)
        # As the `**date={a,b}**` glob does: the day anywhere in the name.
        days = ref.namespace_values.get("date", "").strip("{}").split(",")
        for blob_name, body in self.objects.items():
            if ref.namespace_values and not any(f"date={d}" in blob_name for d in days):
                continue
            if blob_name.startswith(ref.prefix):
                yield DownloadableFile(
                    f"gs://{CRAWLED_BUCKET}/{blob_name}",
                    blob_name.replace("/", "."),
                    download_lambda=self._downloader(blob_name, body),
                    size=len(body),
                )

    def _downloader(self, blob_name: str, body: str):
        def download(path: Path):
            if blob_name in self.broken:
                raise ConnectionError(f"{blob_name}: connection reset")
            self.downloaded.append(blob_name)
            path.write_text(body)

        return download


@pytest.fixture(autouse=True)
def download_dir(tmp_path, monkeypatch):
    monkeypatch.setattr("stores.download.base_dir", tmp_path)


def conductor(mirror: FakeMirror, storage: FakeStorage) -> Conductor:
    instance = Conductor.__new__(Conductor)
    instance.mirror = mirror  # type: ignore[assignment]
    instance.__dict__["storage"] = storage
    instance.progress_bar = None
    instance.continous_download = False
    return instance


def read(io: Conductor, prefix: str = "hostname=rejestr.io") -> dict[str, str]:
    return {u: f.read_string() for u, f in io.read_many(CloudStorage(prefix=prefix))}


def test_what_was_crawled_since_the_archive_is_read_from_the_bucket():
    storage = FakeStorage(
        {
            name("1/date=2026-07-02"): "archived",
            name("1/date=2026-09-27"): "newer",
            name("2/date=2026-08-15"): "new company",
        }
    )
    io = conductor(FakeMirror({name("1/date=2026-07-02"): b"archived"}), storage)

    assert read(io) == {
        url("1/date=2026-07-02"): "archived",
        url("1/date=2026-09-27"): "newer",
        url("2/date=2026-08-15"): "new company",
    }


def test_only_what_the_archive_lacks_is_downloaded():
    storage = FakeStorage(
        {
            name("1/date=2026-07-02"): "archived",
            name("1/date=2026-09-27"): "newer",
        }
    )
    io = conductor(FakeMirror({name("1/date=2026-07-02"): b"archived"}), storage)

    read(io)

    assert storage.downloaded == [name("1/date=2026-09-27")]


def test_a_narrower_prefix_gets_only_its_part_of_the_archive():
    storage = FakeStorage({name("1/date=2026-07-02"): "one"})
    io = conductor(
        FakeMirror(
            {
                name("1/date=2026-07-02"): b"one",
                name("2/date=2026-07-02"): b"two",
            }
        ),
        storage,
    )

    assert read(io, prefix=name("1")) == {url("1/date=2026-07-02"): "one"}


def test_without_a_mirror_every_object_is_read_in_listing_order():
    paths = [f"{krs:010d}/date=2026-09-27" for krs in range(300)]
    storage = FakeStorage({name(p): p for p in paths})
    io = conductor(FakeMirror(None), storage)

    assert list(read(io)) == [url(p) for p in paths]


def test_a_failed_download_still_fails_the_read():
    """Fetching ahead must not turn a lost object into a silently missing one."""
    storage = FakeStorage(
        {name("1/date=2026-09-27"): "fine", name("2/date=2026-09-27"): "lost"},
        broken=frozenset({name("2/date=2026-09-27")}),
    )
    io = conductor(FakeMirror(None), storage)

    with pytest.raises(ConnectionError):
        read(io)


def test_an_object_listed_as_empty_is_not_fetched():
    """A crawl stored as failed is a zero-byte object, and the listing says so."""
    storage = FakeStorage(
        {name("1/date=2026-10-02"): "", name("2/date=2026-10-02"): "x"}
    )
    io = conductor(FakeMirror(None), storage)

    assert read(io) == {url("1/date=2026-10-02"): "", url("2/date=2026-10-02"): "x"}
    assert storage.downloaded == [name("2/date=2026-10-02")]


def test_the_archives_names_split_the_listing_of_what_it_lacks():
    """A fresh container has never listed the prefix, but the archive just named it."""
    storage = FakeStorage(
        {name("1/date=2026-07-02"): "archived", name("2/date=2026-09-27"): "new"}
    )
    io = conductor(FakeMirror({name("1/date=2026-07-02"): b"archived"}), storage)

    read(io)

    assert storage.seeded == [("hostname=rejestr.io", {name("1/date=2026-07-02")})]


def test_a_memo_is_kept_for_the_next_run_on_this_machine(tmp_path, monkeypatch):
    monkeypatch.setattr("stores.config.DOWNLOADED_DIR", str(tmp_path))
    io = conductor(FakeMirror(None), FakeStorage({}))

    assert io.read_memo("odpis-seats", "a.pdf") is None
    io.write_memo("odpis-seats", "a.pdf", '{"rows": []}')

    assert io.read_memo("odpis-seats", "a.pdf") == '{"rows": []}'
    assert not list(tmp_path.rglob("*.part")), "written whole, then renamed"


def test_with_a_manifest_only_the_days_after_the_archive_are_listed(monkeypatch):
    monkeypatch.setattr(Conductor, "_today", staticmethod(lambda: date(2026, 11, 27)))
    archived = {name("1/date=2026-11-20"): b"archived"}
    storage = FakeStorage(
        {
            name("1/date=2026-11-20"): "archived",
            name("1/date=2026-11-26"): "newer",
            name("2/date=2026-11-27"): "today",
            # The glob matches the day anywhere; only the stamp counts.
            name("3/?od=2026-11-26/date=2026-11-19"): "old, in the archive's days",
        }
    )
    mirror = FakeMirror(archived, covered=("2026-11-25", set(archived)))
    io = conductor(mirror, storage)

    assert read(io) == {
        url("1/date=2026-11-20"): "archived",
        url("1/date=2026-11-26"): "newer",
        url("2/date=2026-11-27"): "today",
    }
    [listing] = storage.listed
    assert listing.namespace_values == {"date": "{2026-11-26,2026-11-27}"}
    assert storage.seeded == [], "no whole listing to split"


def test_a_mirror_past_the_day_listing_is_listed_whole(monkeypatch):
    monkeypatch.setattr(Conductor, "_today", staticmethod(lambda: date(2026, 11, 27)))
    archived = {name("1/date=2026-01-20"): b"archived"}
    storage = FakeStorage(
        {name("1/date=2026-01-20"): "archived", name("1/date=2026-11-26"): "newer"}
    )
    io = conductor(FakeMirror(archived, covered=("2026-01-25", set(archived))), storage)

    assert read(io) == {
        url("1/date=2026-01-20"): "archived",
        url("1/date=2026-11-26"): "newer",
    }
    [listing] = storage.listed
    assert listing.namespace_values == {}
