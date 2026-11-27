"""A crawled page is done only once the archive holding it is stored."""

import argparse
import base64
import hashlib
import io
import sys

import pytest
from google.api_core import exceptions as gcs_exceptions

from scrapers.article import crawler
from scrapers.article.crawler import CrawlOptions, CrawlResult
from scrapers.stores import CrawlQueueItem
from stores import config, download
from stores.storage import BatchClient, BatchUploadError
from util.zst import open_tar_stream


class Blob:
    def __init__(self, gcs: "GCS", name: str):
        self.gcs, self.name = gcs, name
        self.md5_hash = None

    def upload_from_string(self, data, content_type=None, if_generation_match=None):
        self.gcs.attempts += 1
        if self.gcs.failures_left > 0:
            self.gcs.failures_left -= 1
            raise gcs_exceptions.ServiceUnavailable("503 backend error")
        if self.name in self.gcs.objects:
            raise gcs_exceptions.PreconditionFailed("exists")
        self.gcs.objects[self.name] = data

    def reload(self):
        data = self.gcs.objects[self.name]
        self.md5_hash = base64.b64encode(hashlib.md5(data).digest()).decode()


class GCS:
    """A bucket whose first `failures_left` uploads answer 503."""

    def __init__(self, failures_left: int = 0):
        self.objects: dict[str, bytes] = {}
        self.failures_left = failures_left
        self.attempts = 0

    def bucket(self, name: str) -> "GCS":
        return self

    def blob(self, name: str) -> Blob:
        return Blob(self, name)


def batch_client(
    gcs: GCS, max_batch_size: int = 1 << 30, max_age: float = 3600
) -> BatchClient:
    client = BatchClient.__new__(BatchClient)
    client.storage_client = gcs  # type: ignore[assignment]
    client.__dict__["args"] = argparse.Namespace(
        max_batch_size=max_batch_size, batch_max_age=max_age, flush_max_workers=4
    )
    client.UPLOAD_BACKOFF_S = 0
    client._init_batches()
    return client


@pytest.fixture(autouse=True)
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DOWNLOADED_DIR", str(tmp_path))
    monkeypatch.setattr(download, "base_dir", tmp_path)


def members(data: bytes) -> dict[str, bytes]:
    assert data[:4] == b"\x28\xb5\x2f\xfd", "a .tar.zst"
    with open_tar_stream(io.BytesIO(data)) as tar:
        return {
            m.name: tar.extractfile(m).read()  # type: ignore[union-attr]
            for m in tar
        }


def test_a_page_is_not_stored_until_its_archive_is_uploaded():
    gcs = GCS()
    client = batch_client(gcs)

    path = client.batch_upload("https://portal.pl/a?id=1", "<p>1</p>", "text/html")

    assert client.batch_state(path) == "open"
    assert gcs.objects == {}
    client.flush_batches()
    assert client.batch_state(path) == "stored"
    [(name, data)] = gcs.objects.items()
    assert path.endswith(name)
    assert members(data) == {
        "portal.pl/a/?id=1": b"<p>1</p>",
        "index.txt": b"portal.pl/a/?id=1\n",
    }


def test_an_archive_goes_once_it_holds_max_batch_size():
    gcs = GCS()
    client = batch_client(gcs, max_batch_size=10)

    first = client.batch_upload("https://portal.pl/a", "12345", "text/html")
    assert client.batch_state(first) == "open"
    second = client.batch_upload("https://portal.pl/b", "67890", "text/html")

    assert first == second
    assert client.batch_state(first) == "stored"
    assert len(gcs.objects) == 1


def test_an_archive_goes_once_it_is_max_age_old(monkeypatch):
    gcs = GCS()
    client = batch_client(gcs, max_age=300)
    clock = [1000.0]
    monkeypatch.setattr("stores.storage.time.monotonic", lambda: clock[0])

    path = client.batch_upload("https://portal.pl/a", "x", "text/html")
    client._flush_old()
    assert client.batch_state(path) == "open"
    clock[0] += 301
    client._flush_old()

    assert client.batch_state(path) == "stored"


def test_a_failed_upload_is_retried():
    gcs = GCS(failures_left=2)
    client = batch_client(gcs)

    path = client.batch_upload("https://portal.pl/a", "x", "text/html")
    client.flush_batches()

    assert client.batch_state(path) == "stored"
    assert gcs.attempts == 3


def test_an_upload_that_keeps_failing_is_an_error_not_a_print():
    gcs = GCS(failures_left=100)
    client = batch_client(gcs)

    path = client.batch_upload("https://portal.pl/a", "x", "text/html")
    with pytest.raises(BatchUploadError, match="503"):
        client.flush_batches()

    assert client.batch_state(path) == "failed"
    assert gcs.attempts == BatchClient.UPLOAD_ATTEMPTS
    assert gcs.objects == {}


def test_max_batch_size_from_the_command_line_is_a_number(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["koryta", "--max_batch_size", "1000000"])
    client = BatchClient.__new__(BatchClient)

    assert client.args.max_batch_size == 1_000_000


class Queue:
    def __init__(self, urls: list[str]):
        self.batches = [
            [CrawlQueueItem(uid=str(i), url=u, priority=0) for i, u in enumerate(urls)]
        ]
        self.done: list = []
        self.errors: list = []

    def get_batch(self, worker, batch_size, max_retries, timeout_seconds):
        return self.batches.pop(0) if self.batches else []

    def mark_done_batch(self, items):
        self.done += items

    def mark_error_batch(self, items):
        self.errors += items

    def release_batch(self, items):
        pass

    def put(self, urls):
        pass


class Ctx:
    def __init__(self, io):
        self.io = io


def gcs_options() -> CrawlOptions:
    return CrawlOptions(
        worker_id="w",
        storage_type="gcs",
        local_output=None,
        per_url_max_retries=3,
        lock_timeout_seconds=60,
        per_domain_wait_between_requests_s=0,
        url_scoring_function="default",
        worker_threads=2,
        queue_flush_size=2,
    )


def crawl_into(client: BatchClient):
    def crawl_url(ctx, parsed, options):
        path = ctx.io.batch_upload(parsed.full_url, b"<html/>", "text/html")
        # Nothing was uploaded yet: a page reported done now would be lost.
        assert client.batch_state(path) == "open"
        return CrawlResult(storage_path=path, batched=True)

    return crawl_url


URLS = ["https://portal.pl/a", "https://portal.pl/b", "https://inny.pl/c"]


def test_the_crawl_marks_pages_done_after_their_archive_is_stored(monkeypatch):
    gcs = GCS(failures_left=1)
    client = batch_client(gcs)
    monkeypatch.setattr(crawler, "crawl_url", crawl_into(client))
    queue = Queue(URLS)

    crawler._coordinator(0, gcs_options(), queue, Ctx(client), set())  # type: ignore[arg-type]

    assert sorted(uid for uid, _, _ in queue.done) == ["0", "1", "2"]
    assert queue.errors == []
    stored = {m for data in gcs.objects.values() for m in members(data)}
    assert {"portal.pl/a", "portal.pl/b", "inny.pl/c"} <= stored


def test_pages_whose_archive_failed_are_errors_and_fail_the_run(monkeypatch):
    gcs = GCS(failures_left=10_000)
    client = batch_client(gcs)
    monkeypatch.setattr(crawler, "crawl_url", crawl_into(client))
    queue = Queue(URLS)

    with pytest.raises(RuntimeError, match="3 crawled pages could not be stored"):
        crawler._coordinator(0, gcs_options(), queue, Ctx(client), set())  # type: ignore[arg-type]

    assert queue.done == []
    assert sorted(uid for uid, _ in queue.errors) == ["0", "1", "2"]
    assert all("not stored" in why and "503" in why for _, why in queue.errors)


def test_a_page_waiting_too_long_has_its_archive_sent_early(monkeypatch):
    gcs = GCS()
    client = batch_client(gcs)
    path = client.batch_upload("https://portal.pl/a", "x", "text/html")
    item = CrawlQueueItem(uid="0", url="https://portal.pl/a", priority=0)
    unstored = crawler._Unstored(
        [(item, CrawlResult(storage_path=path, batched=True), 0.0)]
    )
    ctx = Ctx(client)

    assert unstored.settle(ctx, now=10.0, wait_s=30.0) == []  # type: ignore[arg-type]
    assert client.batch_state(path) == "open"
    assert len(unstored.settle(ctx, now=31.0, wait_s=30.0)) == 1  # type: ignore[arg-type]
    assert client.batch_state(path) == "stored"
