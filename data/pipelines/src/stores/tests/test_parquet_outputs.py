"""Pipeline outputs in Parquet, and the JSONL ones written before the switch."""

import io
import os
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

import pandas as pd
import pytest

from scrapers.stores import Context, DataRef, LocalFile, Pipeline, ProcessPolicy
from scrapers.stores.file import VersionedBackup
from stores.file import FromBytesIO, FromPath, read_parquet_frame


class Candidacies(Pipeline):
    filename = "candidacies"
    format = "parquet"

    def process(self, ctx: Context):
        return pd.DataFrame({"year": ["2024"]})


FRAME = pd.DataFrame(
    {
        "election_year": ["2018", "2024", None],
        "teryt": ["020301", None, "1465011"],
        "birth_year": [1974.0, None, 1990.0],
        "elections": [
            [{"party": "PiS", "teryt": ["02", "0203"]}],
            [],
            [{"party": None, "teryt": []}],
        ],
    }
)


class Disk:
    """The parts of `IO` a pipeline's output goes through, on a real disk."""

    def __init__(self, root: Path):
        self.root = root
        self.backups: dict[str, bytes] = {}
        self.restored: list[tuple[str, str]] = []

    def path(self, ref: LocalFile) -> Path:
        return self.root / ref.folder / ref.filename

    def read_data(self, ref: DataRef):
        if isinstance(ref, VersionedBackup):
            if ref.filename not in self.backups:
                raise FileNotFoundError(ref.filename)
            return FromBytesIO(io.BytesIO(self.backups[ref.filename]), ref.filename)
        assert isinstance(ref, LocalFile)
        if not self.path(ref).exists():
            raise FileNotFoundError(str(self.path(ref)))
        return FromPath(self.path(ref))

    def write_file(self, ref: DataRef, writer: Any) -> None:
        buffer = io.BytesIO()
        writer(buffer)
        if isinstance(ref, VersionedBackup):
            self.backups[ref.filename] = buffer.getvalue()
            return
        assert isinstance(ref, LocalFile)
        self.path(ref).parent.mkdir(parents=True, exist_ok=True)
        self.path(ref).write_bytes(buffer.getvalue())

    def get_mtime(self, ref: LocalFile) -> float | None:
        path = self.path(ref)
        return path.stat().st_mtime if path.exists() else None

    def restore_backup_to_path(self, filename: str, dest_path: str) -> None:
        if filename not in self.backups:
            raise FileNotFoundError(filename)
        self.restored.append((filename, dest_path))
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        Path(dest_path).write_bytes(self.backups[filename])


@pytest.fixture
def disk(tmp_path, monkeypatch):
    monkeypatch.setattr("scrapers.stores.VERSIONED_DIR", str(tmp_path / "versioned"))
    monkeypatch.setattr("scrapers.stores.backup_disabled", lambda: False)
    return Disk(tmp_path)


@pytest.fixture
def ctx(disk):
    ctx = Mock(spec=Context)
    ctx.io = disk
    ctx.refresh_policy = ProcessPolicy.with_default()
    return ctx


def jsonl(df: pd.DataFrame) -> bytes:
    out = io.BytesIO()
    df.to_json(out, orient="records", lines=True)
    return out.getvalue()


def test_a_parquet_output_reads_back_as_written_with_lists_as_lists(ctx, disk):
    Candidacies().write_dataframe(ctx, FRAME, local_only=True)

    path = disk.root / "versioned" / "candidacies" / "candidacies.parquet"
    assert path.read_bytes()[:4] == b"PAR1"
    back = Candidacies().read(ctx)

    # Strings stay strings, zeros and all; missing is missing, as in the frame.
    assert back["election_year"].tolist()[:2] == ["2018", "2024"]
    assert back["teryt"].tolist()[::2] == ["020301", "1465011"]
    assert back[["election_year", "teryt"]].isna().sum().tolist() == [1, 1]
    assert back["birth_year"].isna().tolist() == [False, True, False]
    # As `read_json` gives them, not as numpy arrays.
    assert back["elections"].tolist() == FRAME["elections"].tolist()
    assert isinstance(back["elections"][1], list)


def test_parquet_goes_to_the_shared_cache_under_a_name_of_its_own(ctx, disk):
    Candidacies().write_dataframe(ctx, FRAME)

    # The bare name is what a checkout from before the switch reads as JSONL.
    assert list(disk.backups) == ["candidacies.parquet"]
    back = read_parquet_frame(io.BytesIO(disk.backups["candidacies.parquet"]))
    assert len(back) == 3


def test_the_jsonl_written_before_the_switch_is_read_while_no_parquet_is(ctx, disk):
    legacy = disk.root / "versioned" / "candidacies" / "candidacies.jsonl"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(jsonl(pd.DataFrame({"year": [2018, 2024]})))

    pipeline = Candidacies()
    assert pipeline.output_time(ctx) == legacy.stat().st_mtime
    # Up to date, not "missing output": the night after the switch reads it.
    with patch.object(pipeline, "process") as process:
        df = pipeline.read_or_process(ctx)
    process.assert_not_called()
    assert df["year"].tolist() == [2018, 2024]


def test_writing_parquet_takes_the_jsonl_it_replaces_away(ctx, disk):
    legacy = disk.root / "versioned" / "candidacies" / "candidacies.jsonl"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(jsonl(pd.DataFrame({"year": [2018]})))

    Candidacies().write_dataframe(ctx, FRAME, local_only=True)

    assert not legacy.exists()
    assert (legacy.parent / "candidacies.parquet").exists()


def test_a_jsonl_backup_is_restored_when_there_is_no_parquet_one(ctx, disk):
    disk.backups["candidacies"] = jsonl(pd.DataFrame({"year": [2018]}))

    df = Candidacies().read(ctx)

    assert df["year"].tolist() == [2018]
    assert [name for name, _ in disk.restored] == ["candidacies"]
    assert disk.restored[0][1].endswith("candidacies/candidacies.jsonl")


def test_the_parquet_backup_wins_over_the_jsonl_one(ctx, disk):
    disk.backups["candidacies"] = jsonl(pd.DataFrame({"year": [2018]}))
    Candidacies().write_dataframe(ctx, pd.DataFrame({"year": ["2024"]}))
    (disk.root / "versioned" / "candidacies" / "candidacies.parquet").unlink()

    df = Candidacies().read(ctx)

    assert df["year"].tolist() == ["2024"]
    assert [name for name, _ in disk.restored] == ["candidacies.parquet"]


def test_a_missing_output_restored_from_a_jsonl_backup_is_saved_as_parquet(ctx, disk):
    disk.backups["candidacies"] = jsonl(pd.DataFrame({"year": [2018]}))
    pipeline = Candidacies()

    with patch.object(pipeline, "process") as process:
        df = pipeline.read_or_process(ctx)

    process.assert_not_called()
    assert df["year"].tolist() == [2018]
    saved = disk.root / "versioned" / "candidacies" / "candidacies.parquet"
    assert read_parquet_frame(str(saved))["year"].tolist() == [2018]


def test_a_jsonl_pipeline_reads_and_backs_up_as_before(ctx, disk):
    class Plain(Pipeline):
        filename = "plain"

        def process(self, ctx: Context):
            return pd.DataFrame()

    Plain().write_dataframe(ctx, pd.DataFrame({"a": [1]}))

    assert list(disk.backups) == ["plain"]
    assert (disk.root / "versioned" / "plain" / "plain.jsonl").exists()
    assert Plain().stored_formats() == ["jsonl"]
