"""Every crawled page gets a name of its own, and old names are still read."""

import io
import tarfile

import pytest
from google.api_core import exceptions as gcs_exceptions

from scrapers.article.pipelines import pipeline_utils
from scrapers.bip.classify import normalize_url
from stores import config, download
from stores.storage import Client, crawl_blob_name, crawl_member_name
from util import zst

DAY = "2026-11-27"

#: Pages of the 2026-11-27 sample that shared a name per day without the query.
SAMPLE_COLLISIONS = {
    "bip.zapolice.pl": [
        "https://bip.zapolice.pl/?bip=1&bsc=N&cid=21",
        "https://bip.zapolice.pl/?bip=1&bsc=N&cid=10",
        "https://bip.zapolice.pl/?bip=1&cid=22",
    ],
    "dobrcz.bip.net.pl": [
        "https://dobrcz.bip.net.pl/?p=map",
        "https://dobrcz.bip.net.pl/?p=help",
        "https://dobrcz.bip.net.pl/?p=dostepnosc",
    ],
    "bip.dukla.pl": [
        "https://bip.dukla.pl/?c=mdTresc-cmPokaz-22",
        "https://bip.dukla.pl/?c=mdTresc-cmPokaz-40",
    ],
    "bip.um.rybnik.eu": [
        "https://bip.um.rybnik.eu/Default.aspx?Page=0",
        "https://bip.um.rybnik.eu/Default.aspx?Page=68",
    ],
    "ugtuczna.bip.lubelskie.pl": [
        "https://ugtuczna.bip.lubelskie.pl/index.php?id=17",
        "https://ugtuczna.bip.lubelskie.pl/index.php?id=ostatnio_dodane",
    ],
    "nowybip.plock.eu": [
        "https://nowybip.plock.eu/najnowsze",
        "https://nowybip.plock.eu/najnowsze?page=2",
    ],
}


@pytest.mark.parametrize("host", sorted(SAMPLE_COLLISIONS))
def test_pages_that_differ_only_in_the_query_get_names_of_their_own(host):
    urls = SAMPLE_COLLISIONS[host]

    without = {crawl_blob_name(u, include_query=False, day=DAY) for u in urls}
    names = {crawl_blob_name(u, include_query=True, day=DAY) for u in urls}
    members = {crawl_member_name(u) for u in urls}

    assert len(without) == 1, "the sample's collision is what this guards"
    assert len(names) == len(urls)
    assert len(members) == len(urls)


def test_a_slash_in_a_value_cannot_meet_a_longer_path():
    a = crawl_blob_name("https://h.pl/x?a=b/c", include_query=True, day=DAY)
    b = crawl_blob_name("https://h.pl/x?a=b", include_query=True, day=DAY)

    assert a != b
    assert a == "hostname=h.pl/x/?a=b%2Fc/date=2026-11-27"


def test_the_krs_names_stay_as_they_were():
    url = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000394808?rejestr=P"

    assert crawl_blob_name(url, include_query=True, day=DAY) == (
        "hostname=api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000394808"
        "/?rejestr=P/date=2026-11-27"
    )


class Blob:
    def __init__(self, bucket: dict, name: str):
        self.bucket, self.name = bucket, name

    def upload_from_string(self, data, content_type=None, if_generation_match=None):
        if self.name in self.bucket:
            raise gcs_exceptions.PreconditionFailed("exists")
        self.bucket[self.name] = data


class GCS:
    def __init__(self):
        self.objects: dict = {}

    def bucket(self, name: str):
        return self

    def blob(self, name: str) -> Blob:
        return Blob(self.objects, name)


def test_upload_by_default_keeps_every_page_of_a_query_addressed_bip(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "DOWNLOADED_DIR", str(tmp_path))
    monkeypatch.setattr(download, "base_dir", tmp_path)
    client = Client.__new__(Client)
    gcs = GCS()
    client.storage_client = gcs  # type: ignore[assignment]

    urls = SAMPLE_COLLISIONS["bip.zapolice.pl"]
    for i, url in enumerate(urls):
        assert client.upload(url, f"page {i}", "text/html", verbose=False)

    assert sorted(gcs.objects.values()) == ["page 0", "page 1", "page 2"]


def _tar(members: dict[str, bytes], zstd: bool = False) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w" if zstd else "w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return zst.compress(buf.getvalue()) if zstd else buf.getvalue()


class _Read:
    def __init__(self, data: bytes):
        self.data = data

    def read_bytes(self) -> bytes:
        return self.data


class _IO:
    def __init__(self, archives: dict[str, bytes]):
        self.archives = archives

    def read_data(self, ref):
        return _Read(self.archives[ref.blob_name])


class _Ctx:
    def __init__(self, archives: dict[str, bytes]):
        self.io = _IO(archives)


class _Done:
    def __init__(self, url: str, storage_path: str):
        self.url, self.storage_path = url, storage_path


def test_article_archives_are_read_under_old_and_new_names():
    new_url = "https://wiadomosci.wp.pl/artykul?id=1"
    old_url = "https://wiadomosci.onet.pl/kraj/artykul"
    archives = {
        "hostname=wiadomosci.wp.pl/date=2026-11-27/uid_a.tar.zst": _tar(
            {crawl_member_name(new_url): b"new"}, zstd=True
        ),
        "hostname=wiadomosci.onet.pl/date=2026-10-01/uid_b.tar.gz": _tar(
            {"wiadomosci.onet.pl/kraj/artykul": b"old"}
        ),
    }
    done = [
        _Done(new_url, "gs://koryta-pl-crawled/" + next(iter(archives))),
        _Done(old_url, "gs://koryta-pl-crawled/" + list(archives)[1]),
    ]

    got = dict(pipeline_utils.iter_html_from_storage(_Ctx(archives), done))  # type: ignore[arg-type]

    assert got == {new_url: b"new", old_url: b"old"}


@pytest.mark.parametrize(
    "variant",
    [
        "https://bip.strzyzow.pl/index.php?czcionka=0&grp=7&page=group.php",
        "https://bip.strzyzow.pl/index.php?czcionka=2&grp=7&page=group.php",
        "https://bip.strzyzow.pl/index.php?grp=7&kontrast=1&page=group.php",
    ],
)
def test_softres_font_and_contrast_views_are_the_same_page(variant):
    assert normalize_url(variant) == normalize_url(
        "https://bip.strzyzow.pl/index.php?grp=7&page=group.php"
    )
