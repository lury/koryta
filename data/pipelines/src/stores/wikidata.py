"""The Wikidata cache `jobs.wikidata_people` keeps and `WikidataPeople` reads.

It lives in `downloaded/wikidata/`, on the disk the nightly VM keeps:

- `titles.json`: pl.wikipedia title -> what it resolved to (`TitleEntry`);
- `entities.json`: QID -> the item, slimmed to `PROPERTIES` (`slim_entity`),
  with the `lastrevid` it was read at;
- `labels.json`: QID -> Polish (else English) label of the items those point at;
- `state.json`: the dumps' ETags and when the revisions were last checked.

Slim, so the four stay well under 2 MB for the ~750 people linked today.
"""

import json
import os
import urllib.parse
from dataclasses import asdict, dataclass
from typing import Any, Literal

from stores.config import DOWNLOADED_DIR

CACHE_FOLDER = "wikidata"
CACHE_DIR = os.path.join(DOWNLOADED_DIR, CACHE_FOLDER)
TITLES = "titles.json"
ENTITIES = "entities.json"
LABELS = "labels.json"
STATE = "state.json"

#: The statements read, and the qualifiers kept on each.
PROPERTIES: dict[str, tuple[str, ...]] = {
    "P569": (),
    "P102": ("P580", "P582"),
    "P39": ("P580", "P582", "P642", "P768", "P2937"),
    "P106": (),
    "P27": (),
}

#: The properties whose item values are shown by name, and so need labels.
LABELLED = ("P102", "P39", "P106", "P27")
LABELLED_QUALIFIERS = ("P642", "P768", "P2937")

TitleStatus = Literal["found", "no_item", "dead"]


@dataclass
class TitleEntry:
    status: TitleStatus
    qid: str | None = None
    #: dump (page + page_props), wbgetentities or plwiki (the redirect check).
    source: str = ""
    #: The title it redirects to, where it was a redirect.
    target: str | None = None


def title_from_url(url: str) -> str | None:
    """The pl.wikipedia article a link names, spelled as the wiki titles it:
    spaces, not underscores, and a capital first letter. None for a link that
    names no pl.wikipedia article."""
    if not isinstance(url, str):
        return None
    parsed = urllib.parse.urlsplit(url.strip())
    host = parsed.hostname or ""
    if host not in ("pl.wikipedia.org", "pl.m.wikipedia.org"):
        return None
    if parsed.path.startswith("/wiki/"):
        raw = parsed.path[len("/wiki/") :]
    else:
        raw = urllib.parse.parse_qs(parsed.query).get("title", [""])[0]
    title = urllib.parse.unquote(raw).replace("_", " ").strip()
    title = " ".join(title.split())
    if not title or ":" in title.split(" ")[0]:
        # Empty, or another namespace (Kategoria:, Plik:, Specjalna:...).
        return None
    return title[0].upper() + title[1:]


def _value(snak: dict[str, Any]) -> Any:
    """A snak's value as the cache keeps it: an item's QID, a time as
    {time, precision}, or None for no value, some value or another type."""
    if snak.get("snaktype") != "value":
        return None
    datavalue = snak.get("datavalue", {})
    value = datavalue.get("value")
    match datavalue.get("type"):
        case "wikibase-entityid":
            return value.get("id")
        case "time":
            return {"time": value.get("time"), "precision": value.get("precision")}
    return None


def slim_entity(entity: dict[str, Any]) -> dict[str, Any]:
    """An entity of wbgetentities, cut to what the pipeline reads."""
    claims: dict[str, list[dict[str, Any]]] = {}
    for prop, qualifiers in PROPERTIES.items():
        statements = []
        for statement in entity.get("claims", {}).get(prop, []):
            kept: dict[str, list[Any]] = {}
            for qualifier in qualifiers:
                values = [
                    _value(snak)
                    for snak in statement.get("qualifiers", {}).get(qualifier, [])
                ]
                if any(v is not None for v in values):
                    kept[qualifier] = [v for v in values if v is not None]
            statements.append(
                {
                    "rank": statement.get("rank", "normal"),
                    "value": _value(statement.get("mainsnak", {})),
                    **({"qualifiers": kept} if kept else {}),
                }
            )
        if statements:
            claims[prop] = statements
    labels = entity.get("labels", {})
    return {
        "qid": entity["id"],
        "lastrevid": entity.get("lastrevid"),
        "modified": entity.get("modified"),
        "label": (labels.get("pl") or {}).get("value"),
        "claims": claims,
    }


def referenced_items(entity: dict[str, Any]) -> set[str]:
    """The QIDs a slim entity names that a reader wants a label for."""
    found: set[str] = set()
    for prop in LABELLED:
        for statement in entity.get("claims", {}).get(prop, []):
            if isinstance(statement.get("value"), str):
                found.add(statement["value"])
            for qualifier in LABELLED_QUALIFIERS:
                for value in statement.get("qualifiers", {}).get(qualifier, []):
                    if isinstance(value, str):
                        found.add(value)
    return found


def titles_from_json(data: dict[str, dict[str, Any]]) -> dict[str, TitleEntry]:
    return {title: TitleEntry(**entry) for title, entry in data.items()}


def titles_to_json(titles: dict[str, TitleEntry]) -> dict[str, dict[str, Any]]:
    return {title: asdict(entry) for title, entry in sorted(titles.items())}


def read_json(path: str, default: Any) -> Any:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json(path: str, data: Any) -> None:
    """Written beside and renamed over, so a killed run leaves the old file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    part = f"{path}.part"
    with open(part, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    os.replace(part, path)
