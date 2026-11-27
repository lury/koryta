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
import { edgeDocumentId } from "~~/server/utils/edges";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** POST /api/ingest/person on Postgres: who may send a person, which page a
 * payload lands on, and what it writes about the person's jobs, sources and
 * candidacies - read as the request found the database, written at the end
 * in one transaction.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/ingestPerson.pg.test.ts
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
  // The 404 status itself is set through h3; the body is what is checked.
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
type Answer = {
  personId: string;
  person: string;
  companies: Doc[];
  articles: Doc[];
  elections: Doc[];
  unplacedElections?: Doc[];
  unplacedEmployments?: Doc[];
  proposals?: Record<string, number>;
  droppedChanges?: Doc[];
  status: string;
  message?: string;
  data?: string[];
};

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

const PIPELINE = "pipeline,datascience";

async function ingest(body: Doc, as: string | null = PIPELINE) {
  await store.sync(sql);
  const event = {
    headers: as ? { authorization: as } : {},
    context: {},
    body,
  } as TestEvent;
  return (handler as unknown as (e: TestEvent) => Promise<Answer>)(event);
}

/** The database as it is now becomes what the next call starts from. */
async function keep() {
  store.clear();
  for (const [name, t] of [
    ["nodes", "nodes"],
    ["edges", "edges"],
    ["revisions", "revisions"],
  ] as const) {
    for (const row of await sql<{ id: string; data: Doc }[]>`
      SELECT id, data FROM ${sql(t)}`)
      table(name)[row.id] = row.data;
  }
}

async function doc(t: "nodes" | "edges" | "revisions", id: string) {
  const [row] = await sql<{ data: Doc }[]>`
    SELECT data FROM ${sql(t)} WHERE id = ${id}`;
  return row?.data;
}

async function all(t: "nodes" | "edges" | "revisions") {
  return sql<{ id: string; data: Doc }[]>`
    SELECT id, data FROM ${sql(t)} ORDER BY id`;
}

const person = (name: string, fields: Doc = {}) => ({
  type: "person",
  name,
  parties: [],
  ...fields,
});
const place = (krs: string, fields: Doc = {}) => ({
  type: "place",
  name: `Spółka ${krs}`,
  krsNumber: krs,
  published: true,
  ...fields,
});
const region = (teryt: string) => ({
  type: "region",
  name: `Region ${teryt}`,
  teryt,
  published: true,
});

const payload = (fields: Doc = {}) => ({
  name: "Jan Kowalski",
  parties: [],
  companies: [],
  ...fields,
});

describe.runIf(PG_TEST_DATABASE_URL)("POST /api/ingest/person", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("ingest_person");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
  });

  it("takes a person from the datascience group only, with a name", async () => {
    expect(await statusOf(ingest(payload(), null))).toBe(401);
    expect(await statusOf(ingest(payload(), "reader,admin"))).toBe(403);
    expect(await statusOf(ingest({ companies: [] }))).toBe(400);
    expect(await statusOf(ingest(payload({ birthDate: "2026-02-31x" })))).toBe(
      400,
    );
    expect(await all("nodes")).toEqual([]);
  });

  it("creates a person with their job, source and candidacy, for review", async () => {
    Object.assign(table("nodes"), {
      orlen: place("0000028860"),
      teryt1465: region("1465"),
    });
    const answer = await ingest(
      payload({
        parties: ["PSL"],
        rejestrIo: "https://rejestr.io/osoby/1/jan-kowalski",
        companies: [{ krs: "0000028860", role: "prezes", start: "2020-01-01" }],
        sources: ["https://example.com/artykul"],
        elections: [
          {
            election_type: "Rada miasta",
            election_year: "2024",
            teryt: "1465",
            committee: "KW Prawo i Sprawiedliwość",
            elected: true,
          },
        ],
      }),
    );
    const job = edgeDocumentId({
      source: answer.personId,
      target: "orlen",
      type: "employed",
      name: "prezes",
      start_date: "2020-01-01",
    });
    expect(answer).toMatchObject({
      person: "created",
      status: "ok",
      companies: [
        {
          nodeId: "orlen",
          krs: "0000028860",
          created: true,
          published: false,
          edgeId: job,
        },
      ],
      articles: [{ created: true }],
      elections: [{ created: true }],
    });
    expect(answer).not.toHaveProperty("proposals");
    expect(await doc("nodes", answer.personId)).toMatchObject({
      name: "Jan Kowalski",
      type: "person",
      parties: ["PSL"],
      published: false,
      stats: { nodeGroupSize: 0, isApproved: false, factsCount: 0 },
    });
    expect(await doc("edges", job)).toMatchObject({
      source: answer.personId,
      target: "orlen",
      type: "employed",
      published: false,
    });
    const article = String(answer.articles[0]!.nodeId);
    expect(await doc("nodes", article)).toMatchObject({
      type: "article",
      sourceURL: "https://example.com/artykul",
    });
    const candidacy = await doc("edges", String(answer.elections[0]!.edgeId));
    expect(candidacy).toMatchObject({
      target: "teryt1465",
      type: "election",
      position: "Rada miasta",
      committee: "KW Prawo i Sprawiedliwość",
      elected: true,
    });
    const revisions = await all("revisions");
    expect(revisions).toHaveLength(5);
    expect(revisions.every(({ data }) => data.status === "pending")).toBe(true);
    expect(revisions.every(({ data }) => data.update_automatic === true)).toBe(
      true,
    );
  });

  it("puts what it creates live with autoapprove, and writes nothing twice", async () => {
    table("nodes").orlen = place("0000028860");
    const body = payload({
      autoapprove: true,
      rejestrIo: "1",
      companies: [{ krs: "0000028860", role: "prezes" }],
    });
    const first = await ingest(body);
    expect(first.companies[0]).toMatchObject({
      created: true,
      published: true,
    });
    expect(await doc("nodes", first.personId)).toMatchObject({
      published: true,
    });
    await keep();
    const before = (await all("revisions")).length;
    const again = await ingest(body);
    expect(again).toMatchObject({
      personId: first.personId,
      person: "unchanged",
      companies: [{ created: false, edgeId: first.companies[0]!.edgeId }],
    });
    expect(await all("revisions")).toHaveLength(before);
    expect(await all("edges")).toHaveLength(1);
  });

  it("answers 404 with the missing companies, unless the uploader reads the report", async () => {
    table("nodes").orlen = place("0000028860");
    const companies = [
      { krs: "0000028860", role: "prezes" },
      { krs: "0000000404", role: "członek zarządu" },
    ];
    const refused = await ingest(payload({ companies }));
    expect(refused).toEqual({
      message: "Missing companies: 0000000404",
      data: ["0000000404"],
    });
    expect((await all("nodes")).map((n) => n.id)).toEqual(["orlen"]);

    const placed = await ingest(
      payload({ companies, reportUnplacedEmployments: true }),
    );
    expect(placed).toMatchObject({
      person: "created",
      companies: [{ nodeId: "orlen", created: true }],
      unplacedEmployments: [
        { krs: "0000000404", reason: "no-company", role: "członek zarządu" },
      ],
    });
  });

  it("reports the candidacies it cannot place and keeps the person", async () => {
    const answer = await ingest(
      payload({
        elections: [
          { election_type: "Rada miasta", election_year: "2024" },
          {
            election_type: "Rada miasta",
            election_year: "2024",
            teryt: "9999",
          },
        ],
      }),
    );
    expect(answer.person).toBe("created");
    expect(answer.elections).toEqual([]);
    expect(answer.unplacedElections).toEqual([
      expect.objectContaining({ reason: "no-teryt" }),
      expect.objectContaining({ reason: "no-region", teryt: "9999" }),
    ]);
  });

  describe("a person the database already has", () => {
    const live = person("Jan Kowalski", {
      parties: ["PSL"],
      rejestrIo: "https://rejestr.io/osoby/1",
      published: true,
      revision_id: "revisions/r1",
      stats: { nodeGroupSize: 7, isApproved: true, factsCount: 3 },
    });

    it("learns a party on a live page and keeps it live and listed", async () => {
      table("nodes").kowalski = live;
      const answer = await ingest(payload({ rejestrIo: "1", parties: ["KO"] }));
      expect(answer).toMatchObject({ personId: "kowalski", person: "updated" });
      const stored = await doc("nodes", "kowalski");
      expect(stored).toMatchObject({
        published: true,
        stats: { nodeGroupSize: 7, isApproved: true, factsCount: 3 },
      });
      expect(stored!.parties).toEqual(expect.arrayContaining(["PSL", "KO"]));
      const [revision] = (await all("revisions")).map((r) => r.data);
      expect(revision).toMatchObject({
        status: "approved",
        node_id: "kowalski",
      });
    });

    it("writes nothing when it has nothing new to say", async () => {
      table("nodes").kowalski = live;
      expect(
        await ingest(
          payload({
            rejestrIo: "https://rejestr.io/osoby/1",
            parties: ["PSL"],
          }),
        ),
      ).toMatchObject({ personId: "kowalski", person: "unchanged" });
      expect(await all("revisions")).toEqual([]);
    });

    it("gives a second register entry its own page", async () => {
      table("nodes").kowalski = live;
      const answer = await ingest(payload({ rejestrIo: "2" }));
      expect(answer.personId).not.toBe("kowalski");
      expect(answer.person).toBe("created");
    });

    it("follows a page merged away, by its id or by its entry", async () => {
      Object.assign(table("nodes"), {
        old: person("Jan Kowalski", {
          rejestrIo: "1",
          merged_into: "kowalski",
        }),
        kowalski: live,
      });
      expect((await ingest(payload({ korytaId: "old" }))).personId).toBe(
        "kowalski",
      );
      expect((await ingest(payload({ rejestrIo: "1" }))).personId).toBe(
        "kowalski",
      );
    });

    it("holds back a payload whose korytaId page stores another birth date", async () => {
      table("nodes").kowalski = person("Jan Kowalski", {
        birthDate: "1970-01-01",
      });
      expect(
        await statusOf(
          ingest(payload({ korytaId: "kowalski", birthDate: "1980-02-02" })),
        ),
      ).toBe(409);
      expect((await all("nodes")).map((n) => n.id)).toEqual(["kowalski"]);
    });

    it("finds a page by its name and birth date, and holds back two of them", async () => {
      Object.assign(table("nodes"), {
        a: person("Anna Nowak", { birthDate: "1980-02-02" }),
        b: person("Anna Nowak", { birthDate: "1975-05-05" }),
        article: { type: "article", name: "Anna Nowak", sourceURL: "x" },
      });
      expect(
        (await ingest(payload({ name: "Anna Nowak", birthDate: "1980-02-02" })))
          .personId,
      ).toBe("a");
      table("nodes").c = person("Anna Nowak", { birthDate: "1980-02-02" });
      expect(
        await statusOf(
          ingest(payload({ name: "Anna Nowak", birthDate: "1980-02-02" })),
        ),
      ).toBe(409);
    });

    it("holds back a dated payload where a namesake's page stores no date", async () => {
      table("nodes").a = person("Anna Nowak");
      expect(
        await statusOf(
          ingest(payload({ name: "Anna Nowak", birthDate: "1980-02-02" })),
        ),
      ).toBe(409);
    });
  });

  describe("a candidacy the database already has", () => {
    const stored = {
      source: "kowalski",
      target: "teryt1465",
      type: "election",
      name: "kandydatura",
      position: "Samorząd",
      start_date: "2024-01-01",
    };
    const elect = (fields: Doc) =>
      payload({
        elections: [
          {
            election_type: "Samorząd",
            teryt: "1465",
            election_year: "2024",
            ...fields,
          },
        ],
      });

    beforeEach(() => {
      Object.assign(table("nodes"), {
        kowalski: person("Jan Kowalski"),
        teryt1465: region("1465"),
      });
      table("edges")["stored-0"] = stored;
    });

    it("writes the result onto it, approved", async () => {
      const answer = await ingest(elect({ elected: true }));
      expect(answer.elections).toEqual([
        expect.objectContaining({ edgeId: "stored-0", created: false }),
      ]);
      expect(await all("edges")).toHaveLength(1);
      expect(await doc("edges", "stored-0")).toMatchObject({
        ...stored,
        elected: true,
      });
      const [revision] = (await all("revisions")).map((r) => r.data);
      expect(revision).toMatchObject({
        node_id: "stored-0",
        status: "approved",
      });
    });

    it("leaves an unrecognised committee for a reviewer, and says so", async () => {
      const answer = await ingest(
        elect({ elected: true, committee: "KWW Nasza Gmina" }),
      );
      expect(answer.proposals).toEqual({ created: 1 });
      expect(await doc("edges", "stored-0")).not.toHaveProperty("committee");
      const revisions = (await all("revisions")).map((r) => r.data);
      expect(revisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "pending", collection: "edges" }),
          expect.objectContaining({ status: "approved" }),
        ]),
      );
      // The same offer again is not a new one.
      await keep();
      expect(
        (await ingest(elect({ elected: true, committee: "KWW Nasza Gmina" })))
          .proposals,
      ).toEqual({ unchanged: 1 });
    });
  });

  describe("jobs from the register entry a published page links", () => {
    const entry = "https://rejestr.io/osoby/1";
    beforeEach(() => {
      Object.assign(table("nodes"), {
        kowalski: person("Jan Kowalski", {
          rejestrIo: entry,
          published: true,
          stats: { nodeGroupSize: 1, isApproved: true, factsCount: 0 },
          revision_id: "revisions/r1",
        }),
        orlen: place("1"),
        pkn: place("2"),
      });
      table("edges").shown = {
        source: "kowalski",
        target: "orlen",
        type: "employed",
        name: "prezes",
        published: true,
      };
    });

    it("publishes a new job of a verified person, and a waiting one it restates", async () => {
      table("edges").waiting = {
        source: "kowalski",
        target: "pkn",
        type: "employed",
        name: "członek rady",
        published: false,
      };
      table("revisions").w1 = {
        node_id: "waiting",
        collection: "edges",
        status: "pending",
        update_automatic: true,
        update_user: "pipeline",
        update_time: "2026-01-01T00:00:00.000Z",
        data: {
          source: "kowalski",
          target: "pkn",
          type: "employed",
          name: "członek rady",
        },
      };
      const answer = await ingest(
        payload({
          rejestrIo: "1",
          companies: [
            { krs: "1", role: "prezes" },
            { krs: "2", role: "członek rady" },
            { krs: "1", role: "wiceprezes", start: "2010-01-01" },
          ],
        }),
      );
      expect(answer.companies).toEqual([
        expect.objectContaining({
          edgeId: "shown",
          created: false,
          published: false,
        }),
        expect.objectContaining({
          edgeId: "waiting",
          created: false,
          published: true,
        }),
        expect.objectContaining({ created: true, published: true }),
      ]);
      expect(await doc("edges", "waiting")).toMatchObject({
        published: true,
        revision_id: "revisions/w1",
      });
      expect((await doc("revisions", "w1"))?.status).toBe("approved");
    });

    it("leaves the jobs of a page whose entry the payload does not name", async () => {
      const answer = await ingest(
        payload({
          companies: [
            { krs: "1", role: "prezes" },
            { krs: "2", role: "członek rady" },
          ],
        }),
      );
      expect(answer.companies[1]).toMatchObject({
        created: true,
        published: false,
      });
    });

    it("writes the end a live job learns, approved, and reports one it keeps", async () => {
      table("edges").shown!.end_date = "2022-12-31";
      const answer = await ingest(
        payload({
          rejestrIo: "1",
          companies: [{ krs: "1", role: "prezes", end: "2023-06-30" }],
        }),
      );
      expect(answer.droppedChanges).toEqual([
        expect.objectContaining({
          edgeId: "shown",
          field: "end_date",
          stored: "2022-12-31",
          sent: "2023-06-30",
          reason: "kept",
          krs: "1",
        }),
      ]);
      table("edges").shown = {
        source: "kowalski",
        target: "orlen",
        type: "employed",
        name: "prezes",
        published: true,
      };
      await ingest(
        payload({
          rejestrIo: "1",
          companies: [{ krs: "1", role: "prezes", end: "2023-06-30" }],
        }),
      );
      expect(await doc("edges", "shown")).toMatchObject({
        end_date: "2023-06-30",
        published: true,
      });
    });
  });
});
