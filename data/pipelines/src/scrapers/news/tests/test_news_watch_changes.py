import pandas as pd

from scrapers.news.changes import (
    APPOINTED,
    LEFT,
    changes_from,
    company_label,
    tracked_companies,
)


def person(name, krs, role, start=None, end=None):
    first, last = name.split()[0], name.split()[-1]
    return {
        "full_name": name,
        "first_name": first,
        "last_name": last,
        "employed_krs": krs,
        "employed_role": role,
        "employed_start": start,
        "employed_end": end,
    }


def test_the_label_drops_the_town_and_the_form():
    assert company_label("AQUANET (Poznań)") == "AQUANET"
    assert (
        company_label("KRAKOWSKI HOLDING KOMUNALNY SPÓŁKA AKCYJNA W KRAKOWIE (Kraków)")
        == "KRAKOWSKI HOLDING KOMUNALNY"
    )
    assert company_label('"PKP INTERCITY" SPÓŁKA AKCYJNA') == "PKP INTERCITY"
    assert company_label("") is None


def test_only_company_pages_with_a_krs_are_tracked():
    nodes = pd.DataFrame(
        [
            {"type": "place", "krsNumber": "234819", "name": "AQUANET (Poznań)"},
            {"type": "place", "krsNumber": None, "name": "Bez KRS"},
            {"type": "person", "krsNumber": None, "name": "Jan Kowalski"},
        ]
    )
    assert tracked_companies(nodes) == {"0000234819": "AQUANET (Poznań)"}


def test_a_seat_dated_on_or_just_before_a_bulletin_day_is_its_change():
    people = pd.DataFrame(
        [
            person(
                "Jędrzej Solarski",
                "234819",
                "Rada Nadzorcza",
                "2019-01-02",
                "2026-11-24",
            ),
            person("Anna Nowak", "0000234819", "Zarząd", "2026-11-22"),
            # A week before the bulletin day: some other entry's.
            person("Jan Kowalski", "234819", "Zarząd", "2026-11-14"),
            # A prokurent is not watched.
            person("Ewa Lis", "234819", "Prokurent", "2026-11-24"),
            # No page for the company.
            person("Piotr Wrona", "111", "Zarząd", "2026-11-24"),
        ]
    )
    updates = pd.DataFrame(
        [
            {"krs": "234819", "date": "2026-11-24"},
            {"krs": "111", "date": "2026-11-24"},
        ]
    )
    changes = changes_from(people, updates, {"0000234819": "AQUANET (Poznań)"})

    assert [(c.person, c.kind, c.change_date, c.bulletin_day) for c in changes] == [
        ("Anna Nowak", APPOINTED, "2026-11-22", "2026-11-24"),
        ("Jędrzej Solarski", LEFT, "2026-11-24", "2026-11-24"),
    ]
    assert changes[0].krs == "0000234819"
    assert changes[0].company == "AQUANET (Poznań)"
    assert changes[1].last_name == "Solarski"


def test_no_bulletin_no_changes():
    people = pd.DataFrame([person("Anna Nowak", "1", "Zarząd", "2026-11-22")])
    assert (
        changes_from(people, pd.DataFrame(columns=["krs", "date"]), {"0000000001": "X"})
        == []
    )
