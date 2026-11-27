"""zstd frames in, bytes out: `compression.zstd` on Python 3.14, `zstandard`
before it."""

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


def read_maybe_zst(data: bytes, name: str) -> bytes:
    """`data` as stored, decompressed when `name` ends in `.zst`."""
    return decompress(data) if name.endswith(".zst") else data
