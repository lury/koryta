"""Where a scoring model's votes are stored, and what is allowed to store them.

Two ways in, because the two contexts hold different credentials:

* Against a local stack the emulator trusts anybody, so the Admin SDK writes
  straight through and `firestore.rules` never runs.
* Against a deployed site the uploader is a person - whoever is running
  `submit_scores.sh` - and the credentials at hand are the Firebase id token
  from the same browser login every other `--type` uses. A person's Google
  account holds no Firestore IAM role, only the deploy service accounts do, so
  the Admin SDK's application-default path answers `403 Missing or insufficient
  permissions`. So the upload goes through the site's own API
  (`/api/votes/pipeline`) with the id token, which admits a member of the
  datascience group writing a pipeline's votes, on Firestore or on Postgres.

Set `KORYTA_ID_TOKEN` to skip the browser login and present an id token
directly - what a service holding its own datascience account would do, and
what a local stack on Postgres needs. The login itself is passed in by the
caller: it lives in `stores.auth`, which this layer may not import.
"""

import os
import sys
import typing

import firebase_admin
import requests
from firebase_admin import firestore

from entities.composite import PersonScore
from util.cf_access import site_session

#: Asks whoever is running the upload to sign in, and returns their id token.
Login = typing.Callable[[], str]

#: Firestore takes at most 500 operations in one batch, REST commit included.
BATCH_LIMIT = 500

#: A full reconciliation reads back every vote the model holds, tens of
#: thousands of documents in one response.
QUERY_TIMEOUT_S = 300
COMMIT_TIMEOUT_S = 120


class VoteStore(typing.Protocol):
    """The two operations reconciling a model's scores needs of Firestore."""

    def scores(self, model: str) -> dict[str, int]:
        """Node id -> the score this model last wrote, for the whole model."""
        ...

    def apply(self, model: str, changed: list[PersonScore], stale: list[str]) -> None:
        """Write these scores and retract the scores on these node ids."""
        ...


def batched(items: list, size: int = BATCH_LIMIT):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def vote_id(node_id: str, user_uid: str) -> str:
    return f"{node_id}_{user_uid}"


def vote_document(node_id: str, model: str, score: float) -> dict:
    return {
        "nodeId": node_id,
        "userUid": model,
        "categoryVotes": {"interesting": score},
    }


class AdminVotes:
    """Writes as the project itself, bypassing rules. Local stacks only.

    The emulator asks for no credentials at all, which is what makes this the
    path for a dev stack: no browser login in the middle of a pipeline run.
    """

    def __init__(self, project_id: str | None, database_id: str):
        options = {"projectId": project_id} if project_id else {}
        try:
            app = firebase_admin.get_app("uploader")
        except ValueError:
            app = firebase_admin.initialize_app(options=options, name="uploader")
        self.db = firestore.client(app=app, database_id=database_id)

    def scores(self, model: str) -> dict[str, int]:
        query = self.db.collection("votes").where(
            filter=firestore.FieldFilter("userUid", "==", model)
        )
        existing = {}
        for doc in query.stream():
            data = doc.to_dict() or {}
            node_id = data.get("nodeId")
            interesting = (data.get("categoryVotes") or {}).get("interesting")
            if node_id and interesting is not None:
                existing[node_id] = interesting
        return existing

    def apply(self, model: str, changed: list[PersonScore], stale: list[str]) -> None:
        collection = self.db.collection("votes")
        writes: list = [(score.node_id, score.score) for score in changed]
        writes += [(node_id, None) for node_id in stale]

        written = 0
        for chunk in batched(writes):
            batch = self.db.batch()
            for node_id, score in chunk:
                reference = collection.document(vote_id(node_id, model))
                if score is None:
                    batch.delete(reference)
                else:
                    batch.set(
                        reference, vote_document(node_id, model, score), merge=True
                    )
            batch.commit()
            written += len(chunk)
            if written < len(writes):
                print(f"  committed {written}...", file=sys.stderr)


class ApiVotes:
    """Writes as the signed-in person, through the site's own API.

    `GET` and `POST /api/votes/pipeline` (frontend/server/api/votes/) take the
    id token and check what `firestore.rules` checked before: the
    `datascience` claim, and a model uid with "pipeline" in it, writing only
    the `interesting` leaf of `<nodeId>_<model>`. The same call works on either
    store behind the site, Firestore or Postgres (decision on 2026-11-26).
    """

    def __init__(self, endpoint: str, id_token: str):
        self.url = f"{endpoint.rstrip('/')}/api/votes/pipeline"
        self.session = site_session()
        self.session.headers["Authorization"] = f"Bearer {id_token}"

    def scores(self, model: str) -> dict[str, int]:
        response = self.session.get(
            self.url, params={"model": model}, timeout=QUERY_TIMEOUT_S
        )
        self.check(response, f"reading {model}'s votes")
        return {
            node_id: int(score)
            for node_id, score in response.json().get("scores", {}).items()
        }

    def apply(self, model: str, changed: list[PersonScore], stale: list[str]) -> None:
        writes: list[tuple[str, int | None]] = [
            (score.node_id, int(score.score)) for score in changed
        ]
        writes += [(node_id, None) for node_id in stale]

        written = 0
        for chunk in batched(writes):
            body = {
                "model": model,
                "set": [
                    {"nodeId": node_id, "score": score}
                    for node_id, score in chunk
                    if score is not None
                ],
                "retract": [node_id for node_id, score in chunk if score is None],
            }
            response = self.session.post(self.url, json=body, timeout=COMMIT_TIMEOUT_S)
            self.check(response, f"writing {len(chunk)} of {model}'s votes")
            written += len(chunk)
            if written < len(writes):
                print(f"  committed {written}...", file=sys.stderr)

    @staticmethod
    def check(response: requests.Response, what: str) -> None:
        if response.ok:
            return
        if response.status_code == 403:
            raise PermissionError(
                f"The site refused {what}: {response.text}\n"
                "Uploading scores needs the `datascience` claim on the account "
                "you logged in as - the same one /ekstrakcje requires."
            )
        raise RuntimeError(
            f"The site failed {what}: {response.status_code} {response.text}"
        )


def emulator_project_id() -> str:
    """The project the running emulator serves, so writes land in its data."""
    try:
        response = requests.get("http://127.0.0.1:4000/api/config", timeout=2)
        if response.status_code == 200:
            project_id = response.json().get("projectId")
            if project_id:
                return project_id
    except Exception as e:
        print(f"Warning: Could not detect emulator project ID: {e}", file=sys.stderr)
    return "demo-koryta-pl"


def open_votes(args, login: Login | None = None) -> VoteStore:
    """The way in that suits the endpoint this run is uploading to."""
    database_id = getattr(args, "database", "koryta-pl")
    project_id = getattr(args, "project", None)

    # A local stack on Postgres has no emulator to write to: given a token,
    # it goes through the API like a deployed site.
    if args.endpoint.startswith("http://localhost") and not os.environ.get(
        "KORYTA_ID_TOKEN"
    ):
        os.environ["FIRESTORE_EMULATOR_HOST"] = "localhost:8080"
        return AdminVotes(project_id or emulator_project_id(), database_id)

    id_token = os.environ.get("KORYTA_ID_TOKEN")
    if not id_token:
        if login is None:
            raise ValueError(
                f"Writing to {args.endpoint} needs a Firebase id token: set "
                "KORYTA_ID_TOKEN, or hand this call a way to log in."
            )
        id_token = login()
    return ApiVotes(args.endpoint, id_token)


class Firestore:
    def __init__(
        self,
        args,
        votes: VoteStore | None = None,
        login: Login | None = None,
    ):
        self.votes = votes if votes is not None else open_votes(args, login)

    def existing_scores(self, model: str) -> dict[str, int]:
        """Node id -> the score this model last wrote, for the whole model.

        One equality query on `userUid`, which the automatic single-field index
        covers, and it returns only this model's own documents.
        """
        return self.votes.scores(model)

    def replace_scores(
        self, model: str, scores: list[PersonScore], retract: bool = True
    ) -> tuple[int, int]:
        """Make this model's stored opinion match the run that just finished.

        Written as a diff against what the model wrote last time rather than as
        a blind overwrite, for two reasons. Every vote document written fires
        `onVoteWritten`, which re-reads every vote on that node and rewrites the
        node's aggregate, so a run that re-states 40k unchanged scores costs 40k
        function invocations to change nothing. And a person the model no longer
        rates has to lose the score rather than keep a stale one - deleting the
        document says "this model has no opinion", which is what the site should
        show, whereas writing a zero leaves a vote nobody cast.

        `retract` is off when the caller only uploaded part of the run: a
        partial upload cannot tell a dropped score from one that was never sent.
        """
        existing = self.existing_scores(model)
        wanted = {s.node_id: s for s in scores}

        changed = [
            s for node_id, s in wanted.items() if existing.get(node_id) != s.score
        ]
        stale = (
            [node_id for node_id in existing if node_id not in wanted]
            if retract
            else []
        )

        print(
            f"{model}: {len(wanted)} scores, {len(existing)} already stored -> "
            f"{len(changed)} to write, {len(stale)} to retract"
            + ("" if retract else " (retraction skipped for a partial upload)"),
            file=sys.stderr,
        )

        self.votes.apply(model, changed, stale)
        return len(changed), len(stale)
