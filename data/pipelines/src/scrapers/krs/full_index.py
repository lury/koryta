"""A free index of who sat where in the companies the site tracks.

rejestr.io sells two things the night buys: a company's people with their
history, and a person's posts across the register. For the ~12.7k companies
the site has a page for, both can be read for free off two official sources
the pipelines already use:

- api-krs's **OdpisPelny** JSON gives every board, supervisory-board and
  prokura seat a company ever had, with the entries that began and ended it
  and the day of every entry (measured 2026-11-26: 860 seats in 25 odpisy,
  all with an entry date, 73% with an end). It masks the people: an initial
  and a length, the PESEL's first digit.
- the odpis pełny **PDF** `jobs.krs_odpis` fetches names them in full, and
  `KrsOdpisSeats` keys each by a salted PESEL (`util.pesel.fingerprint`).

The JSON is the cheap one to keep current - 0.26 s against the PDF's 1.1 s
p99, an official API rather than the search page's back end, and no slowdown
after a thousand documents - so it is what the daily bulletin refreshes, and
the PDF is what lends it identities. A seat in both is matched on what the
masking keeps: the company, the role, the entry that began it, the surname's
and first name's signatures (`scrapers.krs.names`) and the PESEL's first
digit against the birth decade. A seat the JSON names that no PDF on file
does - somebody appointed since the last PDF - stays unidentified until the
next one, and `KrsIndexCompanies` says which companies owe one.

`jobs.krs_full_index` asks api-krs and appends every answer, verbatim, to
`READ_LOG` as write-once parts. This module is the pipeline half, and none of
it keeps anything between runs:

- `KrsFullOdpisLedger`: the newest answer about every company the log holds,
  which is what the job's queue is built from (`KrsIndexQueue`);
- `KrsFullOdpisSeats`: every seat of every company's newest odpis, masked;
- `KrsPositionsIndex`: those seats with the PDF's identities, plus the PDF's
  seats the JSON does not name, one row a seat;
- `KrsPersonPositions`: one row per PESEL fingerprint, every post across the
  indexed companies with its days;
- `KrsIndexCompanies`: per company, how much of the JSON the PDF identifies.

The paid job reads the last two to leave out what this already knows
(`jobs.krs_scrape_paid.plan.covered_by_index`). What it cannot replace is a
person's posts in companies *outside* the index: api-krs cannot be searched
by person, and the JSON's masking makes one company's people unjoinable to
another's without the PDF.
"""

import gzip
import json
import typing
from collections import defaultdict
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime

import pandas as pd
import zstandard

from scrapers.koryta.download import KorytaCompanies
from scrapers.krs.columns import normalise, padded_krs
from scrapers.krs.names import (
    censored_surname_signatures,
    plain_surname_signatures,
    signature,
)
from scrapers.krs.odpis_history import KrsOdpisSeats, assert_no_pesel
from scrapers.krs.odpis_people import POST_BY_ROLE
from scrapers.krs.organs import organ_kind
from scrapers.krs.register import (
    STATUS_FAILED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_STRUCK_OFF,
    KRSRegisterEntries,
)
from scrapers.krs.updates import KRSUpdates, latest_changes
from scrapers.stores import CloudStorage, Context, Pipeline

#: Bumped when a read's shape or what the fold makes of one changes, so a
#: reader can tell the parts written before from those after.
READ_VERSION = 1

#: Where `jobs.krs_full_index` writes what api-krs answered: zstd-compressed
#: jsonl parts, one `FullRead` a line, written once and never rewritten, under
#: `date=<Warsaw day>/<run>-<seq>.jsonl.zst`. Gzip parts are read too.
READ_LOG = CloudStorage(
    prefix="jobs/krs_full_index/reads/",
    bucket="koryta-pl-sharedcache",
    binary=True,
)

#: Where an answer came from: a request, or the job's disk cache, which a run
#: killed before its part was written leaves behind for the next one.
SOURCE_NETWORK = "network"
SOURCE_CACHE = "cache"

#: The roles the index keeps, as `odpis_pdf.ROLE_BY_RUBRYKA` names them, and
#: where an OdpisPelny keeps each: (dział 2 key, the key holding the people
#: inside each organ, or None for a bare list of people).
ROLE_PATHS: tuple[tuple[str, str, str | None], ...] = (
    ("reprezentacja", "reprezentacja", "sklad"),
    ("nadzor", "organNadzoru", "sklad"),
    ("prokurent", "prokurenci", None),
)
ROLES = tuple(role for role, _, _ in ROLE_PATHS)


@dataclass
class FullRead:
    """One question put to api-krs about one company's odpis pełny, as logged.

    The odpis is kept whole, so that a new field or a parser fix is a fold of
    the log and not another 27k requests. It holds nobody's name in full: the
    register masks them in the JSON it serves.
    """

    krs: str
    #: When the answer came, ISO, Warsaw time. Its day is what a later
    #: bulletin entry is compared with.
    read_at: str
    status: str
    rejestr: str | None = None
    #: "Stan z dnia" and the number of the newest entry, as the odpis has them:
    #: together, what the job's disk cache keys an answer by.
    stated_on: str | None = None
    last_entry: int | None = None
    body: dict | None = None
    error: str | None = None
    run: str | None = None
    source: str = SOURCE_NETWORK
    version: int = READ_VERSION

    def to_line(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @staticmethod
    def from_line(line: str) -> "FullRead":
        data = json.loads(line)
        return FullRead(
            **{k: v for k, v in data.items() if k in FullRead.__dataclass_fields__}
        )


def iso_day(value: typing.Any) -> str | None:
    """The register's "13.08.2026" as "2026-08-13"; None for anything else."""
    if not isinstance(value, str):
        return None
    parts = value.strip().split(".")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    day, month, year = parts
    return f"{year}-{month.zfill(2)}-{day.zfill(2)}"


def header(body: dict | None) -> dict:
    odpis = (body or {}).get("odpis") or {}
    return odpis.get("naglowekP") or odpis.get("naglowekA") or {}


def stated_on(body: dict | None) -> str | None:
    """The day the odpis speaks for."""
    return iso_day(header(body).get("stanZDnia"))


def entry_dates(body: dict | None) -> dict[str, str]:
    """Entry number -> the day the court made it, from the odpis's own list."""
    dates: dict[str, str] = {}
    for entry in header(body).get("wpis") or []:
        if not isinstance(entry, dict):
            continue
        number, day = entry.get("numerWpisu"), iso_day(entry.get("dataWpisu"))
        if number is not None and day:
            dates[str(number)] = day
    return dates


def last_entry(body: dict | None) -> int | None:
    """The number of the newest entry: what changes when the register writes."""
    head = header(body)
    if isinstance(head.get("numerOstatniegoWpisu"), int):
        return head["numerOstatniegoWpisu"]
    numbers = [
        e["numerWpisu"]
        for e in head.get("wpis") or []
        if isinstance(e, dict) and isinstance(e.get("numerWpisu"), int)
    ]
    return max(numbers) if numbers else None


@dataclass(frozen=True)
class FullSeat:
    """One seat an OdpisPelny names, as masked as api-krs serves it."""

    krs: str
    register: str
    stated_on: str | None
    role: str
    #: The organ as the register names it ("ZARZĄD", "RADA NADZORCZA"), and for
    #: a supervisory one which of `organs.ORGAN_KINDS` that is.
    organ_name: str | None
    organ: str | None
    #: Which organ of the role (0 for the first), and the seat's place in it,
    #: from 1, in the register's order.
    organ_index: int
    position: int
    #: The masked surname's components and given names: "K*****".
    surname_mask: tuple[str, ...]
    given_mask: str
    #: The PESEL's first digit, the one thing of it the mask leaves.
    pesel_digit: str | None
    is_company: bool
    #: The function or kind of proxy, newest version.
    funkcja: str | None
    #: The entries that brought in and struck out the surname's standing
    #: version - as `odpis_pdf.parse_people` dates a seat, so the two join.
    entry_added: str | None
    entry_removed: str | None
    date_added: str | None
    date_removed: str | None

    @property
    def current(self) -> bool:
        return self.entry_removed is None


def _versions(person: dict, key: str) -> list[dict]:
    values = person.get(key)
    return (
        [v for v in values if isinstance(v, dict)] if isinstance(values, list) else []
    )


def _effective(versions: list[dict]) -> dict | None:
    """The version still standing, else the last one: `FieldGroup.effective`."""
    for version in versions:
        if "nrWpisuWykr" not in version:
            return version
    return versions[-1] if versions else None


def _entry(version: dict | None, key: str) -> str | None:
    value = (version or {}).get(key)
    return str(value) if value not in (None, "") else None


def _organ_name(organ: dict, key: str) -> str | None:
    named = _effective(_versions(organ, key))
    value = (named or {}).get(key)
    return value if isinstance(value, str) and value else None


def _people_of(
    dzial2: dict, key: str, inner: str | None
) -> Iterator[tuple[int, dict, list[dict]]]:
    """(organ index, organ, its people) for one role's place in dział 2."""
    found = dzial2.get(key)
    if inner is None:
        if isinstance(found, list):
            yield 0, {}, [p for p in found if isinstance(p, dict)]
        return
    organs = (
        found if isinstance(found, list) else [found] if isinstance(found, dict) else []
    )
    for index, organ in enumerate(organs):
        if isinstance(organ, dict):
            people = organ.get(inner)
            yield index, organ, [p for p in people or [] if isinstance(p, dict)]


def parse_full(krs: str, rejestr: str, body: dict) -> list[FullSeat]:
    """Every board, supervisory-board and prokura seat of one OdpisPelny."""
    dzial2 = (((body.get("odpis") or {}).get("dane")) or {}).get("dzial2") or {}
    dates = entry_dates(body)
    stated = stated_on(body)
    seats: list[FullSeat] = []
    for role, key, inner in ROLE_PATHS:
        for organ_index, organ, people in _people_of(dzial2, key, inner):
            organ_name = _organ_name(organ, "nazwaOrganu") or _organ_name(
                organ, "nazwa"
            )
            for position, person in enumerate(people, 1):
                surnames = _versions(person, "nazwisko")
                names = _versions(person, "nazwa")
                standing = _effective(surnames) or _effective(names)
                if standing is None:
                    continue
                surname = standing.get("nazwisko") if surnames else None
                components = (
                    tuple(
                        str(surname[k])
                        for k in ("nazwiskoICzlon", "nazwiskoIICzlon")
                        if isinstance(surname, dict) and surname.get(k)
                    )
                    if surname
                    else ()
                )
                given = (_effective(_versions(person, "imiona")) or {}).get("imiona")
                pesel = (_effective(_versions(person, "identyfikator")) or {}).get(
                    "pesel"
                )
                detail_key = (
                    "rodzajProkury" if role == "prokurent" else "funkcjaWOrganie"
                )
                detail = (_effective(_versions(person, detail_key)) or {}).get(
                    detail_key
                )
                added = _entry(standing, "nrWpisuWprow")
                removed = _entry(standing, "nrWpisuWykr")
                seats.append(
                    FullSeat(
                        krs=krs,
                        register=rejestr,
                        stated_on=stated,
                        role=role,
                        organ_name=organ_name,
                        organ=organ_kind(organ_name)
                        if role == "nadzor" and organ_name
                        else None,
                        organ_index=organ_index,
                        position=position,
                        surname_mask=components,
                        given_mask=str((given or {}).get("imie") or "")
                        if isinstance(given, dict)
                        else "",
                        pesel_digit=(
                            pesel[0]
                            if isinstance(pesel, str) and pesel[:1].isdigit()
                            else None
                        ),
                        is_company=not surnames,
                        funkcja=detail if isinstance(detail, str) and detail else None,
                        entry_added=added,
                        entry_removed=removed,
                        date_added=dates.get(added or ""),
                        date_removed=dates.get(removed or ""),
                    )
                )
    return seats


# ------------------------------------------------------------------ the fold
#: How two answers about one company compare when they came at the same moment.
_TIE_RANK = {STATUS_OK: 0, STATUS_STRUCK_OFF: 1, STATUS_NOT_FOUND: 1, STATUS_FAILED: 2}


def _replaces(new: FullRead, held: FullRead) -> bool:
    """Any answer beats a failure; among answers the newest wins."""
    new_failed, held_failed = new.status == STATUS_FAILED, held.status == STATUS_FAILED
    if new_failed != held_failed:
        return held_failed
    new_at, held_at = (
        datetime.fromisoformat(new.read_at),
        datetime.fromisoformat(held.read_at),
    )
    if new_at != held_at:
        return new_at > held_at
    return _TIE_RANK.get(new.status, 3) < _TIE_RANK.get(held.status, 3)


def fold(reads: Iterable[FullRead]) -> dict[str, FullRead]:
    """The answer that stands for every company the log holds."""
    best: dict[str, FullRead] = {}
    for read in reads:
        held = best.get(read.krs)
        if held is None or _replaces(read, held):
            best[read.krs] = read
    return best


def decompress(name: str, raw: bytes) -> bytes:
    """A part's lines, zstd or gzip by its name."""
    if name.endswith(".zst"):
        return zstandard.ZstdDecompressor().decompressobj().decompress(raw)
    if name.endswith(".gz"):
        return gzip.decompress(raw)
    return raw


def read_log(ctx: Context, log: CloudStorage = READ_LOG) -> Iterator[FullRead]:
    """Every read in the log, part by part."""
    for ref in ctx.io.list_files(log):
        name = str(getattr(ref, "url", ref))
        raw = ctx.io.read_data(ref).read_bytes()
        # "\n" only: `splitlines` breaks at U+2028 too, which a body may hold.
        for line in decompress(name, raw).decode("utf-8").split("\n"):
            if line.strip():
                yield FullRead.from_line(line)


@dataclass
class LedgerEntry:
    """What api-krs last said about one company's odpis pełny."""

    krs: str
    #: The day it was read, which a later bulletin entry is compared with.
    swept: str
    read_at: str
    status: str
    rejestr: str | None
    stated_on: str | None
    last_entry: int | None
    seats: int


LEDGER_COLUMNS = list(LedgerEntry.__dataclass_fields__)


def ledger_of(best: Mapping[str, FullRead]) -> list[LedgerEntry]:
    entries = []
    for krs in sorted(best):
        read = best[krs]
        seats = (
            len(parse_full(krs, read.rejestr or "", read.body))
            if read.status == STATUS_OK and read.body
            else 0
        )
        entries.append(
            LedgerEntry(
                krs=krs,
                swept=read.read_at[:10],
                read_at=read.read_at,
                status=read.status,
                rejestr=read.rejestr,
                stated_on=read.stated_on,
                last_entry=read.last_entry,
                seats=seats,
            )
        )
    return entries


class KrsFullOdpisLedger(Pipeline[LedgerEntry]):
    """The newest answer about every company the index's log holds.

    A fold of `READ_LOG` and nothing else, so a run that needs tonight's reads
    names it in its refresh policy, as the register's ledger is named.
    """

    filename = "krs_full_odpis_ledger"
    dtype = {"krs": str, "swept": str, "read_at": str, "stated_on": str}

    @property
    def output_class(self):
        return LedgerEntry

    def process(self, ctx: Context) -> pd.DataFrame:
        entries = ledger_of(fold(read_log(ctx)))
        df = pd.DataFrame([asdict(e) for e in entries], columns=LEDGER_COLUMNS)
        counts = df["status"].value_counts().to_dict() if len(df) else {}
        print(f"Index log: {len(df)} companies {counts}")
        return df


SEAT_COLUMNS = [*FullSeat.__dataclass_fields__, "current"]


def seat_rows(best: Mapping[str, FullRead]) -> list[dict[str, typing.Any]]:
    rows = []
    for krs in sorted(best):
        read = best[krs]
        if read.status != STATUS_OK or not read.body:
            continue
        for seat in parse_full(krs, read.rejestr or "", read.body):
            row = asdict(seat)
            row["surname_mask"] = list(seat.surname_mask)
            row["current"] = seat.current
            rows.append(row)
    return rows


class KrsFullOdpisSeats(Pipeline[FullSeat]):
    """Every seat of every indexed company's newest odpis pełny, masked."""

    filename = "krs_full_odpis_seats"
    dtype = {
        c: str
        for c in (
            "krs",
            "register",
            "stated_on",
            "pesel_digit",
            "entry_added",
            "entry_removed",
            "date_added",
            "date_removed",
        )
    }

    @property
    def output_class(self):
        return FullSeat

    def process(self, ctx: Context) -> pd.DataFrame:
        rows = seat_rows(fold(read_log(ctx)))
        df = pd.DataFrame.from_records(rows, columns=SEAT_COLUMNS)
        print(
            f"Index seats: {len(df)} in "
            f"{df['krs'].nunique() if len(df) else 0} companies"
        )
        return df


# ------------------------------------------------------------------ the queue
@dataclass
class QueuedRead:
    """A company owed a read, why, and the register it is likeliest in."""

    krs: str
    reason: str
    rejestr: str | None = None
    #: The newest day the bulletin names the company, if it does.
    changed_on: str | None = None


#: The last read failed: asked again first.
REASON_FAILED = "failed"
#: The bulletin named the company on or after the day it was read.
REASON_CHANGED = "changed"
#: Tracked, never read: the backfill.
REASON_NEVER = "never"
#: What the daily mode reads; the rest is the backfill's.
DAILY_REASONS = frozenset({REASON_FAILED, REASON_CHANGED})


def queue_for_index(
    tracked: Iterable[str],
    ledger: pd.DataFrame,
    changed: Mapping[str, str],
    hints: Mapping[str, str] | None = None,
) -> list[QueuedRead]:
    """The tracked companies owed a read, in the order to read them.

    Failed reads first, then the companies the bulletin named on or after the
    day they were read - an entry made in the afternoon is invisible to a read
    that morning, so the same day counts - then those never read, lowest KRS
    first. That last order is the backfill's cursor: what the log holds is
    done, so a stopped backfill carries on from the lowest number it lacks.
    A company the bulletin has not named since its read is current, and its
    answer is never asked for again.
    """
    hints = dict(hints or {})
    wanted = sorted({str(k).zfill(10) for k in tracked if str(k).strip()}, key=int)
    if ledger is None or ledger.empty:
        ledger = pd.DataFrame(columns=LEDGER_COLUMNS)
    ledger = normalise(ledger, "swept")
    swept = dict(zip(ledger["krs"], ledger["swept"]))
    status = dict(zip(ledger["krs"], ledger["status"]))
    for krs, rejestr in zip(ledger["krs"], ledger["rejestr"]):
        if isinstance(rejestr, str) and rejestr:
            hints[krs] = rejestr
    failed, moved, never = [], [], []
    for krs in wanted:
        if krs not in swept:
            never.append(krs)
        elif status[krs] == STATUS_FAILED:
            failed.append(krs)
        elif (day := changed.get(krs)) and day >= swept[krs]:
            moved.append(krs)

    def queued(krs: str, reason: str) -> QueuedRead:
        return QueuedRead(krs, reason, hints.get(krs), changed.get(krs))

    return (
        [queued(k, REASON_FAILED) for k in failed]
        + [queued(k, REASON_CHANGED) for k in moved]
        + [queued(k, REASON_NEVER) for k in never]
    )


def register_hints(entries: pd.DataFrame | None) -> dict[str, str]:
    """KRS -> the register the register job found it in (`KRSRegisterEntries`)."""
    if entries is None or entries.empty or "rejestr" not in entries:
        return {}
    known = entries.dropna(subset=["rejestr"])
    return dict(zip(padded_krs(known["krs"]), known["rejestr"].astype(str)))


class KrsIndexQueue(Pipeline[QueuedRead]):
    """The tracked companies owed a read of their odpis pełny, in order.

    Tracked is what the site has a page for (`KorytaCompanies`). What
    `jobs.krs_full_index` works through: `--daily` the failed and changed,
    `--backfill N` that many never read.
    """

    filename = "krs_index_queue"
    dtype = {"krs": str, "rejestr": str, "changed_on": str}
    backup_to_shared_cache = False

    companies: KorytaCompanies
    updates: KRSUpdates
    ledger: KrsFullOdpisLedger
    register: KRSRegisterEntries

    @property
    def output_class(self):
        return QueuedRead

    def process(self, ctx: Context) -> pd.DataFrame:
        companies = self.companies.read_or_process(ctx)
        tracked = (
            []
            if companies is None or companies.empty
            else list(padded_krs(companies["krs"]))
        )
        queue = queue_for_index(
            tracked,
            self.ledger.read_or_process(ctx),
            latest_changes(self.updates.read_or_process(ctx)),
            register_hints(self.register.read_or_process(ctx)),
        )
        df = pd.DataFrame(
            [asdict(q) for q in queue],
            columns=["krs", "reason", "rejestr", "changed_on"],
        )
        counts = df["reason"].value_counts().to_dict() if len(df) else {}
        print(
            f"Tracked companies: {len(set(tracked))}; owed a read: {len(df)} {counts}"
        )
        return df


# ------------------------------------------------------------ the identities
SOURCE_BOTH = "json+pdf"
SOURCE_JSON = "json"
SOURCE_PDF = "pdf"


def _first_given(names: str) -> str:
    parts = str(names or "").split()
    return parts[0] if parts else ""


def _decade_digit(birth_date: typing.Any) -> str | None:
    """The PESEL's first digit as a birth date gives it: the year's tens."""
    text = str(birth_date or "")
    return text[2] if len(text) >= 4 and text[:4].isdigit() else None


def could_be(seat: Mapping[str, typing.Any], pdf: Mapping[str, typing.Any]) -> bool:
    """Whether a masked JSON seat and a PDF seat can be the same person."""
    if bool(seat.get("is_company")) or bool(pdf.get("is_company")):
        return False
    masks = tuple(seat.get("surname_mask") or ())
    wanted = censored_surname_signatures(masks)
    if not wanted or not (
        wanted & plain_surname_signatures(str(pdf.get("surname") or ""))
    ):
        return False
    given_mask = str(seat.get("given_mask") or "")
    given = _first_given(str(pdf.get("given_names") or ""))
    if given_mask and given and signature(given_mask) != signature(given):
        return False
    digit, decade = seat.get("pesel_digit"), _decade_digit(pdf.get("birth_date"))
    return not (isinstance(digit, str) and digit and decade and digit != decade)


@dataclass
class IndexedSeat:
    """One seat of the index: the JSON's, the PDF's, or both matched."""

    krs: str
    role: str
    #: `PeopleKRS`'s word for the post: what rejestr.io's feeds call it.
    post: str
    organ: str | None
    funkcja: str | None
    entry_added: str | None
    entry_removed: str | None
    date_added: str | None
    date_removed: str | None
    current: bool
    source: str
    #: The PDF's identity, None where no PDF on file names the seat.
    pesel_fingerprint: str | None
    full_name: str | None
    birth_date: str | None
    #: The day each source speaks for.
    json_stated_on: str | None
    pdf_stated_on: str | None
    #: The PDF has the seat standing and the newer JSON has it ended.
    ended_since_pdf: bool = False


INDEX_COLUMNS = list(IndexedSeat.__dataclass_fields__)


def _clean(value: typing.Any) -> typing.Any:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    return value


def _text(value: typing.Any) -> str | None:
    value = _clean(value)
    return str(value) if value not in (None, "") else None


def match_company(
    seats: Sequence[Mapping[str, typing.Any]], pdf: Sequence[Mapping[str, typing.Any]]
) -> list[IndexedSeat]:
    """One company's JSON seats lent the identities of its PDF seats.

    A JSON seat takes the one PDF seat of its role, beginning entry and
    signatures that is left; none, or two that cannot be told apart, leaves it
    unidentified rather than guessed. The newer source's end stands: a JSON
    read after the PDF knows who left since. A PDF seat no JSON seat took is
    kept as the PDF has it.
    """
    taken: set[int] = set()
    rows: list[IndexedSeat] = []
    by_key: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, row in enumerate(pdf):
        by_key[(str(row.get("role")), str(_text(row.get("entry_added"))))].append(index)
    for seat in seats:
        key = (str(seat["role"]), str(_text(seat.get("entry_added"))))
        candidates = [
            i for i in by_key.get(key, []) if i not in taken and could_be(seat, pdf[i])
        ]
        match = pdf[candidates[0]] if len(candidates) == 1 else None
        if match is not None:
            taken.add(candidates[0])
        json_on, pdf_on = (
            _text(seat.get("stated_on")),
            _text(match.get("stated_on")) if match else None,
        )
        json_newer = match is None or (json_on or "") >= (pdf_on or "")
        ended = match if match is not None and not json_newer else seat
        rows.append(
            IndexedSeat(
                krs=str(seat["krs"]),
                role=str(seat["role"]),
                post=POST_BY_ROLE[str(seat["role"])],
                organ=_text(seat.get("organ")),
                funkcja=_text(seat.get("funkcja")),
                entry_added=_text(seat.get("entry_added")),
                entry_removed=_text(ended.get("entry_removed")),
                date_added=_text(seat.get("date_added"))
                or (_text(match.get("date_added")) if match else None),
                date_removed=_text(ended.get("date_removed")),
                current=_text(ended.get("entry_removed")) is None,
                source=SOURCE_BOTH if match is not None else SOURCE_JSON,
                pesel_fingerprint=_text(match.get("pesel_fingerprint"))
                if match
                else None,
                full_name=_text(match.get("full_name")) if match else None,
                birth_date=_text(match.get("birth_date")) if match else None,
                json_stated_on=json_on,
                pdf_stated_on=pdf_on,
                ended_since_pdf=bool(
                    match is not None
                    and json_newer
                    and _text(seat.get("entry_removed"))
                    and not _text(match.get("entry_removed"))
                ),
            )
        )
    for index, row in enumerate(pdf):
        if index in taken or str(row.get("role")) not in POST_BY_ROLE:
            continue
        rows.append(
            IndexedSeat(
                krs=str(row["krs"]),
                role=str(row["role"]),
                post=POST_BY_ROLE[str(row["role"])],
                organ=_text(row.get("organ")),
                funkcja=_text(row.get("funkcja")),
                entry_added=_text(row.get("entry_added")),
                entry_removed=_text(row.get("entry_removed")),
                date_added=_text(row.get("date_added")),
                date_removed=_text(row.get("date_removed")),
                current=_text(row.get("entry_removed")) is None,
                source=SOURCE_PDF,
                pesel_fingerprint=_text(row.get("pesel_fingerprint")),
                full_name=_text(row.get("full_name")),
                birth_date=_text(row.get("birth_date")),
                json_stated_on=None,
                pdf_stated_on=_text(row.get("stated_on")),
            )
        )
    return rows


def index_seats(
    json_seats: pd.DataFrame, pdf_seats: pd.DataFrame | None
) -> list[IndexedSeat]:
    """`match_company` over every company the JSON index holds."""
    if json_seats is None or json_seats.empty:
        return []
    json_seats = normalise(json_seats)
    pdf_by_krs: dict[str, list[dict]] = defaultdict(list)
    if pdf_seats is not None and not pdf_seats.empty:
        pdf = normalise(pdf_seats)
        pdf = pdf[
            pdf["krs"].isin(set(json_seats["krs"])) & pdf["role"].isin(list(ROLES))
        ]
        for row in pdf.to_dict("records"):
            pdf_by_krs[str(row["krs"])].append(row)
    rows: list[IndexedSeat] = []
    for krs, group in json_seats.groupby("krs", sort=True):
        rows.extend(
            match_company(
                typing.cast(list[dict[str, typing.Any]], group.to_dict("records")),
                pdf_by_krs.get(str(krs), []),
            )
        )
    return rows


class KrsPositionsIndex(Pipeline[IndexedSeat]):
    """Every seat in the indexed companies, with the PDF's identity where it has one.

    Carries PESEL fingerprints, which no log line may print (`NEVER_SHOWN`).
    """

    filename = "krs_positions_index"
    dtype = {c: str for c in INDEX_COLUMNS if c not in ("current", "ended_since_pdf")}

    json_seats: KrsFullOdpisSeats
    pdf_seats: KrsOdpisSeats

    @property
    def output_class(self):
        return IndexedSeat

    def process(self, ctx: Context) -> pd.DataFrame:
        rows = index_seats(
            self.json_seats.read_or_process(ctx), self.pdf_seats.read_or_process(ctx)
        )
        df = pd.DataFrame([asdict(r) for r in rows], columns=INDEX_COLUMNS)
        assert_no_pesel(df)
        sources = df["source"].value_counts().to_dict() if len(df) else {}
        print(f"Index: {len(df)} seats {sources}")
        return df


# -------------------------------------------------------------- per company
@dataclass
class IndexCompany:
    """How much of one company's newest JSON the PDF on file identifies."""

    krs: str
    json_stated_on: str | None
    pdf_stated_on: str | None
    seats: int
    identified: int
    #: Seats only the JSON knows and seats whose end only the JSON knows.
    unidentified: int
    ended_since_pdf: int
    #: Whether the PDF on file already says everything the JSON does: every
    #: seat identified and no end it does not know. A rejestr.io company feed
    #: would add nothing then.
    told_by_the_pdf: bool
    #: Whether the PDF on file is behind: a new one names who it does not.
    needs_pdf: bool


def companies_of(index: pd.DataFrame) -> list[IndexCompany]:
    if index is None or index.empty:
        return []
    index = normalise(index)
    result = []
    for krs, group in index.groupby("krs", sort=True):
        json_rows = group[group["source"].isin([SOURCE_JSON, SOURCE_BOTH])]
        if json_rows.empty:
            continue
        identified = int((json_rows["source"] == SOURCE_BOTH).sum())
        unidentified = len(json_rows) - identified
        ended = int(json_rows["ended_since_pdf"].astype(bool).sum())
        pdf_on = [d for d in group["pdf_stated_on"].dropna() if d]
        result.append(
            IndexCompany(
                krs=str(krs),
                json_stated_on=_text(json_rows["json_stated_on"].dropna().max())
                if json_rows["json_stated_on"].notna().any()
                else None,
                pdf_stated_on=max(pdf_on) if pdf_on else None,
                seats=len(json_rows),
                identified=identified,
                unidentified=unidentified,
                ended_since_pdf=ended,
                told_by_the_pdf=unidentified == 0 and ended == 0,
                needs_pdf=unidentified > 0 or ended > 0,
            )
        )
    return result


class KrsIndexCompanies(Pipeline[IndexCompany]):
    """Per indexed company: what the PDF identifies, and whether it owes a new one."""

    filename = "krs_index_companies"
    dtype = {"krs": str, "json_stated_on": str, "pdf_stated_on": str}

    index: KrsPositionsIndex

    @property
    def output_class(self):
        return IndexCompany

    def process(self, ctx: Context) -> pd.DataFrame:
        rows = companies_of(self.index.read_or_process(ctx))
        df = pd.DataFrame(
            [asdict(r) for r in rows], columns=list(IndexCompany.__dataclass_fields__)
        )
        if len(df):
            print(
                f"Index companies: {len(df)}; told by the PDF "
                f"{int(df['told_by_the_pdf'].sum())}, "
                f"owe a new PDF {int(df['needs_pdf'].sum())}"
            )
        return df


# --------------------------------------------------------------- per person
@dataclass
class PersonPositions:
    """Everything the index knows one person held, across the tracked companies."""

    pesel_fingerprint: str
    full_name: str | None
    birth_date: str | None
    companies: int
    #: Distinct (company, post) pairs the person still holds, and those they
    #: held and no longer do: what rejestr.io's `aktualne` and `przeszle` count.
    current: int
    past: int
    #: Every seat, oldest first: krs, post, role, organ, funkcja, date_added,
    #: date_removed, current, source.
    positions: list[dict] = field(default_factory=list)


PERSON_COLUMNS = list(PersonPositions.__dataclass_fields__)


def people_of(index: pd.DataFrame) -> list[PersonPositions]:
    if index is None or index.empty:
        return []
    known = normalise(index).dropna(subset=["pesel_fingerprint"])
    known = known[known["pesel_fingerprint"] != ""]
    people = []
    for fingerprint, group in known.groupby("pesel_fingerprint", sort=True):
        records = sorted(
            group.to_dict("records"),
            key=lambda r: (
                _text(r.get("date_added")) or "",
                str(r["krs"]),
                str(r["post"]),
            ),
        )
        held: dict[tuple[str, str], bool] = {}
        for row in records:
            pair = (str(row["krs"]), str(row["post"]))
            held[pair] = held.get(pair, False) or bool(row["current"])
        names = [n for n in (_text(r.get("full_name")) for r in records) if n]
        births = [b for b in (_text(r.get("birth_date")) for r in records) if b]
        people.append(
            PersonPositions(
                pesel_fingerprint=str(fingerprint),
                full_name=names[-1] if names else None,
                birth_date=births[-1] if births else None,
                companies=len({krs for krs, _ in held}),
                current=sum(1 for now in held.values() if now),
                past=sum(1 for now in held.values() if not now),
                positions=[
                    {
                        k: _clean(r.get(k))
                        for k in (
                            "krs",
                            "post",
                            "role",
                            "organ",
                            "funkcja",
                            "date_added",
                            "date_removed",
                            "current",
                            "source",
                        )
                    }
                    for r in records
                ],
            )
        )
    return people


class KrsPersonPositions(Pipeline[PersonPositions]):
    """One row per PESEL fingerprint: every post the index knows, with its days.

    The free counterpart of a rejestr.io person feed, within the tracked
    companies. Carries fingerprints (`NEVER_SHOWN`).
    """

    filename = "krs_person_positions"
    dtype = {"pesel_fingerprint": str, "full_name": str, "birth_date": str}

    index: KrsPositionsIndex

    @property
    def output_class(self):
        return PersonPositions

    def process(self, ctx: Context) -> pd.DataFrame:
        people = people_of(self.index.read_or_process(ctx))
        df = pd.DataFrame([asdict(p) for p in people], columns=PERSON_COLUMNS)
        print(f"Index people: {len(df)} fingerprints")
        return df


# ----------------------------------------------------- what the paid job reads
@dataclass(frozen=True)
class IndexCount:
    """What the index counts for one rejestr.io person."""

    current: int
    past: int


def counts_by_rejestrio_id(
    people: pd.DataFrame | None, positions: pd.DataFrame | None
) -> dict[str, IndexCount]:
    """rejestr.io person id -> the index's count of their posts.

    The id comes from `PeopleKRSCombined`, whose rows carry both the id and the
    fingerprint it was matched to. An id matched to two fingerprints names
    nobody the index can count for, and is left out.
    """
    if people is None or people.empty or positions is None or positions.empty:
        return {}
    if not {"id", "pesel_fingerprint"} <= set(people.columns):
        return {}
    pairs = people.dropna(subset=["id", "pesel_fingerprint"])[
        ["id", "pesel_fingerprint"]
    ]
    pairs = pairs[(pairs["pesel_fingerprint"] != "") & (pairs["id"].astype(str) != "")]
    fingerprints = pairs.groupby(pairs["id"].astype(str))["pesel_fingerprint"].agg(set)
    counted = {
        str(row["pesel_fingerprint"]): IndexCount(int(row["current"]), int(row["past"]))
        for row in positions.to_dict("records")
    }
    result = {}
    for rejestrio_id, found in fingerprints.items():
        if len(found) == 1 and (count := counted.get(next(iter(found)))) is not None:
            result[str(rejestrio_id)] = count
    return result


def told_by_the_pdf(companies: pd.DataFrame | None) -> set[str]:
    """The companies whose PDF on file says everything their newest JSON does."""
    if companies is None or companies.empty:
        return set()
    told = companies[companies["told_by_the_pdf"].astype(bool)]
    return set(padded_krs(told["krs"]))


def owe_a_pdf(companies: pd.DataFrame | None) -> list[str]:
    """The companies whose newest JSON names somebody the PDF on file does not."""
    if companies is None or companies.empty:
        return []
    return sorted(padded_krs(companies[companies["needs_pdf"].astype(bool)]["krs"]))
