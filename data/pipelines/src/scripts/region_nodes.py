"""The site's region nodes from TERC alone, for a database that has none.

The public copy of koryta.pl (local_artifacts/dev-db/public) leaves the
regions out, so on the demo every person's `teryt` filter came back empty. This
writes the payloads `RegionPayloads` would send, one JSON line each, ids as
production has them (`teryt<code>`, an `owns` edge from the parent), from the
TERC file of the TERYT register, which is public:

    uv run python -m scripts.region_nodes --terc-zip downloaded/teryt_codes.zip \\
        --keep-gminy-from ../../local_artifacts/dev-db/public \\
        --out ../../frontend/scripts/pg/teryt-regions.jsonl

`RegionPayloads` keeps the gminy some company names as an owner, which takes
the whole company pipeline to know. `--keep-gminy-from` keeps instead every
gmina a file in that directory names (`teryt` and seven digits): on the
2026-11 public copy 974 of them, against production's 993.
"""

import argparse
import io
import json
import re
import zipfile
from pathlib import Path

import pandas as pd

from analysis.payloads.region import map_region_payload
from scrapers.map.teryt import regions_frame
from util.zst import read_maybe_zst

TERC_CSV = "TERC_Urzedowy_2025-11-15.csv"
GMINA_ID = re.compile(rb'"teryt(\d{7})"')


def read_terc_zip(path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(path) as archive:
        content = archive.read(TERC_CSV)
    return pd.read_csv(
        io.BytesIO(content),
        sep=";",
        dtype={"WOJ": str, "POW": str, "GMI": str, "RODZ": str},
    )


def gminy_named_in(directory: Path) -> frozenset[str]:
    """Every seven-digit TERYT code a `.jsonl` or `.jsonl.zst` file names."""
    codes: set[str] = set()
    for path in sorted(directory.iterdir()):
        if path.name.endswith((".jsonl", ".jsonl.zst")):
            codes.update(
                m.decode()
                for m in GMINA_ID.findall(read_maybe_zst(path.read_bytes(), path.name))
            )
    return frozenset(codes)


def region_payloads(terc: pd.DataFrame, keep_gminy: frozenset[str]) -> list[dict]:
    regions = regions_frame(terc)
    regions["id_len"] = regions["id"].astype(str).str.len()
    # Parents first, as `RegionPayloads` sends them.
    regions = regions.sort_values(["id_len", "id"], kind="stable")
    payloads = []
    for _, row in regions.iterrows():
        payload = map_region_payload(row, keep_gminy)
        if payload:
            payloads.append(payload)
    return payloads


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--terc-zip", type=Path, required=True)
    parser.add_argument("--keep-gminy-from", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    keep = gminy_named_in(args.keep_gminy_from) if args.keep_gminy_from else frozenset()
    payloads = region_payloads(read_terc_zip(args.terc_zip), keep)
    with args.out.open("w", encoding="utf-8") as out:
        for payload in payloads:
            out.write(json.dumps(payload, ensure_ascii=False) + "\n")
    levels: dict[int, int] = {}
    for payload in payloads:
        levels[len(payload["teryt"])] = levels.get(len(payload["teryt"]), 0) + 1
    print(f"{len(payloads)} regions by code length {dict(sorted(levels.items()))}")


if __name__ == "__main__":
    main()
