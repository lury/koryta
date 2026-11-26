"""The free KRS index: odpisy pełne read, folded, queued and lent identities.

The odpisy are api-krs's own answers, recorded on 2026-11-26
(`fixtures/odpis_pelny`); the PDF seats are made up to match their masks.
"""

import gzip
import json
from pathlib import Path

import pandas as pd
import zstandard

from scrapers.krs.full_index import (
    READ_LOG,
    REASON_CHANGED,
    REASON_FAILED,
    REASON_NEVER,
    SOURCE_BOTH,
    SOURCE_JSON,
    SOURCE_PDF,
    FullRead,
    KrsFullOdpisLedger,
    companies_of,
    counts_by_rejestrio_id,
    fold,
    index_seats,
    last_entry,
    ledger_of,
    match_company,
    owe_a_pdf,
    parse_full,
    people_of,
    queue_for_index,
    seat_rows,
    stated_on,
    told_by_the_pdf,
)
from scrapers.krs.register import STATUS_FAILED, STATUS_OK, STATUS_STRUCK_OFF

FIXTURES = Path(__file__).parent / "fixtures" / "odpis_pelny"
KOB_BUS = "0001273959"
BIG = "0000037863"


def body(name: str) -> dict:
    raw = (FIXTURES / f"{name}.json.zst").read_bytes()
    return json.loads(zstandard.ZstdDecompressor().decompressobj().decompress(raw))


def read(
    krs=KOB_BUS,
    at="2026-11-26T19:43:00+01:00",
    status=STATUS_OK,
    rejestr="P",
    data=None,
):
    data = (
        data
        if data is not None
        else (body(f"{krs}-{rejestr}") if status == STATUS_OK else None)
    )
    return FullRead(
        krs=krs,
        read_at=at,
        status=status,
        rejestr=rejestr,
        stated_on=stated_on(data),
        last_entry=last_entry(data),
        body=data,
    )


# ---------------------------------------------------------------- parsing
def test_every_board_supervisory_and_proxy_seat_is_read_with_its_days():
    seats = parse_full(BIG, "P", body(f"{BIG}-P"))

    roles = {
        role: sum(1 for s in seats if s.role == role)
        for role in ("reprezentacja", "nadzor", "prokurent")
    }
    assert all(roles.values()), roles
    # Every seat is dated where it began, every end where it ended.
    assert all(s.date_added for s in seats)
    assert all(s.date_removed for s in seats if s.entry_removed)
    assert stated_on(body(f"{BIG}-P")) == "2026-07-01"
    assert last_entry(body(f"{BIG}-P")) == 74


def test_a_seat_keeps_the_newest_function_and_the_mask_of_its_name():
    seats = parse_full(BIG, "P", body(f"{BIG}-P"))
    # P****** joined as WICEDYREKTOR in entry 23, DYREKTOR since entry 25.
    second = next(s for s in seats if s.role == "reprezentacja" and s.position == 2)

    assert second.surname_mask == ("P******",)
    assert second.given_mask == "P****"
    assert second.pesel_digit == "7"
    assert second.funkcja == "DYREKTOR ZARZĄDU"
    assert (second.entry_added, second.entry_removed) == ("23", None)
    assert second.current


def test_a_proxy_reads_its_kind_as_its_function():
    seats = [s for s in parse_full(BIG, "P", body(f"{BIG}-P")) if s.role == "prokurent"]

    assert seats and all(
        "ODDZIELNA" in s.funkcja or "ŁĄCZNA" in s.funkcja for s in seats if s.funkcja
    )
    assert all(s.funkcja for s in seats)


def test_an_spzoz_has_none_of_the_three_roles():
    assert parse_full("0000163560", "S", body("0000163560-S")) == []


# ------------------------------------------------------------------- fold
def test_an_answer_beats_a_later_failure_and_a_newer_answer_beats_it():
    old = read(at="2026-11-20T10:00:00+01:00")
    failed = read(at="2026-11-25T10:00:00+01:00", status=STATUS_FAILED, data={})
    struck = read(at="2026-11-26T10:00:00+01:00", status=STATUS_STRUCK_OFF, data={})

    assert fold([old, failed])[KOB_BUS] is old
    assert fold([failed, old, struck])[KOB_BUS] is struck


def test_the_ledger_and_the_seats_come_from_each_companys_newest_answer():
    best = fold([read(), read(BIG)])

    ledger = ledger_of(best)
    rows = seat_rows(best)

    assert [(e.krs, e.status, e.swept, e.seats) for e in ledger] == [
        (BIG, STATUS_OK, "2026-11-26", len(parse_full(BIG, "P", body(f"{BIG}-P")))),
        (KOB_BUS, STATUS_OK, "2026-11-26", 4),
    ]
    assert {r["krs"] for r in rows} == {BIG, KOB_BUS}


class LogIO:
    """A shared cache holding log parts, one zstd and one gzip."""

    def __init__(self, parts: dict[str, list[FullRead]]):
        self.parts = {}
        for name, reads in parts.items():
            lines = "".join(r.to_line() + "\n" for r in reads).encode()
            self.parts[name] = (
                zstandard.ZstdCompressor().compress(lines)
                if name.endswith(".zst")
                else gzip.compress(lines)
            )
        self.asked: list = []

    def list_files(self, path):
        self.asked.append(path)
        yield from self.parts

    def read_data(self, name):
        data = self.parts[name]

        class Part:
            def read_bytes(self):
                return data

        return Part()


def test_the_ledger_folds_zstd_and_gzip_parts_alike():
    io = LogIO(
        {
            "a.jsonl.zst": [read(at="2026-11-20T10:00:00+01:00")],
            "b.jsonl.gz": [
                read(BIG),
                read(at="2026-11-26T10:00:00+01:00", status=STATUS_STRUCK_OFF, data={}),
            ],
        }
    )

    class Ctx:
        pass

    ctx = Ctx()
    ctx.io = io  # type: ignore[attr-defined]

    df = KrsFullOdpisLedger().process(ctx)  # type: ignore[arg-type]

    assert io.asked == [READ_LOG]
    assert dict(zip(df["krs"], df["status"])) == {
        BIG: STATUS_OK,
        KOB_BUS: STATUS_STRUCK_OFF,
    }


# ------------------------------------------------------------------ queue
def ledger(*rows):
    return pd.DataFrame(
        [{"krs": k, "swept": d, "status": s, "rejestr": "P"} for k, d, s in rows],
        columns=["krs", "swept", "status", "rejestr"],
    )


def test_the_queue_is_failures_then_the_bulletins_changes_then_the_backfill():
    tracked = ["5", "4", "3", "2", "1"]
    held = ledger(
        ("0000000001", "2026-11-20", STATUS_OK),
        ("0000000002", "2026-11-20", STATUS_OK),
        ("0000000003", "2026-11-20", STATUS_FAILED),
        ("0000000004", "2026-11-25", STATUS_OK),
    )
    # 1 changed after its read, 2 not since; 4 the very day it was read,
    # which a read that morning cannot have seen.
    changed = {
        "0000000001": "2026-11-24",
        "0000000002": "2026-11-19",
        "0000000004": "2026-11-25",
    }

    queue = queue_for_index(tracked, held, changed, hints={"0000000005": "S"})

    assert [(q.krs, q.reason) for q in queue] == [
        ("0000000003", REASON_FAILED),
        ("0000000001", REASON_CHANGED),
        ("0000000004", REASON_CHANGED),
        ("0000000005", REASON_NEVER),
    ]
    assert queue[1].changed_on == "2026-11-24"
    assert (queue[1].rejestr, queue[-1].rejestr) == ("P", "S")


def test_the_backfill_carries_on_from_the_lowest_number_the_log_lacks():
    tracked = [f"{n:010d}" for n in (30, 10, 20)]

    first = queue_for_index(tracked, ledger(), {})
    after = queue_for_index(
        tracked, ledger(("0000000010", "2026-11-26", STATUS_OK)), {}
    )

    assert [q.krs for q in first] == ["0000000010", "0000000020", "0000000030"]
    assert [q.krs for q in after] == ["0000000020", "0000000030"]


# ------------------------------------------------------------- identities
def json_seat(**kw):
    seat = {
        "krs": KOB_BUS,
        "register": "P",
        "stated_on": "2026-11-06",
        "role": "reprezentacja",
        "organ": None,
        "funkcja": "PREZES ZARZĄDU",
        "surname_mask": ["K*******"],
        "given_mask": "J**",
        "pesel_digit": "7",
        "is_company": False,
        "entry_added": "1",
        "entry_removed": None,
        "date_added": "2026-11-06",
        "date_removed": None,
    }
    seat.update(kw)
    return seat


def pdf_seat(**kw):
    seat = {
        "krs": KOB_BUS,
        "role": "reprezentacja",
        "stated_on": "2026-11-06",
        "surname": "KOWALSKI",
        "given_names": "JAN PIOTR",
        "birth_date": "1975-03-02",
        "pesel_fingerprint": "f" * 32,
        "full_name": "JAN PIOTR KOWALSKI",
        "organ": None,
        "funkcja": "PREZES ZARZĄDU",
        "is_company": False,
        "entry_added": "1",
        "entry_removed": None,
        "date_added": "2026-11-06",
        "date_removed": None,
    }
    seat.update(kw)
    return seat


def test_a_json_seat_takes_the_identity_of_the_pdf_seat_its_mask_fits():
    [row] = match_company([json_seat()], [pdf_seat()])

    assert (row.source, row.pesel_fingerprint, row.full_name) == (
        SOURCE_BOTH,
        "f" * 32,
        "JAN PIOTR KOWALSKI",
    )
    assert row.post and row.current


def test_a_mask_the_pdf_does_not_fit_stays_unidentified():
    # A different length, a different decade, a different first name.
    for seat in (
        json_seat(surname_mask=["K****"]),
        json_seat(pesel_digit="5"),
        json_seat(given_mask="A**"),
    ):
        rows = match_company([seat], [pdf_seat()])
        assert [r.source for r in rows] == [SOURCE_JSON, SOURCE_PDF]


def test_two_pdf_seats_the_mask_fits_alike_are_not_guessed_between():
    twins = [pdf_seat(), pdf_seat(pesel_fingerprint="e" * 32, given_names="JAN ADAM")]

    rows = match_company([json_seat()], twins)

    assert rows[0].source == SOURCE_JSON and rows[0].pesel_fingerprint is None


def test_a_newer_json_ends_a_seat_the_older_pdf_has_standing():
    later = json_seat(
        stated_on="2026-11-20", entry_removed="5", date_removed="2026-11-20"
    )
    newcomer = json_seat(
        surname_mask=["N****"],
        given_mask="A***",
        entry_added="5",
        date_added="2026-11-20",
        stated_on="2026-11-20",
    )

    rows = match_company([later, newcomer], [pdf_seat()])
    [company] = companies_of(pd.DataFrame([r.__dict__ for r in rows]))

    assert rows[0].source == SOURCE_BOTH
    assert (rows[0].current, rows[0].date_removed, rows[0].ended_since_pdf) == (
        False,
        "2026-11-20",
        True,
    )
    assert rows[1].source == SOURCE_JSON
    assert (company.identified, company.unidentified, company.ended_since_pdf) == (
        1,
        1,
        1,
    )
    assert not company.told_by_the_pdf and company.needs_pdf


def test_a_company_whose_pdf_names_everyone_the_json_does_is_told_by_it():
    rows = index_seats(
        pd.DataFrame([json_seat()]),
        pd.DataFrame([pdf_seat(), pdf_seat(krs="0000000001")]),
    )
    companies = pd.DataFrame(
        [c.__dict__ for c in companies_of(pd.DataFrame([r.__dict__ for r in rows]))]
    )

    # The other company's PDF is not in the index: no JSON for it.
    assert [r.krs for r in rows] == [KOB_BUS]
    assert told_by_the_pdf(companies) == {KOB_BUS}
    assert owe_a_pdf(companies) == []


# --------------------------------------------------------------- people
def index_frame(*rows):
    return pd.DataFrame([r.__dict__ for r in rows])


def test_a_person_counts_each_company_post_once_current_or_past():
    a = match_company(
        [
            json_seat(),
            json_seat(
                role="nadzor",
                entry_added="2",
                entry_removed="3",
                date_removed="2026-01-01",
            ),
        ],
        [pdf_seat(), pdf_seat(role="nadzor", entry_added="2")],
    )
    b = match_company(
        [json_seat(krs="0000000002"), json_seat(krs="0000000002", entry_added="7")],
        [pdf_seat(krs="0000000002"), pdf_seat(krs="0000000002", entry_added="7")],
    )

    [person] = people_of(index_frame(*a, *b))

    assert (person.companies, person.current, person.past) == (2, 2, 1)
    assert len(person.positions) == 4


def test_a_rejestrio_id_is_counted_through_its_one_fingerprint():
    [person] = people_of(index_frame(*match_company([json_seat()], [pdf_seat()])))
    positions = pd.DataFrame([person.__dict__])
    people = pd.DataFrame(
        [
            {"id": "11", "pesel_fingerprint": "f" * 32},
            {"id": "11", "pesel_fingerprint": "f" * 32},
            # Matched to two fingerprints: nobody the index can count for.
            {"id": "22", "pesel_fingerprint": "f" * 32},
            {"id": "22", "pesel_fingerprint": "e" * 32},
            {"id": "33", "pesel_fingerprint": None},
        ]
    )

    counts = counts_by_rejestrio_id(people, positions)

    assert set(counts) == {"11"}
    assert (counts["11"].current, counts["11"].past) == (1, 0)
