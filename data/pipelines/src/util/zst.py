"""zstd frames in, bytes out: `compression.zstd` on Python 3.14, `zstandard`
before it."""

import tarfile
import typing

try:
    from compression import zstd as _zstd  # type: ignore[import-not-found]
except ImportError:  # Python < 3.14
    _zstd = None
    import zstandard


def decompress(data: bytes) -> bytes:
    """Every frame of a `.zst` file, as `zstd -dc` would write them."""
    if _zstd is not None:
        return _zstd.decompress(data)
    # A decompressobj, unlike `ZstdDecompressor().decompress`, needs no
    # content size in the frame header, which a streaming writer leaves out.
    out = bytearray()
    while data:
        obj = zstandard.ZstdDecompressor().decompressobj()
        out += obj.decompress(data)
        data = obj.unused_data
    return bytes(out)


def compress(data: bytes, level: int = 3, window_log: int = 24) -> bytes:
    """One zstd frame, with long-distance matching over a `2**window_log`
    window: a crawl archive's pages repeat a template far apart."""
    if _zstd is not None:
        P = _zstd.CompressionParameter
        return _zstd.compress(
            data,
            options={
                P.compression_level: level,
                P.window_log: window_log,
                P.enable_long_distance_matching: 1,
            },
        )
    params = zstandard.ZstdCompressionParameters.from_level(
        level, window_log=window_log, enable_ldm=True
    )
    return zstandard.ZstdCompressor(compression_params=params).compress(data)


def read_maybe_zst(data: bytes, name: str) -> bytes:
    """`data` as stored, decompressed when `name` ends in `.zst`."""
    return decompress(data) if name.endswith(".zst") else data


#: Archives the compressor and the crawler write (`.tar.zst`), and those they
#: wrote before 2026-11-27 (`.tar.gz`).
TAR_SUFFIXES = (".tar.zst", ".tar.gz")

#: The largest window a reader accepts (2 GiB): the compressor may write with
#: a window the size of a whole archive, past zstd's default limit of 128 MiB.
MAX_WINDOW_LOG = 31

_ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"


def is_tar_archive(name: str) -> bool:
    return name.endswith(TAR_SUFFIXES)


def _zstd_reader(fileobj: typing.BinaryIO) -> typing.BinaryIO:
    if _zstd is not None:
        return _zstd.ZstdFile(
            fileobj,
            options={_zstd.DecompressionParameter.window_log_max: MAX_WINDOW_LOG},
        )
    return zstandard.ZstdDecompressor(
        max_window_size=1 << MAX_WINDOW_LOG
    ).stream_reader(fileobj, read_across_frames=True)  # type: ignore[return-value]


def open_tar_stream(fileobj: typing.BinaryIO) -> tarfile.TarFile:
    """A tar.zst or tar.gz, by its first bytes, to be read member by member.

    A stream (`r|`): members come in order, and each is extracted before the
    next is asked for. `fileobj` must be seekable for the sniff.
    """
    head = fileobj.read(4)
    fileobj.seek(-len(head), 1)
    if head == _ZSTD_MAGIC:
        return tarfile.open(fileobj=_zstd_reader(fileobj), mode="r|")
    return tarfile.open(fileobj=fileobj, mode="r|*")
