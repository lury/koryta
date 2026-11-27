import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type postgres from "postgres";
import handler from "~~/server/api/ingest/person.post";
import { edgeDocumentId, type EdgeLike } from "~~/server/utils/edges";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** POST /api/ingest/person on Postgres, the candidacies and the person a
 * payload restates: which stored candidacy a row lands on, what is written
 * out and what is only proposed, a run moved out of the candidate's home into
 * its district, and what an update keeps of the person's page. The cases of
 * the Firestore-mock suite, asserted on the rows the request leaves.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/ingestPersonCandidacies.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.readValidatedBody = async (
    event: { body?: unknown },
    parse: (b: unknown) => unknown,
  ) => parse(event.body);
  g.setResponseStatus = () => {};
  g.useStorage = () => ({ clear: async () => {} });
});
vi.mock("~~/server/utils/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/utils/auth")>();
  return {
    ...actual,
    getUser: async (event: TestEvent) => {
      const header = event.headers.authorization;
      if (!header) throw Object.assign(new Error("401"), { statusCode: 401 });
      const [uid, ...claims] = header.split(",");
      return { uid, ...Object.fromEntries(claims.map((c) => [c, true])) };
    },
  };
});

type Doc = Record<string, unknown>;
type Row = { id: string; data: Doc };
type Answer = {
  personId: string;
  person: string;
  elections: Doc[];
  unplacedElections?: Doc[];
  proposals?: Record<string, number>;
  status: string;
};

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

async function ingest(body: Doc): Promise<Answer> {
  await store.sync(sql);
  const event = {
    headers: { authorization: "pipeline,datascience" },
    context: {},
    body,
  } as TestEvent;
  return (handler as unknown as (e: TestEvent) => Promise<Answer>)(event);
}

async function doc(t: "nodes" | "edges" | "revisions", id: string) {
  const [row] = await sql<{ data: Doc }[]>`
    SELECT data FROM ${sql(t)} WHERE id = ${id}`;
  return row?.data;
}

async function all(t: "nodes" | "edges" | "revisions"): Promise<Row[]> {
  return sql<Row[]>`SELECT id, data FROM ${sql(t)} ORDER BY id`;
}

const isProposal = (r: Row) => r.id.startsWith("proposal_");

/** The revisions written onto `target` (not the proposals), in write order. */
async function writtenOnto(target: string): Promise<Doc[]> {
  return (await all("revisions"))
    .filter((r) => !isProposal(r) && r.data.node_id === target)
    .map((r) => r.data)
    .sort((a, b) => String(a.update_time).localeCompare(String(b.update_time)));
}

async function written(): Promise<Doc[]> {
  return (await all("revisions"))
    .filter((r) => !isProposal(r))
    .map((r) => r.data);
}

async function proposed(): Promise<Doc[]> {
  return (await all("revisions")).filter(isProposal).map((r) => r.data);
}

/** The edges the request created: every one not arranged before it. */
async function createdEdges(): Promise<string[]> {
  const arranged = new Set(Object.keys(table("edges")));
  return (await all("edges"))
    .map((e) => e.id)
    .filter((id) => !arranged.has(id));
}

/** Files the request's proposals as a reviewer's answer, and puts the rest of
 * the database back as it was arranged: what a later send finds. */
async function answerProposals() {
  for (const { id, data } of (await all("revisions")).filter(isProposal)) {
    table("revisions")[id] = { ...data, status: "rejected" };
  }
}

const person = (name: string, fields: Doc = {}) => ({
  type: "person",
  name,
  parties: [],
  ...fields,
});
const region = (teryt: string, fields: Doc = {}) => ({
  type: "region",
  name: `Region ${teryt}`,
  teryt,
  published: true,
  ...fields,
});

const PIS = "Komitet Wyborczy Prawo i Sprawiedliwość";

describe.runIf(PG_TEST_DATABASE_URL)(
  "POST /api/ingest/person, candidacies and restated people",
  () => {
    beforeAll(async () => {
      sql = await openTestDatabase("ingest_person_cand");
    }, 120_000);
    afterAll(async () => {
      await closeTestDatabase(sql);
    });
    beforeEach(() => {
      store.clear();
    });

    describe("a new person's candidacies", () => {
      const newPerson = (election: Doc) => ({
        name: "Test Person",
        parties: [],
        companies: [],
        elections: [election],
      });
      beforeEach(() => {
        table("nodes").teryt1465 = region("1465");
      });

      async function candidacy(answer: Answer) {
        expect(answer.elections).toHaveLength(1);
        return (await doc("edges", String(answer.elections[0]!.edgeId)))!;
      }

      it("should create edges to regions if elections are provided", async () => {
        table("nodes").teryt02 = region("02");
        const answer = await ingest(
          newPerson({
            party: "Test Party",
            election_year: "2023",
            election_type: "Sejmik",
            teryt: "02",
          }),
        );
        const edgeId = String(answer.elections[0]!.edgeId);
        expect(await candidacy(answer)).toMatchObject({
          source: answer.personId,
          target: "teryt02",
          type: "election",
          name: "kandydatura",
          position: "Sejmik",
          party: "Test Party",
          start_date: "2023-01-01",
        });
        const [revision] = await writtenOnto(edgeId);
        expect(revision).toMatchObject({
          status: "pending",
          update_automatic: true,
          update_user: "pipeline",
        });
        expect((await doc("edges", edgeId))!.published).not.toBe(true);
      });

      it("stores the electoral committee a candidacy was run under", async () => {
        const answer = await ingest(
          newPerson({
            committee: PIS,
            election_year: "2024",
            election_type: "Samorząd",
            teryt: "1465",
          }),
        );
        expect(await candidacy(answer)).toMatchObject({
          type: "election",
          committee: PIS,
        });
        const [revision] = await writtenOnto(
          String(answer.elections[0]!.edgeId),
        );
        expect(revision!.status).toBe("pending");
      });

      it("records that a candidacy won", async () => {
        const answer = await ingest(
          newPerson({
            elected: true,
            election_year: "2024",
            election_type: "Samorząd",
            teryt: "1465",
          }),
        );
        expect(await candidacy(answer)).toMatchObject({
          type: "election",
          elected: true,
        });
      });

      it("stores PKW's statements of membership and backing on a new candidacy", async () => {
        const answer = await ingest(
          newPerson({
            election_year: "2024",
            election_type: "Wójt",
            teryt: "1465",
            party_member: "nie należy do partii politycznej",
            supported_by:
              "popierany przez partię polityczną: Prawo i Sprawiedliwość",
            backing_parties: ["PiS"],
          }),
        );
        const edge = await candidacy(answer);
        expect(edge).toMatchObject({
          type: "election",
          party_member: "nie należy do partii politycznej",
          supported_by:
            "popierany przez partię polityczną: Prawo i Sprawiedliwość",
          backing_parties: ["PiS"],
        });
        expect(edge).not.toHaveProperty("member_parties");
      });

      it("does not record a defeat, which it cannot tell from a blank form", async () => {
        const answer = await ingest(
          newPerson({
            elected: false,
            election_year: "2024",
            election_type: "Samorząd",
            teryt: "1465",
          }),
        );
        expect(await candidacy(answer)).not.toHaveProperty("elected");
      });
    });

    describe("a candidacy the database already has", () => {
      /** The shape the stored candidacies had before the ingest accepted a
       * committee. */
      const storedCandidacy = {
        source: "kowalski",
        target: "teryt1465",
        type: "election",
        name: "kandydatura",
        position: "Samorząd",
        start_date: "2024-01-01",
      };

      beforeEach(() => {
        Object.assign(table("nodes"), {
          kowalski: person("Jan Kowalski"),
          teryt1465: region("1465"),
        });
      });

      function storedEdges(
        stored: Doc[],
        ids = stored.map((_, i) => `stored-${i}`),
      ) {
        stored.forEach((edge, i) => {
          table("edges")[ids[i]!] = { ...edge };
        });
      }

      const rows = (...elections: Doc[]) => ({
        name: "Jan Kowalski",
        parties: [],
        companies: [],
        elections: elections.map((e) => ({
          election_type: "Samorząd",
          teryt: "1465",
          ...e,
        })),
      });
      const payload = (election: Doc) => rows(election);

      it("writes the result out and leaves an unrecognised committee for a reviewer", async () => {
        storedEdges([storedCandidacy]);
        await ingest(
          payload({
            election_year: "2024",
            elected: true,
            committee: "KWW Nasza Gmina",
          }),
        );
        const revisions = await written();
        expect(revisions).toHaveLength(1);
        expect(revisions[0]).toMatchObject({
          node_id: "stored-0",
          status: "approved",
        });
        expect(revisions[0]!.data).toEqual({
          ...storedCandidacy,
          elected: true,
        });
        const [offer] = await proposed();
        expect(offer).toMatchObject({
          node_id: "stored-0",
          status: "pending",
          data: { elected: true, committee: "KWW Nasza Gmina" },
        });
      });

      describe("PKW's statements of membership and backing", () => {
        const backing = {
          supported_by:
            "popierana przez partię polityczną: Prawo i Sprawiedliwość",
          backing_parties: ["PiS"],
        };

        it("writes them out and leaves an unrecognised committee for a reviewer", async () => {
          storedEdges([storedCandidacy]);
          await ingest(
            payload({
              election_year: "2024",
              committee: "KWW Tomasza Hapunowicza",
              ...backing,
            }),
          );
          const revisions = await written();
          expect(revisions).toHaveLength(1);
          expect(revisions[0]).toMatchObject({
            node_id: "stored-0",
            status: "approved",
          });
          expect(revisions[0]!.data).toEqual({
            ...storedCandidacy,
            ...backing,
          });
          expect((await proposed())[0]).toMatchObject({
            node_id: "stored-0",
            data: { committee: "KWW Tomasza Hapunowicza", ...backing },
          });
        });

        it("replaces a statement read differently, on the same candidacy", async () => {
          const stored = {
            ...storedCandidacy,
            supported_by: "popierana przez partię polityczną: Polska 2050",
            backing_parties: ["Inne"],
          };
          storedEdges([stored]);
          await ingest(
            payload({
              election_year: "2024",
              supported_by: "popierana przez partię polityczną: Polska 2050",
              backing_parties: ["Polska 2050"],
            }),
          );
          expect(await proposed()).toEqual([]);
          const revisions = await written();
          expect(revisions).toHaveLength(1);
          expect(revisions[0]).toMatchObject({ node_id: "stored-0" });
          expect(revisions[0]!.data).toEqual({
            ...stored,
            backing_parties: ["Polska 2050"],
          });
        });

        it("matches a copy still waiting for its committee whatever its statements say", async () => {
          const stored = {
            ...storedCandidacy,
            supported_by: "popierana przez partię polityczną: Polska 2050",
            backing_parties: ["Inne"],
          };
          storedEdges([stored]);
          await ingest(
            payload({
              election_year: "2024",
              committee: "KWW Nasza Gmina",
              supported_by: "popierana przez partię polityczną: Polska 2050",
              backing_parties: ["Polska 2050"],
            }),
          );
          const [revision] = await written();
          expect(revision).toMatchObject({ node_id: "stored-0" });
          expect(revision!.data).toEqual({
            ...stored,
            backing_parties: ["Polska 2050"],
          });
          expect((await proposed())[0]).toMatchObject({
            node_id: "stored-0",
            data: { committee: "KWW Nasza Gmina" },
          });
          expect(await all("edges")).toHaveLength(1);
        });

        it("writes nothing when the stored statements say the same", async () => {
          storedEdges([{ ...storedCandidacy, ...backing }]);
          await ingest(payload({ election_year: "2024", ...backing }));
          expect(await all("revisions")).toEqual([]);
        });
      });

      it("writes onto the stored candidacy, not beside it", async () => {
        storedEdges([storedCandidacy]);
        await ingest(
          payload({
            election_year: "2024",
            committee: PIS,
            party: "PiS",
            party_from_committee: true,
          }),
        );
        expect(await proposed()).toEqual([]);
        const revisions = await written();
        expect(revisions).toHaveLength(1);
        expect(revisions[0]).toMatchObject({
          node_id: "stored-0",
          status: "approved",
        });
        expect(revisions[0]!.data).toEqual({
          ...storedCandidacy,
          committee: PIS,
          party: "PiS",
        });
        expect((await all("edges")).map((e) => e.id)).toEqual(["stored-0"]);
      });

      it("leaves an unrecognised committee for a reviewer", async () => {
        storedEdges([storedCandidacy]);
        await ingest(
          payload({
            election_year: "2024",
            committee: "Komitet Wyborczy Wyborców Wspólny Kalisz",
          }),
        );
        expect(await written()).toEqual([]);
        const offers = await proposed();
        expect(offers).toHaveLength(1);
        expect(offers[0]).toMatchObject({ update_automatic: true });
        expect(await doc("edges", "stored-0")).toEqual(storedCandidacy);
      });

      it("says what became of the proposals it made", async () => {
        const body = payload({
          election_year: "2024",
          committee: "Komitet Wyborczy Wyborców Wspólny Kalisz",
        });
        storedEdges([storedCandidacy]);
        await ingest(body);
        await answerProposals();
        const result = await ingest(body);
        expect(result).toMatchObject({ proposals: { decided: 1 } });
        expect(await written()).toEqual([]);
      });

      it("says nothing about proposals when it made none", async () => {
        storedEdges([storedCandidacy]);
        const result = await ingest(payload({ election_year: "2024" }));
        expect(result).not.toHaveProperty("proposals");
      });

      it("keeps a candidacy off the public site if that is where it was", async () => {
        storedEdges([storedCandidacy]);
        await ingest(
          payload({
            election_year: "2024",
            committee: PIS,
            party_from_committee: true,
          }),
        );
        const [revision] = await written();
        expect(revision).toMatchObject({
          node_id: "stored-0",
          status: "approved",
        });
        const edge = await doc("edges", "stored-0");
        expect(edge).toMatchObject({ committee: PIS });
        expect(edge!.published).not.toBe(true);
      });

      it("keeps a published candidacy published", async () => {
        storedEdges([
          { ...storedCandidacy, published: true, revision_id: "revisions/old" },
        ]);
        await ingest(
          payload({
            election_year: "2024",
            committee: PIS,
            party_from_committee: true,
          }),
        );
        const [revision] = await written();
        expect(revision!.data).not.toHaveProperty("published");
        expect(revision!.data).not.toHaveProperty("revision_id");
        const edge = await doc("edges", "stored-0");
        expect(edge).toMatchObject({ published: true, committee: PIS });
        expect(edge!.revision_id).not.toBe("revisions/old");
      });

      it("says nothing when it has nothing to add", async () => {
        storedEdges([{ ...storedCandidacy, committee: PIS, party: "PiS" }]);
        await ingest(
          payload({
            election_year: "2024",
            committee: PIS,
            party: "PiS",
            party_from_committee: true,
          }),
        );
        expect(await all("revisions")).toEqual([]);
      });

      it("gives two committees two candidacies, not one twice", async () => {
        storedEdges([storedCandidacy, storedCandidacy]);
        await ingest(
          rows(
            {
              election_year: "2024",
              committee: PIS,
              party_from_committee: true,
            },
            {
              election_year: "2024",
              committee: "Komitet Wyborczy Nowa Lewica",
              party_from_committee: true,
            },
          ),
        );
        const revisions = await written();
        expect(revisions.map((r) => r.node_id).sort()).toEqual([
          "stored-0",
          "stored-1",
        ]);
        expect(await doc("edges", "stored-0")).toMatchObject({
          committee: PIS,
        });
        expect(await doc("edges", "stored-1")).toMatchObject({
          committee: "Komitet Wyborczy Nowa Lewica",
        });
        expect(await all("edges")).toHaveLength(2);
      });

      it("matches two repeated rows onto the two edges already stored", async () => {
        storedEdges([storedCandidacy, storedCandidacy]);
        const result = await ingest(
          rows({ election_year: "2024" }, { election_year: "2024" }),
        );
        expect(await all("revisions")).toEqual([]);
        expect(result.elections.map((e) => e.edgeId)).toEqual([
          "stored-0",
          "stored-1",
        ]);
      });

      it("still writes the row the site has no edge for", async () => {
        storedEdges([storedCandidacy, storedCandidacy]);
        const result = await ingest(
          rows(
            { election_year: "2024" },
            { election_year: "2024" },
            { election_year: "2024" },
          ),
        );
        expect(await written()).toHaveLength(1);
        const edgeIds = result.elections.map((e) => e.edgeId);
        expect(edgeIds.slice(0, 2)).toEqual(["stored-0", "stored-1"]);
        expect(edgeIds[2]).not.toBe("stored-0");
        expect(edgeIds[2]).not.toBe("stored-1");
        expect(await all("edges")).toHaveLength(3);
      });

      const enrichedThenBare = rows(
        { election_year: "2024", committee: PIS, party_from_committee: true },
        { election_year: "2024" },
      );

      it("does not let a bare row re-take the candidacy it just enriched", async () => {
        storedEdges([storedCandidacy]);
        const result = await ingest(enrichedThenBare);
        expect(await written()).toHaveLength(2);
        expect(result.elections).toHaveLength(2);
        const [enriched, created] = result.elections;
        expect(enriched!.edgeId).toBe("stored-0");
        expect(created!.edgeId).not.toBe("stored-0");
        expect(await doc("edges", "stored-0")).toMatchObject({
          committee: PIS,
        });
        expect(await all("edges")).toHaveLength(2);
      });

      it("does not create a new candidacy on top of an enriched one", async () => {
        const enrichedId = edgeDocumentId(storedCandidacy as EdgeLike, 0);
        storedEdges([storedCandidacy], [enrichedId]);
        const result = await ingest(enrichedThenBare);
        expect(result.elections[1]!.edgeId).not.toBe(enrichedId);
        expect(await doc("edges", enrichedId)).toMatchObject({
          committee: PIS,
        });
        expect(await all("edges")).toHaveLength(2);
      });

      it("maps the pipeline's row onto a candidacy a reviewer narrowed down", async () => {
        const narrowedId = edgeDocumentId(storedCandidacy as EdgeLike, 0);
        storedEdges(
          [{ ...storedCandidacy, position: "Rada gminy" }],
          [narrowedId],
        );
        const result = await ingest(payload({ election_year: "2024" }));
        expect(await all("revisions")).toEqual([]);
        expect(result.elections[0]!.edgeId).toBe(narrowedId);
        expect(await all("edges")).toHaveLength(1);
      });

      describe("a council seat won and a mayoral race lost in one town", () => {
        const committee = "KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ";
        const copy = {
          ...storedCandidacy,
          start_date: "2010-01-01",
          party: "PiS",
          committee,
        };
        const row = {
          election_year: "2010",
          party: "PiS",
          committee,
          party_from_committee: true,
        };
        const lostThenWon = rows(
          { ...row, elected: false },
          { ...row, elected: true },
        );

        it.each([
          ["the won copy sorts first", ["copy-a-won", "copy-b-lost"]],
          ["the lost copy sorts first", ["copy-b-won", "copy-a-lost"]],
        ])(
          "sends each run back to its own copy when %s",
          async (_, [wonId, lostId]) => {
            storedEdges([{ ...copy, elected: true }, copy], [wonId!, lostId!]);
            const result = await ingest(lostThenWon);
            expect(await all("revisions")).toEqual([]);
            expect(result.elections.map((e) => e.edgeId)).toEqual([
              lostId,
              wonId,
            ]);
          },
        );

        it("stores the lost run as the new copy when only the won one is stored", async () => {
          storedEdges([{ ...copy, elected: true }], ["copy-won"]);
          const result = await ingest(lostThenWon);
          const revisions = await written();
          expect(revisions).toHaveLength(1);
          expect(revisions[0]!.data).not.toHaveProperty("elected");
          const [lost, won] = result.elections;
          expect(won!.edgeId).toBe("copy-won");
          expect(lost!.edgeId).not.toBe("copy-won");
          expect(lost!.created).toBe(true);
          expect(await doc("edges", "copy-won")).toMatchObject({
            elected: true,
          });
        });

        it.each([
          ["the won copy sorts first", ["copy-a-won", "copy-b-lost"]],
          ["the lost copy sorts first", ["copy-b-won", "copy-a-lost"]],
        ])(
          "names each run's office on its own copy when %s",
          async (_, [wonId, lostId]) => {
            storedEdges([{ ...copy, elected: true }, copy], [wonId!, lostId!]);
            const result = await ingest(
              rows(
                { ...row, election_type: "Prezydent", elected: false },
                { ...row, election_type: "Rada miasta", elected: true },
              ),
            );
            const byTarget = Object.fromEntries(
              (await written()).map((r) => [r.node_id, r.data]),
            );
            expect(byTarget).toEqual({
              [wonId!]: { ...copy, position: "Rada miasta", elected: true },
              [lostId!]: { ...copy, position: "Prezydent" },
            });
            expect(await proposed()).toEqual([]);
            expect(result.elections.map((e) => e.edgeId)).toEqual([
              lostId,
              wonId,
            ]);
          },
        );
      });

      describe("the office of a stored „Samorząd” candidacy", () => {
        const kww = "KWW Nasza Gmina";
        const council = payload({
          election_type: "Rada gminy",
          election_year: "2024",
          committee: kww,
        });

        it("is written out without a reviewer: PKW's files say it", async () => {
          storedEdges([{ ...storedCandidacy, committee: kww }]);
          await ingest(council);
          expect(await proposed()).toEqual([]);
          const [revision] = await written();
          expect(revision).toMatchObject({
            node_id: "stored-0",
            status: "approved",
          });
          expect(revision!.data).toEqual({
            ...storedCandidacy,
            committee: kww,
            position: "Rada gminy",
          });
        });

        it("is written out beside a committee nobody recognised, which waits for a reviewer", async () => {
          storedEdges([storedCandidacy]);
          await ingest(council);
          const revisions = await written();
          expect(revisions).toHaveLength(1);
          expect(revisions[0]).toMatchObject({
            node_id: "stored-0",
            status: "approved",
          });
          expect(revisions[0]!.data).toEqual({
            ...storedCandidacy,
            position: "Rada gminy",
          });
          const [offer] = await proposed();
          expect(offer!.data).toEqual({
            ...storedCandidacy,
            position: "Rada gminy",
            committee: kww,
          });
        });

        it("goes out with the result, in one revision", async () => {
          storedEdges([{ ...storedCandidacy, start_date: "2010-01-01" }]);
          await ingest(
            payload({
              election_type: "Wójt",
              election_year: "2010",
              elected: true,
              committee: kww,
            }),
          );
          const revisions = await written();
          expect(revisions).toHaveLength(1);
          expect(revisions[0]!.data).toEqual({
            ...storedCandidacy,
            start_date: "2010-01-01",
            position: "Wójt",
            elected: true,
          });
          expect(await proposed()).toHaveLength(1);
        });

        it("is left in an offer a reviewer has answered", async () => {
          storedEdges([storedCandidacy]);
          await ingest(council);
          await answerProposals();
          const result = await ingest(council);
          expect(result.proposals).toEqual({ decided: 1 });
          expect(await written()).toEqual([]);
          expect(await doc("edges", "stored-0")).toEqual(storedCandidacy);
        });

        it("is not written onto a removed candidacy", async () => {
          const removed = {
            ...storedCandidacy,
            deleted: true,
            delete_reason: "duplikat",
          };
          storedEdges([removed]);
          await ingest(council);
          expect(await written()).toEqual([]);
          expect(await doc("edges", "stored-0")).toEqual(removed);
        });

        it("writes nothing more once it is stored, and offers the committee again", async () => {
          storedEdges([{ ...storedCandidacy, position: "Rada gminy" }]);
          await ingest(council);
          expect(await written()).toEqual([]);
          expect(await proposed()).toHaveLength(1);
        });
      });

      describe("a candidacy stored with no office at all", () => {
        const kww = "KWW Nasza Gmina";
        const { position: _, ...bare } = storedCandidacy;

        it("is named in a year that held only local elections", async () => {
          storedEdges([{ ...bare, start_date: "2018-01-01" }]);
          await ingest(
            payload({
              election_type: "Prezydent",
              election_year: "2018",
              committee: kww,
            }),
          );
          const revisions = await written();
          expect(revisions).toHaveLength(1);
          expect(revisions[0]!.data).toEqual({
            ...bare,
            start_date: "2018-01-01",
            position: "Prezydent",
          });
          expect((await proposed())[0]!.data).toMatchObject({
            position: "Prezydent",
            committee: kww,
          });
        });

        it("is named without a reviewer when nothing else comes with it", async () => {
          storedEdges([{ ...bare, start_date: "2018-01-01" }]);
          await ingest(
            payload({ election_type: "Prezydent", election_year: "2018" }),
          );
          expect(await proposed()).toEqual([]);
          expect((await written())[0]!.data).toEqual({
            ...bare,
            start_date: "2018-01-01",
            position: "Prezydent",
          });
        });

        it("waits for a reviewer whole in a year that held the European election too", async () => {
          storedEdges([bare]);
          await ingest(
            payload({
              election_type: "Prezydent",
              election_year: "2024",
              elected: true,
              committee: kww,
            }),
          );
          expect(await written()).toEqual([]);
          expect((await proposed())[0]!.data).toMatchObject({
            position: "Prezydent",
            elected: true,
          });
        });
      });

      it("still creates a candidacy the database does not have", async () => {
        const result = await ingest(
          payload({
            election_year: "2024",
            committee: PIS,
            party_from_committee: true,
          }),
        );
        expect(await proposed()).toEqual([]);
        expect(await written()).toHaveLength(1);
        expect(result.elections).toEqual([
          expect.objectContaining({ created: true, published: false }),
        ]);
      });

      it("says it created only the candidacy it wrote beside the stored one", async () => {
        storedEdges([storedCandidacy]);
        const result = await ingest(enrichedThenBare);
        expect(
          result.elections.map(({ created, published }) => ({
            created,
            published,
          })),
        ).toEqual([
          { created: false, published: false },
          { created: true, published: false },
        ]);
      });

      it("says nothing was created for a candidacy restated as stored", async () => {
        storedEdges([storedCandidacy]);
        const result = await ingest(payload({ election_year: "2024" }));
        expect(result.elections).toEqual([
          {
            nodeId: "teryt1465",
            edgeId: "stored-0",
            created: false,
            published: false,
          },
        ]);
      });
    });

    describe("a person the database already has", () => {
      /** The page the payload names by its id, as stored. */
      function personExists(stored: Doc, published = false) {
        table("nodes").kowalski = { type: "person", ...stored, published };
      }
      const send = (fields: Doc) =>
        ingest({
          korytaId: "kowalski",
          companies: [],
          elections: [],
          ...fields,
        });

      async function revision() {
        const revisions = await writtenOnto("kowalski");
        expect(revisions).toHaveLength(1);
        return revisions[0]!;
      }

      it("writes the party the pipeline has learned since", async () => {
        personExists({ name: "Test Person", parties: [] });
        await send({ name: "Test Person", parties: ["PiS"] });
        const r = await revision();
        expect(r).toMatchObject({
          status: "pending",
          update_automatic: true,
          data: { parties: ["PiS"] },
        });
        expect(await doc("nodes", "kowalski")).toMatchObject({
          parties: ["PiS"],
          published: false,
        });
      });

      it("leaves the person in the listings they were in", async () => {
        const stats = { isApproved: true, notesCount: 2, nodeGroupSize: 4 };
        personExists({ name: "Test Person", parties: [], stats }, true);
        await send({ name: "Test Person", parties: ["PiS"] });
        expect((await doc("nodes", "kowalski"))!.stats).toMatchObject(stats);
        expect((await revision()).data).not.toHaveProperty("stats");
      });

      it("leaves a live page live", async () => {
        personExists({ name: "Test Person", parties: [] }, true);
        await send({ name: "Test Person", parties: ["PiS"] });
        expect(await revision()).toMatchObject({
          status: "approved",
          update_automatic: true,
        });
        expect(await doc("nodes", "kowalski")).toMatchObject({
          published: true,
          parties: ["PiS"],
        });
      });

      it("leaves a draft a draft", async () => {
        personExists({ name: "Test Person", parties: [] }, false);
        await send({ name: "Test Person", parties: ["PiS"] });
        expect((await revision()).status).toBe("pending");
        expect((await doc("nodes", "kowalski"))!.published).toBe(false);
      });

      it("keeps what it already knew", async () => {
        personExists({
          name: "Test Person",
          parties: ["PO"],
          wikipedia: "https://pl.wikipedia.org/wiki/Test",
        });
        await send({ name: "Test Person", parties: ["PiS"] });
        expect((await revision()).data).toMatchObject({
          parties: ["PO", "PiS"],
          wikipedia: "https://pl.wikipedia.org/wiki/Test",
        });
      });

      it("stores „Inne” after the named parties", async () => {
        personExists({ name: "Test Person", parties: ["PiS"] });
        await send({ name: "Test Person", parties: ["Inne"] });
        expect((await revision()).data).toMatchObject({
          parties: ["PiS", "Inne"],
        });
      });

      describe("a lone „Inne”", () => {
        async function sends(stored: string[], sent: string[]) {
          personExists({ name: "Test Person", parties: stored });
          return send({ name: "Test Person", parties: sent });
        }
        const writtenParties = async () =>
          ((await revision()).data as { parties: string[] }).parties;

        it("gives way to a party the payload names", async () => {
          await sends(["Inne"], ["PiS"]);
          expect(await writtenParties()).toEqual(["PiS"]);
        });

        it("stays where the payload names it too", async () => {
          await sends(["Inne"], ["PiS", "Inne"]);
          expect(await writtenParties()).toEqual(["PiS", "Inne"]);
        });

        it("stays where the payload names no party", async () => {
          const result = await sends(["Inne"], []);
          expect(await all("revisions")).toEqual([]);
          expect(result).toMatchObject({ person: "unchanged" });
        });

        it("is not one beside a named party, which keeps it", async () => {
          await sends(["PO", "Inne"], ["PiS"]);
          expect(await writtenParties()).toEqual(["PO", "PiS", "Inne"]);
        });
      });

      it("leaves a hand-curated list of parties alone", async () => {
        personExists({
          name: "Test Person",
          parties: ["PO"],
          partiesSource: "manual",
        });
        const result = await send({ name: "Test Person", parties: ["SLD"] });
        expect(await all("revisions")).toEqual([]);
        expect(result).toMatchObject({ person: "unchanged" });
      });

      it("still learns the other fields on a person whose parties are pinned", async () => {
        personExists({
          name: "Test Person",
          parties: ["PO"],
          partiesSource: "manual",
        });
        await send({
          name: "Test Person",
          parties: ["SLD"],
          wikipedia: "https://pl.wikipedia.org/wiki/Test",
        });
        expect((await revision()).data).toMatchObject({
          parties: ["PO"],
          wikipedia: "https://pl.wikipedia.org/wiki/Test",
        });
      });

      it("stores a birth date it has learned, once", async () => {
        personExists({
          name: "Test Person",
          parties: [],
          rejestrIo: "https://rejestr.io/osoby/1",
        });
        const body = {
          name: "Test Person",
          rejestrIo: "https://rejestr.io/osoby/1",
          birthDate: "1967-09-20",
          companies: [],
          elections: [],
        };
        await ingest(body);
        expect((await revision()).data).toMatchObject({
          birthDate: "1967-09-20",
        });
        expect((await doc("nodes", "kowalski"))!.birthDate).toBe("1967-09-20");
      });

      it("writes in the middle name the register knows and the page left out", async () => {
        personExists({ name: "Antoni Sikoń", parties: [] });
        await send({ name: "Antoni Ignacy Sikoń" });
        expect((await revision()).data).toMatchObject({
          name: "Antoni Ignacy Sikoń",
        });
      });

      it.each([
        ["Władysław Kosiniak Kamysz", "Władysław Kosiniak-Kamysz"],
        ["Anna Nowak Rudnik", "Anna Maria Nowak-Rudnik"],
      ])("writes the hyphen into %s: %s", async (stored, sent) => {
        personExists({ name: stored, parties: [] }, true);
        await send({ name: sent });
        expect(await revision()).toMatchObject({
          status: "approved",
          update_automatic: true,
          data: { name: sent },
        });
      });

      it.each([
        ["Antoni Ignacy Sikoń", "Antoni Sikoń"],
        ["Anna Kowalska", "Anna Maria Nowak"],
        ["Kamil Barczyk", "KAMIL SEBASTIAN BARCZYK"],
        ["Anna Nowak-Rudnik", "Anna Nowak Rudnik"],
        ["Anna Nowak Rudnik", "Anna Nowak-Rudnicka"],
      ])("leaves %s alone when the payload says %s", async (stored, sent) => {
        personExists({ name: stored, parties: [] });
        await send({ name: sent });
        expect(await all("revisions")).toEqual([]);
        expect((await doc("nodes", "kowalski"))!.name).toBe(stored);
      });

      it("does not rewrite a birth date the node already carries", async () => {
        personExists({
          name: "Test Person",
          parties: [],
          birthDate: "1967-09-21",
          rejestrIo: "https://rejestr.io/osoby/1",
        });
        await ingest({
          name: "Test Person",
          rejestrIo: "https://rejestr.io/osoby/1",
          birthDate: "1967-09-20",
          companies: [],
          elections: [],
        });
        expect(await all("revisions")).toEqual([]);
        expect((await doc("nodes", "kowalski"))!.birthDate).toBe("1967-09-21");
      });

      it.each([
        ["refuses a mangled birth date rather than storing it", "1967"],
        [
          "refuses a birth date a format check alone would let through",
          "0202-05-27",
        ],
      ])("%s", async (_, birthDate) => {
        personExists({ name: "Test Person", parties: [] });
        expect(await statusOf(send({ name: "Test Person", birthDate }))).toBe(
          400,
        );
        expect(await all("revisions")).toEqual([]);
      });
    });

    describe("a candidacy the site cannot place", () => {
      const newPersonWith = (elections: Doc[]) =>
        ingest({
          name: "Test Person",
          parties: [],
          companies: [],
          elections,
        });

      it("keeps the person when a candidacy names no region", async () => {
        const result = await newPersonWith([
          { election_type: "Samorząd", election_year: "2010" },
        ]);
        expect(result.status).toBe("ok");
        expect(await doc("nodes", result.personId)).toMatchObject({
          name: "Test Person",
        });
        expect(await all("edges")).toEqual([]);
        expect(result.elections).toEqual([]);
        expect(result.unplacedElections).toEqual([
          {
            election_type: "Samorząd",
            election_year: "2010",
            reason: "no-teryt",
            expected: false,
          },
        ]);
      });

      it("marks the elections nobody published a constituency for as expected", async () => {
        const result = await newPersonWith([
          { election_type: "Sejm", election_year: "1993" },
        ]);
        expect(result.unplacedElections).toEqual([
          {
            election_type: "Sejm",
            election_year: "1993",
            reason: "no-teryt",
            expected: true,
          },
        ]);
      });

      it("reports a European candidacy without a district as unexpected", async () => {
        const result = await newPersonWith([
          { election_type: "Parlament Europejski", election_year: "2014" },
        ]);
        expect(result.unplacedElections).toEqual([
          {
            election_type: "Parlament Europejski",
            election_year: "2014",
            reason: "no-teryt",
            expected: false,
          },
        ]);
      });

      it("keeps the person when the region node does not exist yet", async () => {
        const result = await newPersonWith([
          { election_type: "Samorząd", election_year: "2024", teryt: "9999" },
        ]);
        expect(result.status).toBe("ok");
        expect(await doc("nodes", result.personId)).toBeDefined();
        expect(result.unplacedElections).toEqual([
          {
            election_type: "Samorząd",
            election_year: "2024",
            teryt: "9999",
            reason: "no-region",
            expected: false,
          },
        ]);
      });

      it("writes the candidacies it can place beside the ones it cannot", async () => {
        table("nodes").teryt1465 = region("1465");
        const result = await newPersonWith([
          { election_type: "Samorząd", election_year: "2010" },
          { election_type: "Samorząd", election_year: "2024", teryt: "1465" },
        ]);
        expect(result.elections).toHaveLength(1);
        expect(result.elections[0]).toMatchObject({ nodeId: "teryt1465" });
        expect(result.unplacedElections).toHaveLength(1);
        expect(await all("edges")).toHaveLength(1);
      });

      it("says nothing about candidacies when every one was placed", async () => {
        table("nodes").teryt1465 = region("1465");
        const result = await newPersonWith([
          { election_type: "Samorząd", election_year: "2024", teryt: "1465" },
        ]);
        expect(result).not.toHaveProperty("unplacedElections");
      });
    });

    describe("a district's candidacy filed under the candidate's home", () => {
      const entry = "https://rejestr.io/osoby/123";
      const PIS_CAPS = "KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ";

      beforeEach(() => {
        Object.assign(table("nodes"), {
          kowalski: person("Jan Kowalski", {
            rejestrIo: entry,
            published: true,
          }),
          teryt14: region("14", { name: "mazowieckie", published: undefined }),
          teryt1465: region("1465", { name: "Warszawa", published: undefined }),
          teryt10: region("10", { name: "łódzkie", published: undefined }),
          teryt1061: region("1061", { name: "Łódź", published: undefined }),
        });
      });

      const send = (...elections: Doc[]) =>
        ingest({
          name: "Jan Kowalski",
          rejestrIo: entry,
          parties: [],
          companies: [],
          elections,
        });

      /** A 2019 European run in district 4, filed under mazowieckie. */
      const european = (fields: Doc = {}) => ({
        election_type: "Parlament Europejski",
        election_year: "2019",
        teryt: "14",
        committee: PIS_CAPS,
        party: "PiS",
        party_from_committee: true,
        ...fields,
      });

      /** The same run filed under Warszawa, where the candidate lives, and
       * live on the page. */
      function storedAtHome(fields: Doc = {}) {
        const edge: Doc = Object.fromEntries(
          Object.entries<unknown>({
            type: "election",
            name: "kandydatura",
            source: "kowalski",
            target: "teryt1465",
            position: "Parlament Europejski",
            start_date: "2019-01-01",
            published: true,
            revision_id: "revisions/at-home-approved",
            ...fields,
          }).filter(([, v]) => v !== undefined),
        );
        table("edges")["at-home"] = edge;
        return edge;
      }

      it("moves it to the district, live as it was", async () => {
        storedAtHome();
        const result = await send(european());
        const moves = await writtenOnto("at-home");
        expect(moves).toHaveLength(1);
        expect(moves[0]).toMatchObject({
          status: "approved",
          update_automatic: true,
          data: {
            target: "teryt14",
            position: "Parlament Europejski",
            start_date: "2019-01-01",
            committee: PIS_CAPS,
            party: "PiS",
          },
        });
        expect(await doc("edges", "at-home")).toMatchObject({
          target: "teryt14",
          published: true,
        });
        expect(await createdEdges()).toEqual([]);
        expect(result.elections).toEqual([
          {
            nodeId: "teryt14",
            edgeId: "at-home",
            created: false,
            published: false,
          },
        ]);
      });

      it("leaves a committee nobody vouched for to the next send", async () => {
        storedAtHome();
        await send(
          european({
            committee: "KWW NOWA LISTA",
            party: undefined,
            party_from_committee: false,
          }),
        );
        const [move] = await writtenOnto("at-home");
        expect(move!.data).toMatchObject({ target: "teryt14" });
        expect(move!.data).not.toHaveProperty("committee");
        expect(await createdEdges()).toEqual([]);
      });

      it("leaves a run for another committee where it is", async () => {
        storedAtHome({
          committee: "KOMITET WYBORCZY WIOSNA ROBERTA BIEDRONIA",
        });
        await send(european());
        expect(await writtenOnto("at-home")).toEqual([]);
        expect(await createdEdges()).toHaveLength(1);
      });

      it("leaves a removed run as its reviewer left it", async () => {
        const removed = storedAtHome({
          deleted: true,
          delete_reason: "duplikat",
          published: false,
        });
        await send(european());
        expect(await writtenOnto("at-home")).toEqual([]);
        expect(await doc("edges", "at-home")).toEqual(removed);
        expect(await createdEdges()).toHaveLength(1);
      });

      it("moves nothing once the year is filed in its district", async () => {
        const atHome = storedAtHome();
        table("edges")["in-district"] = {
          ...atHome,
          target: "teryt14",
          committee: PIS_CAPS,
          party: "PiS",
        };
        await send(european());
        expect(await writtenOnto("at-home")).toEqual([]);
        expect(await createdEdges()).toEqual([]);
      });

      it("never moves another office's run", async () => {
        storedAtHome({ position: "Sejm" });
        await send(european());
        expect(await writtenOnto("at-home")).toEqual([]);
        expect(await createdEdges()).toHaveLength(1);
      });

      describe("a Sejm or Senate run", () => {
        const TD =
          "KOALICYJNY KOMITET WYBORCZY TRZECIA DROGA POLSKA 2050 SZYMONA HOŁOWNI - POLSKIE STRONNICTWO LUDOWE";
        /** A 2023 run in district 9, filed under łódzkie. */
        const sejm = (fields: Doc = {}) =>
          european({
            election_type: "Sejm",
            election_year: "2023",
            teryt: "10",
            committee: TD,
            party: undefined,
            party_from_committee: true,
            ...fields,
          });
        /** The same run filed under Łódź, where PKW's list says he lives. */
        const sejmAtHome = (fields: Doc = {}) =>
          storedAtHome({
            target: "teryt1061",
            position: "Sejm",
            start_date: "2023-01-01",
            ...fields,
          });

        it("moves it to its district's województwo, live as it was", async () => {
          sejmAtHome();
          const result = await send(sejm());
          const moves = await writtenOnto("at-home");
          expect(moves).toHaveLength(1);
          expect(moves[0]).toMatchObject({
            status: "approved",
            data: { target: "teryt10", position: "Sejm", committee: TD },
          });
          expect(await doc("edges", "at-home")).toMatchObject({
            target: "teryt10",
            published: true,
          });
          expect(await createdEdges()).toEqual([]);
          expect(result.elections).toEqual([
            {
              nodeId: "teryt10",
              edgeId: "at-home",
              created: false,
              published: false,
            },
          ]);
        });

        it("moves a Senate run the same way", async () => {
          sejmAtHome({ position: "Senat" });
          await send(sejm({ election_type: "Senat" }));
          expect((await writtenOnto("at-home"))[0]!.data).toMatchObject({
            target: "teryt10",
            position: "Senat",
          });
          expect(await createdEdges()).toEqual([]);
        });

        it("moves a 2023 copy stored without its office, the one election of that year", async () => {
          sejmAtHome({ position: undefined });
          await send(sejm());
          expect((await writtenOnto("at-home"))[0]!.data).toMatchObject({
            target: "teryt10",
            position: "Sejm",
          });
          expect(await createdEdges()).toEqual([]);
        });

        it("names a copy stored without its office as it moves it, whatever the committee", async () => {
          sejmAtHome({ position: undefined });
          await send(
            sejm({
              committee: "KOMITET WYBORCZY WYBORCÓW NOWA LISTA",
              party_from_committee: false,
            }),
          );
          const moves = await writtenOnto("at-home");
          expect(moves).toHaveLength(1);
          expect(moves[0]!.data).toMatchObject({
            target: "teryt10",
            position: "Sejm",
          });
          expect(moves[0]!.data).not.toHaveProperty("committee");
          expect(await createdEdges()).toEqual([]);
        });

        it("leaves a 2019 copy without its office, which could be the European run", async () => {
          sejmAtHome({ position: undefined, start_date: "2019-01-01" });
          await send(sejm({ election_year: "2019" }));
          expect(await writtenOnto("at-home")).toEqual([]);
          expect(await createdEdges()).toHaveLength(1);
        });

        it("leaves a home outside the district's województwo for a reviewer", async () => {
          sejmAtHome({ target: "teryt1465" });
          await send(sejm());
          expect(await writtenOnto("at-home")).toEqual([]);
          expect(await createdEdges()).toHaveLength(1);
        });

        it("moves nothing once the run is stored in its district as well", async () => {
          const atHome = sejmAtHome();
          table("edges")["in-district"] = {
            ...atHome,
            target: "teryt10",
            committee: TD,
            published: false,
          };
          await send(sejm());
          expect(await writtenOnto("at-home")).toEqual([]);
          expect(await createdEdges()).toEqual([]);
        });
      });

      describe("a sejmik run stored at home as „Samorząd”", () => {
        const KKW = "KKW TRZECIA DROGA PSL-PL2050 SZYMONA HOŁOWNI";
        /** A 2024 sejmik run as the payload places it. */
        const SEJMIK = {
          election_type: "Sejmik",
          election_year: "2024",
          teryt: "10",
          committee: KKW,
          party_from_committee: true,
        };
        /** The same run stored as „Samorząd”, under Łódź. */
        const sejmikAtHome = (fields: Doc = {}) =>
          storedAtHome({
            target: "teryt1061",
            position: "Samorząd",
            start_date: "2024-01-01",
            ...fields,
          });

        it("moves it to the województwo and names it, as the year's only local run", async () => {
          sejmikAtHome();
          await send(SEJMIK);
          const moves = await writtenOnto("at-home");
          expect(moves).toHaveLength(1);
          expect(moves[0]!.data).toMatchObject({
            target: "teryt10",
            position: "Sejmik",
            committee: KKW,
          });
          expect(await createdEdges()).toEqual([]);
        });

        it("names it as it moves it, beside a committee nobody vouched for", async () => {
          sejmikAtHome();
          await send({
            ...SEJMIK,
            committee: "KWW ŁÓDŹ",
            party_from_committee: false,
          });
          const moves = await writtenOnto("at-home");
          expect(moves).toHaveLength(1);
          expect(moves[0]!.data).toMatchObject({
            target: "teryt10",
            position: "Sejmik",
          });
          expect(moves[0]!.data).not.toHaveProperty("committee");
          expect(await createdEdges()).toEqual([]);
        });

        it("leaves it to the council run the payload also has that year", async () => {
          sejmikAtHome();
          await send(SEJMIK, {
            ...SEJMIK,
            election_type: "Rada miasta",
            teryt: "1061",
          });
          const renames = await writtenOnto("at-home");
          expect(renames).toHaveLength(1);
          expect(renames[0]!.data).toMatchObject({
            target: "teryt1061",
            position: "Rada miasta",
          });
          expect(await createdEdges()).toHaveLength(1);
        });

        it("leaves a 2024 copy with no office, which could be the European run", async () => {
          sejmikAtHome({ position: undefined });
          await send(SEJMIK);
          expect(await writtenOnto("at-home")).toEqual([]);
          expect(await createdEdges()).toHaveLength(1);
        });
      });
    });
  },
);
