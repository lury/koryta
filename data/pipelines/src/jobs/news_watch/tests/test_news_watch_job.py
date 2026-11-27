import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pytest

from jobs import news_watch
from jobs.news_watch.google_resolve import (
    GoogleNewsResolver,
    article_id,
    page_params,
    parse_batch,
)
from jobs.news_watch.handoff import hand_off, keys_of
from jobs.news_watch.http import DiskCache, PoliteClient, Response, user_agent
from jobs.news_watch.models import Candidate, NewsHit, NewsQuery
from jobs.news_watch.queries import build_queries, company_phrase, person_phrase
from jobs.news_watch.sources import (
    DEFAULT_SOURCES,
    GdeltSource,
    SearchResult,
    SourceError,
    brave_params,
    build_sources,
    gdelt_params,
    parse_brave,
    parse_gdelt,
    parse_google_news,
)
from jobs.news_watch.urls import normalize_url, url_key
from scrapers.news.changes import BoardChange

FIXTURES = Path(__file__).parent / "fixtures"


def change(person="Rafał Kudas", krs="0000006301", day="2026-11-24", kind="left"):
    return BoardChange(
        krs=krs,
        company="KRAKOWSKI HOLDING KOMUNALNY SPÓŁKA AKCYJNA W KRAKOWIE (Kraków)",
        person=person,
        role="Zarząd",
        kind=kind,
        change_date=day,
        bulletin_day=day,
    )


def query(**kw) -> NewsQuery:
    base = dict(
        person="Rafał Kudas",
        company="Krakowski Holding Komunalny",
        krs="0000006301",
        start=date(2026, 11, 10),
        end=date(2026, 11, 26),
    )
    return NewsQuery(**{**base, **kw})


# -- urls -------------------------------------------------------------------


def test_one_spelling_per_article():
    assert (
        normalize_url(
            "http://WWW.Example.pl/Wiadomosci/artykul-1/?utm_source=x&fbclid=y&id=3#top"
        )
        == "https://example.pl/Wiadomosci/artykul-1?id=3"
    )
    assert normalize_url("https://example.pl/a/amp") == "https://example.pl/a"
    assert url_key("https://www.example.pl/") == "example.pl"
    assert url_key("example.pl/a/") == url_key("https://example.pl/a?utm_medium=rss")


# -- queries ----------------------------------------------------------------


def test_a_query_names_the_person_without_middle_names_and_the_company_as_written():
    assert person_phrase(change("Artur Jerzy Skóra")) == "Artur Skóra"
    assert company_phrase("AQUANET (Poznań)") == "Aquanet"
    # A name every town has is searched by the town.
    assert company_phrase("PRZEDSIĘBIORSTWO ENERGETYKI CIEPLNEJ (Giżycko)") == "Giżycko"
    assert company_phrase("PRZEDSIĘBIORSTWO ENERGETYKI CIEPLNEJ") is None


def test_changes_close_together_share_a_query_and_the_window_stops_today():
    queries = build_queries(
        [
            change(day="2026-11-24"),
            change(day="2026-11-20", kind="appointed"),
            change(day="2025-01-10", kind="appointed"),
        ],
        today=date(2026, 11, 26),
    )
    assert [(q.start, q.end, q.changes) for q in queries] == [
        (
            date(2026, 11, 6),
            date(2026, 11, 26),
            ("appointed:Zarząd:2026-11-20", "left:Zarząd:2026-11-24"),
        ),
        (date(2024, 12, 27), date(2025, 1, 24), ("appointed:Zarząd:2025-01-10",)),
    ]
    assert queries[0].text == '"Rafał Kudas" "Krakowski Holding Komunalny"'


# -- sources: what each answers ---------------------------------------------


def test_gdelt_asks_for_polish_articles_inside_the_window():
    params = gdelt_params(query())
    assert (
        params["query"]
        == '"Rafał Kudas" "Krakowski Holding Komunalny" sourcelang:polish'
    )
    assert params["startdatetime"] == "20261110000000"
    assert params["enddatetime"] == "20261127000000"
    assert params["mode"] == "ArtList" and params["format"] == "json"


def test_gdelt_articles_are_read_and_its_refusal_is_an_error():
    hits = parse_gdelt((FIXTURES / "gdelt_artlist.json").read_text())
    assert hits, "the recorded answer has articles"
    assert all(h.source == "gdelt" and h.url.startswith("http") for h in hits)
    assert all(h.published is None or len(h.published) == 10 for h in hits)
    assert parse_gdelt("{}") == []
    with pytest.raises(SourceError, match="one every 5 seconds"):
        parse_gdelt((FIXTURES / "gdelt_429.txt").read_text())


def test_google_news_items_are_redirects_with_the_publisher_apart():
    hits = parse_google_news((FIXTURES / "google_news_jez_zaglebie.xml").read_text())
    assert len(hits) == 6
    first = hits[0]
    assert first.redirect and first.url.startswith(
        "https://news.google.com/rss/articles/"
    )
    assert first.domain == "gazetawroclawska.pl"
    assert not first.title.endswith("Gazeta Wrocławska")
    assert first.published == "2026-11-25"


def test_a_feed_declaring_entities_is_refused():
    with pytest.raises(SourceError):
        parse_google_news('<!DOCTYPE x [<!ENTITY a "b">]><rss>&a;</rss>')


def test_brave_news_results_are_read():
    params = brave_params(query())
    assert params["freshness"] == "2026-11-10to2026-11-26"
    hits = parse_brave((FIXTURES / "brave_news.json").read_text())
    assert [(h.domain, h.published) for h in hits] == [("www.example.pl", "2026-11-20")]
    assert hits[0].snippet


def test_brave_runs_only_with_a_key(monkeypatch, tmp_path):
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)
    assert [s.name for s in build_sources(("gdelt", "brave"), None)] == ["gdelt"]
    assert [s.name for s in build_sources(DEFAULT_SOURCES, None)] == [
        "gdelt",
        "google_news",
    ]
    monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "k")
    assert [s.name for s in build_sources(("gdelt", "brave"), None)] == [
        "gdelt",
        "brave",
    ]
    with pytest.raises(ValueError):
        build_sources(("bing",), None)


# -- the client -------------------------------------------------------------


@dataclass
class Reply:
    status_code: int
    text: str


class FakeSession:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls: list[tuple[str, dict, dict]] = []

    def get(self, url, params=None, headers=None, timeout=None, cookies=None):
        self.calls.append((url, params, headers))
        self.cookies = cookies
        return self.replies.pop(0)

    def post(self, url, data=None, headers=None, timeout=None, cookies=None):
        self.calls.append((url, data, headers))
        self.cookies = cookies
        return self.replies.pop(0)


class Clock:
    def __init__(self):
        self.now = 0.0
        self.slept: list[float] = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


def client(replies, tmp_path=None, interval=5.0):
    clock = Clock()
    session = FakeSession(replies)
    polite = PoliteClient(
        "gdelt",
        interval,
        session=session,
        cache=DiskCache(tmp_path) if tmp_path else None,
        sleep=clock.sleep,
        clock=clock,
    )
    return polite, session, clock


def test_calls_are_spaced_and_say_who_asks():
    polite, session, clock = client([Reply(200, "{}"), Reply(200, "{}")])
    polite.get("u", {}, "a", "2026-11-26")
    polite.get("u", {}, "b", "2026-11-26")
    assert clock.slept == [5.0]
    assert session.calls[0][2]["User-Agent"] == user_agent()
    assert user_agent().startswith("koryta-pipelines/")
    assert user_agent().endswith("(https://github.com/SzymonPajzert/koryta)")


def test_never_under_a_second_between_calls():
    polite, _, clock = client([Reply(200, "{}"), Reply(200, "{}")], interval=0.1)
    polite.get("u", {}, "a", "d")
    polite.get("u", {}, "b", "d")
    assert clock.slept == [1.0]


def test_a_429_backs_off_and_tries_again():
    polite, session, clock = client(
        [Reply(429, "slow down"), Reply(200, '{"articles": []}')]
    )
    response = polite.get("u", {}, "a", "d")
    assert response.status == 200 and len(session.calls) == 2
    assert clock.slept[0] == 10.0


def test_a_429_that_does_not_end_is_returned():
    polite, session, _ = client([Reply(429, "no")] * 4)
    assert polite.get("u", {}, "a", "d").status == 429
    assert len(session.calls) == 4 and polite.calls == 4


def test_an_answer_is_kept_for_the_day(tmp_path):
    polite, session, _ = client([Reply(200, '{"articles": []}')], tmp_path)
    polite.get("u", {}, "a", "2026-11-26")
    again = polite.get("u", {}, "a", "2026-11-26")
    assert again.cached and again.text == '{"articles": []}'
    assert len(session.calls) == 1


def test_a_refusal_is_not_kept(tmp_path):
    polite, session, _ = client([Reply(400, "bad")] * 2, tmp_path)
    polite.get("u", {}, "a", "d")
    polite.get("u", {}, "a", "d")
    assert len(session.calls) == 2


# -- the run ----------------------------------------------------------------


class FakeSource:
    def __init__(self, name, hits=None, error=None):
        self.name = name
        self.hits = hits or []
        self.error = error
        self.client = type("C", (), {"calls": 0})()

    def search(self, query, day):
        self.client.calls += 1
        if self.error:
            raise SourceError(self.error)
        return SearchResult(self.hits, Response(200, "", 0.5))


def hit(
    url, source="gdelt", title="Rafał Kudas odwołany z zarządu KHK", redirect=False
):
    return NewsHit(source, url, title, "example.pl", "2026-11-20", redirect=redirect)


def test_one_candidate_per_article_known_and_redirects_apart():
    q = query()
    found = [
        (q, hit("https://www.example.pl/a?utm_source=x")),
        (q, hit("https://example.pl/a/", source="brave")),
        (q, hit("https://example.pl/b", title="Holding bez prezesa")),
        (q, hit("https://example.pl/known")),
        (q, hit("https://news.google.com/rss/articles/X", redirect=True)),
    ]
    known = keys_of([{"sourceURL": "https://example.pl/known"}, {"sourceURL": None}])
    candidates, known_count, redirects = news_watch.candidates_from(found, known)
    assert [(c.url, c.sources, c.names_person) for c in candidates] == [
        ("https://example.pl/a", ["gdelt", "brave"], True),
        ("https://example.pl/b", ["gdelt"], False),
    ]
    assert (known_count, redirects) == (1, 1)


def test_a_failing_source_costs_its_own_answer_only():
    good = FakeSource("gdelt", [hit("https://example.pl/a")])
    bad = FakeSource("brave", error="HTTP 500")
    logs, found, errors = news_watch.collect(
        [query()], [good, bad], "d", log=lambda s: None
    )
    assert len(found) == 1 and errors == {"brave": 1}
    assert logs[0].sources["gdelt"]["hits"] == 1
    assert "HTTP 500" in logs[0].sources["brave"]["error"]


def test_nothing_is_queued_without_a_queue(monkeypatch):
    monkeypatch.delenv("URL_STORE_URL", raising=False)
    c = Candidate(
        "https://example.pl/a", "example.pl/a", "t", "example.pl", None, "p", "c", "k"
    )
    assert hand_off([c], "auto") == ("none", 0)


def test_the_url_store_gets_each_candidate_with_its_context(monkeypatch):
    sent = []

    class Store:
        @classmethod
        def from_env(cls):
            return cls()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return None

        def create_urls(self, urls):
            sent.extend(urls)
            return type("R", (), {"inserted": 1})()

    monkeypatch.setenv("URL_STORE_URL", "https://store")
    monkeypatch.setattr("external.url_store_client.UrlStoreClient", Store)
    c = Candidate(
        "https://example.pl/a", "example.pl/a", "t", "example.pl", None, "p", "c", "k"
    )
    assert hand_off([c], "auto") == ("url_store", 1)
    assert sent[0].source == "news_watch" and sent[0].context["person"] == "p"


def test_a_run_writes_the_queries_the_candidates_and_the_summary(monkeypatch, tmp_path):
    changes = tmp_path / "changes.json"
    changes.write_text(
        json.dumps([change().__dict__, change(day="2026-10-01").__dict__])
    )
    known = tmp_path / "nodes.jsonl"
    known.write_text(json.dumps({"sourceURL": "https://example.pl/known"}) + "\n")
    source = FakeSource(
        "gdelt", [hit("https://example.pl/a"), hit("https://example.pl/known")]
    )
    monkeypatch.setattr(news_watch, "build_sources", lambda *a: [source])
    monkeypatch.setattr(news_watch, "warsaw_today", lambda: date(2026, 11, 26))
    out = tmp_path / "run.jsonl"

    code = news_watch.main(
        [
            "--changes",
            str(changes),
            "--since",
            "2026-11-24",
            "--queue",
            "none",
            "--known-articles",
            str(known),
            "--out",
            str(out),
        ]
    )

    assert code == 0
    lines = [json.loads(line) for line in out.read_text().splitlines()]
    summary = lines[-1]["summary"]
    assert summary["changes"] == 1 and summary["queries"] == 1
    assert summary["candidates"] == 1 and summary["known"] == 1
    assert summary["queries_with_hits"] == {"gdelt": 1}
    assert lines[1]["candidate"]["url"] == "https://example.pl/a"


def test_a_source_that_did_not_answer_leaves_the_run_for_later(monkeypatch, tmp_path):
    changes = tmp_path / "changes.json"
    changes.write_text(json.dumps([change().__dict__]))
    monkeypatch.setattr(
        news_watch, "build_sources", lambda *a: [FakeSource("gdelt", error="429")]
    )
    monkeypatch.setattr(news_watch, "warsaw_today", lambda: date(2026, 11, 26))
    monkeypatch.setattr(news_watch, "known_article_keys", lambda path: set())
    code = news_watch.main(
        [
            "--changes",
            str(changes),
            "--since",
            "2026-11-24",
            "--queue",
            "none",
            "--out",
            str(tmp_path / "o.jsonl"),
        ]
    )
    assert code == news_watch.EXIT_TRY_LATER


def test_gdelt_source_reads_through_the_client(tmp_path):
    body = (FIXTURES / "gdelt_artlist.json").read_text()
    polite, session, _ = client([Reply(200, body)], tmp_path)
    result = GdeltSource(polite).search(query(), "2026-11-26")
    assert result.hits and session.calls[0][0].endswith("/api/v2/doc/doc")
    assert session.calls[0][1]["query"].endswith("sourcelang:polish")


def test_past_the_deadline_no_query_is_asked():
    source = FakeSource("gdelt", [hit("https://example.pl/a")])
    logs, found, errors = news_watch.collect(
        [query(), query(person="Anna Nowak")],
        [source],
        "d",
        lambda s: None,
        deadline=0.0,
    )
    assert logs == [] and found == [] and errors == {"not_asked": 2}
    assert source.client.calls == 0


# -- Google News links to the publishers' ---------------------------------

LINK = "https://news.google.com/rss/articles/CBMilAFBVV95cUxOclo1VXZvTDlKejFBRkNm?oc=5"
AID = "CBMilAFBVV95cUxOclo1VXZvTDlKejFBRkNm"


def test_the_article_id_is_read_off_the_link():
    assert article_id(LINK) == AID
    assert article_id("https://example.pl/articles/x") is None


def test_the_page_s_signature_buys_the_publisher_s_url():
    """The page and the answer are written to the shape the live ones have in
    the published decoders: Google answered this client 429 on 2026-11-26."""
    page = (FIXTURES / "google_news_article_page.html").read_text()
    answer = (FIXTURES / "google_news_batchexecute.txt").read_text()
    assert page_params(page) == ("AZ5r3eQsig", "1764150000")
    polite, session, _ = client([Reply(200, page), Reply(200, answer)], interval=2.0)

    url = GoogleNewsResolver(polite).resolve(LINK)

    assert url == "https://gazetawroclawska.pl/zaglebie-lubin-zarzad/ar/c2-1234"
    page_call, batch_call = session.calls
    assert page_call[0] == f"https://news.google.com/rss/articles/{AID}"
    assert session.cookies == {"SOCS": "CAI"}
    request = json.loads(json.loads(batch_call[1]["f.req"])[0][0][1])
    assert request[0] == "garturlreq"
    assert request[2:] == [AID, 1764150000, "AZ5r3eQsig"]


def test_a_refusal_leaves_the_link_unresolved():
    polite, _, _ = client([Reply(429, "Sorry...")] * 4, interval=2.0)
    assert GoogleNewsResolver(polite).resolve(LINK) is None
    assert parse_batch(")]}'\n\n[]") is None


def test_resolved_links_are_queued_as_the_publishers_urls():
    class Resolver:
        def __init__(self):
            self.calls = []

        def resolve(self, link):
            self.calls.append(link)
            return "https://www.wroclaw.pl/a?utm_source=gn"

    q = query()
    found = [
        (q, hit(LINK, source="google_news", title="Mecz Zagłębia", redirect=True)),
        (q, hit(LINK + "&x", source="google_news", redirect=True)),
    ]
    resolver = Resolver()
    resolved_found, resolved = news_watch.resolve_redirects(found, resolver, limit=1)
    # The one naming the person goes first.
    assert resolver.calls == [LINK + "&x"] and resolved == 1
    candidates, _, redirects = news_watch.candidates_from(resolved_found, set())
    assert [c.url for c in candidates] == ["https://wroclaw.pl/a"]
    assert candidates[0].domain == "wroclaw.pl" and redirects == 1
