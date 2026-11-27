import json

import pandas as pd
import pytest

from scripts.region_nodes import gminy_named_in, region_payloads
from util.zst import decompress


def terc() -> pd.DataFrame:
    rows = [
        ("02", None, None, None, "DOLNOŚLĄSKIE"),
        ("02", "01", None, None, "bolesławiecki"),
        ("02", "01", "01", "1", "Bolesławiec"),
        ("02", "01", "02", "2", "Bolesławiec"),
        ("02", "61", None, None, "Jelenia Góra"),
    ]
    return pd.DataFrame(rows, columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"])


def test_ids_names_and_parents_are_productions():
    payloads = region_payloads(terc(), frozenset({"0201011"}))
    assert [p["node_id"] for p in payloads] == [
        "teryt02",
        "teryt0201",
        "teryt0261",
        "teryt0201011",
    ]
    by_id = {p["node_id"]: p for p in payloads}
    assert by_id["teryt0201"]["name"] == "Powiat bolesławiecki"
    assert by_id["teryt0261"]["name"] == "Jelenia Góra"
    assert by_id["teryt0201011"]["name"] == "Gmina Bolesławiec"
    assert by_id["teryt0201011"]["edge"] == {
        "edge_id": "edge_teryt0201_teryt0201011_owns",
        "source": "teryt0201",
        "target": "teryt0201011",
        "type": "owns",
    }
    assert "edge" not in by_id["teryt02"]


def test_keeps_the_gminy_a_file_names(tmp_path):
    (tmp_path / "edges.jsonl").write_text(
        json.dumps({"source": "a", "target": "teryt0201022"}) + "\n"
    )
    (tmp_path / "other.txt").write_text('"teryt0201011"')
    assert gminy_named_in(tmp_path) == frozenset({"0201022"})


def test_decompresses_several_frames():
    zstandard = pytest.importorskip("zstandard")  # before Python 3.14

    frames = zstandard.ZstdCompressor().compress(b"ab") + (
        zstandard.ZstdCompressor(write_content_size=False).compress(b"cd")
    )
    assert decompress(frames) == b"abcd"
