"""PKW's candidate lists into Postgres staging, `pkw_raw`, a file at a time.

Each list is read the way PeoplePKW reads it - the same `scrapers.pkw.sources`
entry, the same extractor - and written with COPY. A list whose downloaded
file has the sha256 and the reader it was loaded with is left as it is: PKW's
files change after an election, not between nights. What the columns mean
(`pkw_raw.header_rule`) and the lookups the rules make are code, and are
rewritten every time.
"""

import dataclasses
import hashlib
import json
import math
import time
import typing
import uuid
from collections.abc import Iterable, Iterator

import psycopg

from scrapers.map.teryt import Teryt
from scrapers.pkw import headers as pkw_headers
from scrapers.pkw.elections import ElectionType
from scrapers.pkw.okregi import voting_district_to_city
from scrapers.pkw.sources import (
    Extractor,
    InputSource,
    XlsExtractor,
    ZipExtractor,
    sources,
)
from scrapers.stores import Context

SQL_FILES = ("01_pkw_raw.sql", "02_pkw_candidacy.sql")

#: The processors `SetField` can carry, by the name the SQL knows them by.
NAMED_RULES: dict[typing.Callable, str] = {
    pkw_headers.parse_sex: "sex",
    pkw_headers.parse_yes_no: "yes_no",
    pkw_headers.parse_mandate: "mandate",
    pkw_headers.parse_runoff_mandate: "runoff_mandate",
}
TERYT_RULES: dict[typing.Callable, str] = {
    pkw_headers.lookup_teryt: "district_teryt",
    pkw_headers.lookup_teryt_from_city: "city_teryt",
}
IDENTITY = pkw_headers.SetField.__dataclass_fields__["processor"].default


@dataclasses.dataclass(frozen=True)
class List:
    """One list to load: a source's first round, or its run-off."""

    key: str
    config: InputSource
    runoff: bool

    @property
    def file(self):
        if self.runoff:
            assert self.config.runoff is not None
            return self.config.runoff.source
        return self.config.source

    @property
    def extractor(self) -> Extractor:
        if self.runoff:
            assert self.config.runoff is not None
            return self.config.runoff.extractor
        return self.config.extractor


def describe(extractor: Extractor) -> str:
    """The extractor as the parameters that decide what it reads."""
    if isinstance(extractor, ZipExtractor):
        inner = describe(extractor.extractor)
        return f"zip({extractor.inner_filename!r}, {extractor.index!r}, {inner})"
    if isinstance(extractor, XlsExtractor):
        return f"xls({extractor.header_rows}, {extractor.skip_rows})"
    return type(extractor).__name__


def list_key(config: InputSource, runoff: bool) -> str:
    file = config.runoff.source if (runoff and config.runoff) else config.source
    extractor = (
        config.runoff.extractor if (runoff and config.runoff) else config.extractor
    )
    key = file.filename
    if isinstance(extractor, ZipExtractor):
        key += f"::{extractor.inner_filename or extractor.index}"
    return key


def lists() -> list[List]:
    found = []
    for config in sources:
        found.append(List(list_key(config, False), config, False))
        if config.runoff is not None:
            found.append(List(list_key(config, True), config, True))
    keys = [found.key for found in found]
    assert len(keys) == len(set(keys)), "two lists read the same file the same way"
    return found


def rule_of(field: pkw_headers.SetField | None) -> tuple[str | None, str | None]:
    """The SQL rule for a column's processor, and its argument.

    Raises on a processor the SQL has no port of, rather than load a list
    `pkw.candidacy` would read wrong.
    """
    if field is None:
        return None, None
    processor = field.processor
    if processor is IDENTITY:
        return "identity", None
    if processor in NAMED_RULES:
        return NAMED_RULES[processor], None
    for cell in processor.__closure__ or ():
        value = cell.cell_contents
        if isinstance(value, str):
            return "const", value
        if callable(value) and value in TERYT_RULES:
            return TERYT_RULES[value], None
    raise ValueError(f"no SQL rule for {field.name}'s processor {processor!r}")


def cell(value: typing.Any) -> typing.Any:
    """A cell as JSON can hold it: NaN as null, numpy scalars as Python's."""
    if value is None:
        return None
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        value = value.item()
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def read_list(ctx: Context, found: List) -> tuple[list[str], Iterator[dict]]:
    """The list's header, as `process_csv` settles it, and its rows."""
    reader = iter(found.extractor.read(ctx, found.file))
    header = [
        "" if (h != h or (isinstance(h, float) and math.isnan(h))) else h
        for h in next(reader)
    ]

    def rows() -> Iterator[dict]:
        for row in reader:
            yield {h: cell(v) for h, v in zip(header, row)}

    return header, rows()


def header_rules(found: List, header: list[str]) -> list[tuple]:
    rules = {**pkw_headers.CSV_HEADERS, **found.config.headers}
    out = []
    for ordinal, name in enumerate(header, 1):
        field = rules[name]
        rule, arg = rule_of(field)
        out.append((found.key, ordinal, name, field.name if field else None, rule, arg))
    return out


def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def district_teryts(teryt: Teryt) -> Iterable[tuple[str, str, str, str]]:
    """Every okręg `lookup_teryt` resolves, for every election a list has."""
    seen = set()
    for config in sources:
        if config.election_type == ElectionType.SAMORZADOWE or config.year < 2000:
            continue
        year = 2007 if config.year in (2001, 2005) else config.year
        mapping = voting_district_to_city.get((year, config.election_type))
        if mapping is None or (config.year, config.election_type) in seen:
            continue
        seen.add((config.year, config.election_type))
        context = pkw_headers.ElectionContext(config.year, config.election_type)
        for district in mapping:
            code = pkw_headers.lookup_teryt(teryt, str(district), context)
            yield (str(config.year), str(config.election_type), str(district), code)


def apply_schema(conn: psycopg.Connection) -> None:
    from importlib import resources  # noqa: PLC0415

    for name in SQL_FILES:
        text = resources.files("jobs.pkw_postgres").joinpath("sql", name).read_text()
        conn.execute(text)  # type: ignore[call-overload]
    conn.commit()


def load_lookups(conn: psycopg.Connection, teryt: Teryt) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "TRUNCATE pkw_raw.district_teryt, pkw_raw.city_teryt, pkw_raw.gmina_kind"
        )
        with cur.copy("COPY pkw_raw.district_teryt FROM STDIN") as copy:
            for row in district_teryts(teryt):
                copy.write_row(row)
        with cur.copy("COPY pkw_raw.city_teryt FROM STDIN") as copy:
            for city, code in teryt.cities_to_teryt.items():
                copy.write_row((city, code))
        with cur.copy("COPY pkw_raw.gmina_kind FROM STDIN") as copy:
            for code, kind in teryt.gmina_kinds.items():
                copy.write_row((code, kind))
    conn.commit()


def load_list(
    conn: psycopg.Connection, ctx: Context, found: List, ordinal: int, run: str
) -> tuple[str, int]:
    """Load one list unless it is already there as it would be; what was done."""
    path = ctx.io.read_data(found.file).path
    sha = sha256_of(path)
    reader = describe(found.extractor)
    started = time.perf_counter()
    stored = conn.execute(
        "SELECT sha256, reader, rows, headers FROM pkw_raw.source WHERE source = %s",
        (found.key,),
    ).fetchone()
    unchanged = stored is not None and stored[:2] == (sha, reader)
    rows: Iterator[dict]
    if unchanged:
        assert stored is not None
        header, rows = list(stored[3]), iter(())
    else:
        header, rows = read_list(ctx, found)
    rules = header_rules(found, header)
    parent = list_key(found.config, False) if found.runoff else None
    config = found.config
    meta = (
        ordinal,
        parent,
        str(config.year),
        str(config.election_type),
        config.name_format.name,
        found.file.url,
    )
    with conn.cursor() as cur:
        if unchanged:
            assert stored is not None
            action, count = "unchanged", stored[2]
            cur.execute(
                "UPDATE pkw_raw.source SET ordinal = %s, runoff_of = %s, "
                "election_year = %s, election_type = %s, name_format = %s, url = %s "
                "WHERE source = %s",
                (*meta, found.key),
            )
        else:
            action = "loaded"
            cur.execute("DELETE FROM pkw_raw.source WHERE source = %s", (found.key,))
            cur.execute(
                "INSERT INTO pkw_raw.source (ordinal, runoff_of, election_year, "
                "election_type, name_format, url, source, sha256, reader, headers, "
                "rows) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0)",
                (*meta, found.key, sha, reader, header),
            )
            count = 0
            with cur.copy("COPY pkw_raw.row (source, row_no, data) FROM STDIN") as copy:
                for count, row in enumerate(rows, 1):
                    copy.write_row(
                        (found.key, count, json.dumps(row, ensure_ascii=False))
                    )
            cur.execute(
                "UPDATE pkw_raw.source SET rows = %s WHERE source = %s",
                (count, found.key),
            )
        cur.execute("DELETE FROM pkw_raw.header_rule WHERE source = %s", (found.key,))
        cur.executemany(
            "INSERT INTO pkw_raw.header_rule VALUES (%s, %s, %s, %s, %s, %s)", rules
        )
        cur.execute(
            "INSERT INTO pkw_raw.load_log (run, source, sha256, action, rows, seconds) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (
                run,
                found.key,
                sha,
                action,
                count,
                round(time.perf_counter() - started, 3),
            ),
        )
    conn.commit()
    return action, count


def load(conn: psycopg.Connection, ctx: Context, teryt: Teryt) -> dict[str, int]:
    """Load every list; how many were loaded and how many left unchanged."""
    run = str(uuid.uuid4())
    apply_schema(conn)
    load_lookups(conn, teryt)
    done = {"loaded": 0, "unchanged": 0}
    # Run-offs reference their first round, which comes first in `lists`.
    for ordinal, found in enumerate(lists()):
        try:
            action, count = load_list(conn, ctx, found, ordinal, run)
        except Exception as e:
            conn.rollback()
            conn.execute(
                "INSERT INTO pkw_raw.load_log (run, source, action, detail) "
                "VALUES (%s, %s, 'failed', %s)",
                (run, found.key, repr(e)[:2000]),
            )
            conn.commit()
            raise
        done[action] += 1
        print(f"{found.key}: {action}, {count} rows", flush=True)
    return done
