"""The mirror reads a chain of archives in either format."""

import argparse
import io
import tarfile

from stores.download import CompressedMirror
from util import zst

HOST = "api-krs.ms.gov.pl"


def archive(members: dict[str, bytes], zstd: bool) -> bytes:
    """As the compressor writes one: index.txt first, `host/<name>` members."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w" if zstd else "w:gz") as tar:
        index = "".join(f"hostname={HOST}/{n}\n" for n in members).encode()
        for name, data in {"index.txt": index, **members}.items():
            info = tarfile.TarInfo(name if name == "index.txt" else f"{HOST}/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return zst.compress(buf.getvalue()) if zstd else buf.getvalue()


def test_a_chain_of_gzip_and_zstd_archives_is_read_whole(tmp_path):
    host_dir = tmp_path / f"hostname={HOST}"
    (host_dir / "from=2025-01-01").mkdir(parents=True)
    (host_dir / "from=2026-11-20").mkdir()
    (host_dir / "from=2025-01-01/date=2026-11-20.tar.gz").write_bytes(
        archive({"a/date=2026-11-19": b"old"}, zstd=False)
    )
    (host_dir / "from=2026-11-20/date=2026-11-26.tar.zst").write_bytes(
        archive({"b/?x=1/date=2026-11-25": b"new"}, zstd=True)
    )
    mirror = CompressedMirror()
    mirror.__dict__["args"] = argparse.Namespace(
        compressed_mirror_bucket=str(tmp_path), no_mirror=False
    )

    assert dict(mirror.iter_objects(HOST)) == {
        f"hostname={HOST}/a/date=2026-11-19": b"old",
        f"hostname={HOST}/b/?x=1/date=2026-11-25": b"new",
    }
