"""What Wikidata says about a person koryta.pl links to pl.wikipedia."""

from dataclasses import dataclass, field
from typing import Literal

#: How a person's Wikipedia link came out:
#: - ok: the article has a Wikidata item, and the item was read;
#: - no_item: the article exists and no item is linked to it;
#: - dead: no such article on pl.wikipedia;
#: - not_plwiki: a link that names no pl.wikipedia article;
#: - not_fetched: the job has not asked about it yet (cap, or never run).
LinkStatus = Literal["ok", "no_item", "dead", "not_plwiki", "not_fetched"]

#: The site's birth date against Wikidata's:
#: - exact: the same day;
#: - year_only: one side gives only the year (or month), and it agrees;
#: - different: they disagree;
#: - site_missing / wikidata_missing: one side has no date.
BirthCheck = Literal[
    "exact", "year_only", "different", "site_missing", "wikidata_missing"
]

#: How much of a Wikidata date is known (its `precision` 11, 10 and 9).
Precision = Literal["day", "month", "year"]


@dataclass
class WikidataItem:
    qid: str
    label: str | None = None


@dataclass
class WikidataMembership:
    """A P102 statement: a party, and when, where Wikidata says."""

    qid: str
    label: str | None = None
    start: str | None = None
    start_precision: Precision | None = None
    end: str | None = None
    end_precision: Precision | None = None


@dataclass
class WikidataPosition:
    """A P39 statement with the qualifiers koryta.pl can show."""

    qid: str
    label: str | None = None
    start: str | None = None
    start_precision: Precision | None = None
    end: str | None = None
    end_precision: Precision | None = None
    #: P642 "of" - deprecated on Wikidata, rarely there.
    of: WikidataItem | None = None
    #: P768 the electoral district.
    district: WikidataItem | None = None
    #: P2937 the parliamentary terms: one statement often spans several.
    terms: list[WikidataItem] = field(default_factory=list)


@dataclass
class WikidataPerson:
    """One person of koryta.pl with a pl.wikipedia link, as Wikidata has them."""

    id: str
    name: str
    wikipedia: str
    title: str | None
    link_status: LinkStatus
    qid: str | None = None
    #: The item's revision the row was built from.
    lastrevid: int | None = None
    birth_date: str | None = None
    birth_precision: Precision | None = None
    #: More than one birth date at the best rank, the first one kept.
    birth_date_disputed: bool = False
    site_birth_date: str | None = None
    birth_check: BirthCheck | None = None
    parties: list[WikidataMembership] = field(default_factory=list)
    positions: list[WikidataPosition] = field(default_factory=list)
    occupations: list[WikidataItem] = field(default_factory=list)
    citizenships: list[WikidataItem] = field(default_factory=list)
