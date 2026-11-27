"""Uploading a model's shortlist: what gets written, and what gets taken back.

The score path is the one uploader that deletes, so it is the one worth a test.
"""

import typing

import pytest

from entities.composite import PersonScore
from uploader import Args, ScoreUploader
from util.firestore import (
    BATCH_LIMIT,
    ApiVotes,
    Firestore,
    vote_document,
    vote_id,
)


class FakeVotes:
    """Stands in for the store, whichever way in it was opened.

    `Firestore` decides what to write and what to take back; both the Admin SDK
    and the REST backend only carry that out, so the decisions are what these
    tests hold onto.
    """

    def __init__(self, documents: dict[str, dict]):
        self.documents = documents
        self.log: list[tuple[str, str]] = []

    def scores(self, model: str) -> dict[str, int]:
        return {
            data["nodeId"]: data["categoryVotes"]["interesting"]
            for data in self.documents.values()
            if data["userUid"] == model
        }

    def apply(self, model, changed, stale):
        for score in changed:
            document_id = vote_id(score.node_id, model)
            self.documents[document_id] = vote_document(
                score.node_id, model, score.score
            )
            self.log.append(("set", document_id))
        for node_id in stale:
            document_id = vote_id(node_id, model)
            self.documents.pop(document_id, None)
            self.log.append(("delete", document_id))


def stored(node_id: str, model: str, score: int) -> tuple[str, dict]:
    return (vote_id(node_id, model), vote_document(node_id, model, score))


def firestore_with(*documents: tuple[str, dict]) -> Firestore:
    return Firestore(None, FakeVotes(dict(documents)))


def score(node_id: str, value: int, model: str) -> PersonScore:
    return PersonScore(node_id=node_id, name=node_id, score=value, model=model)


class TestReplaceScores:
    def test_writes_only_what_changed(self):
        # Every vote written fires the aggregate trigger, so re-stating a score
        # the model already holds is a Cloud Function invocation that changes
        # nothing.
        client = firestore_with(
            stored("n1", "pipeline-pagerank", 5),
            stored("n2", "pipeline-pagerank", 2),
        )

        written, retracted = client.replace_scores(
            "pipeline-pagerank",
            [score("n1", 5, "pipeline-pagerank"), score("n2", 4, "pipeline-pagerank")],
        )

        assert (written, retracted) == (1, 0)
        assert client.votes.log == [("set", "n2_pipeline-pagerank")]

    def test_a_person_the_model_dropped_loses_the_score(self):
        client = firestore_with(stored("gone", "pipeline-turnover", 3))

        written, retracted = client.replace_scores(
            "pipeline-turnover", [score("kept", 2, "pipeline-turnover")]
        )

        assert (written, retracted) == (1, 1)
        assert "gone_pipeline-turnover" not in client.votes.documents

    def test_another_models_scores_are_not_touched(self):
        client = firestore_with(
            stored("n1", "pipeline-pagerank", 5),
            stored("n1", "pipeline-capture", 1),
            stored("n1", "aB3xYz", 4),
        )

        client.replace_scores("pipeline-pagerank", [])

        documents = client.votes.documents
        assert "n1_pipeline-pagerank" not in documents
        assert documents["n1_pipeline-capture"]["categoryVotes"]["interesting"] == 1
        assert documents["n1_aB3xYz"]["categoryVotes"]["interesting"] == 4

    def test_a_partial_upload_retracts_nothing(self):
        client = firestore_with(stored("n1", "pipeline", 5))

        written, retracted = client.replace_scores(
            "pipeline", [score("n2", 3, "pipeline")], retract=False
        )

        assert (written, retracted) == (1, 0)
        assert "n1_pipeline" in client.votes.documents


class FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self.payload = payload
        self.status_code = status_code
        self.ok = status_code < 400
        self.text = str(payload)

    def json(self):
        return self.payload


class FakeSession:
    """Records what the API backend puts on the wire."""

    def __init__(self, *responses: FakeResponse):
        self.headers: dict[str, str] = {}
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict | None]] = []

    def get(self, url, params=None, timeout=None):
        self.calls.append(("GET", url, params))
        return self.responses.pop(0) if self.responses else FakeResponse({})

    def post(self, url, json=None, timeout=None):
        self.calls.append(("POST", url, json))
        return self.responses.pop(0) if self.responses else FakeResponse({})


def api_with(session: FakeSession) -> ApiVotes:
    votes = ApiVotes.__new__(ApiVotes)
    votes.url = "https://koryta.example/api/votes/pipeline"
    votes.session = session  # type: ignore[assignment]
    return votes


class TestApiVotes:
    """The wire format /api/votes/pipeline takes."""

    def test_reads_a_models_stored_scores(self):
        session = FakeSession(FakeResponse({"scores": {"n1": 5}}))

        scores = api_with(session).scores("pipeline-pagerank")

        assert scores == {"n1": 5}
        assert session.calls == [
            (
                "GET",
                "https://koryta.example/api/votes/pipeline",
                {"model": "pipeline-pagerank"},
            )
        ]

    def test_writes_a_score_under_the_models_uid(self):
        session = FakeSession()

        api_with(session).apply(
            "pipeline-capture", [score("n1", 4, "pipeline-capture")], []
        )

        method, _, body = session.calls[0]
        assert method == "POST"
        assert body == {
            "model": "pipeline-capture",
            "set": [{"nodeId": "n1", "score": 4}],
            "retract": [],
        }

    def test_retracts_by_naming_the_node(self):
        session = FakeSession()

        api_with(session).apply("pipeline", [], ["gone"])

        _, _, body = session.calls[0]
        assert body == {"model": "pipeline", "set": [], "retract": ["gone"]}

    def test_sends_in_batches(self):
        session = FakeSession()
        scores = [score(f"n{i}", 3, "pipeline") for i in range(BATCH_LIMIT + 1)]

        api_with(session).apply("pipeline", scores, [])

        assert [len(body["set"]) for _, _, body in session.calls] == [BATCH_LIMIT, 1]

    def test_a_refusal_names_the_claim_the_upload_needs(self):
        session = FakeSession(FakeResponse({"error": "denied"}, status_code=403))

        with pytest.raises(PermissionError, match="datascience"):
            api_with(session).scores("pipeline")


def uploader_with(**overrides) -> ScoreUploader:
    args = typing.cast(Args, Args())
    args.model = overrides.get("model")
    args.limit = overrides.get("limit")
    args.offset = overrides.get("offset")
    instance = ScoreUploader.__new__(ScoreUploader)
    instance.args = args
    return instance


class TestModelOf:
    def test_takes_the_tag_the_rows_carry(self):
        uploader = uploader_with()

        assert (
            uploader.model_of([score("n1", 3, "pipeline-capture")])
            == "pipeline-capture"
        )

    def test_refuses_a_run_that_mixes_models(self):
        # Reconciliation is per model: uploading two at once would retract each
        # model's scores on behalf of the other.
        uploader = uploader_with()

        with pytest.raises(ValueError, match="one model per upload"):
            uploader.model_of(
                [score("n1", 3, "pipeline-capture"), score("n2", 3, "pipeline")]
            )

    def test_refuses_a_uid_the_site_would_read_as_a_person(self):
        uploader = uploader_with(model="pagerank")

        with pytest.raises(ValueError, match="human review"):
            uploader.model_of([score("n1", 3, "pipeline-pagerank")])

    def test_an_override_wins_over_the_rows(self):
        uploader = uploader_with(model="pipeline-experiment")

        assert uploader.model_of([score("n1", 3, "pipeline")]) == "pipeline-experiment"
