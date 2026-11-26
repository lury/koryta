import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { useRuntimeConfig } from "#app";
import ingest from "~~/server/api/ingest/declarations.post";
import next from "~~/server/api/declarations/next.get";
import answer from "~~/server/api/declarations/[id]/answer.post";
import images from "~~/server/api/declarations/[id]/images.get";
import progress from "~~/server/api/declarations/progress.get";
import found from "~~/server/api/declarations/found.get";
import claim from "~~/server/api/declarations/claim.post";
import people from "~~/server/api/declarations/people.get";
import overview from "~~/server/api/declarations/overview.get";
import settle from "~~/server/api/declarations/[id]/settle.post";
import withdraw from "~~/server/api/declarations/[id]/withdraw.post";
import publishQueued from "~~/server/api/declarations/publish-queued.post";
import sweep from "~~/server/api/declarations/sweep.post";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/**
 * The declarations feature end to end on Postgres: one upload of crops
 * through /api/ingest/declarations, then readers asking for crops and
 * answering them until crops agree, settle as unreadable, publish a draft,
 * link a public page and flag another date; a browser's answers claimed by
 * an account; an admin's decisions, a sweep and the queue pressed; and six
 * readers answering one crop at the same moment. The flow of
 * tests/parity/declarations.parity.test.ts, which compared it with
 * Firestore, asserted here on what it leaves.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationFlow.pg.test.ts
 */

const NOW = new Date("2026-11-26T11:00:00.000Z");
const BORN = "1979-07-15";

type Event = {
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  params: Record<string, string>;
  context: Record<string, unknown>;
};
type Handler = (event: Event) => Promise<unknown>;

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.defineCachedFunction = (fn: unknown) => fn;
  g.defineCachedEventHandler = (fn: unknown) => fn;
  g.defineEventHandler = (fn: unknown) => fn;
  g.createError = (err: { message?: string; statusCode?: number }) =>
    Object.assign(new Error(err.message ?? ""), err);
  g.useStorage = () => ({ clear: async () => {}, removeItem: async () => {} });
  // What the server code has auto-imported, as the handlers' events carry it.
  type E = {
    headers: Record<string, string>;
    query: Record<string, string>;
    params: Record<string, string>;
    body?: unknown;
  };
  g.getRequestHeader = (event: E, name: string) =>
    event.headers[name.toLowerCase()];
  g.getRouterParam = (event: E, name: string) => event.params[name];
  g.getQuery = (event: E) => event.query;
  g.getValidatedQuery = async (event: E, parse: (q: unknown) => unknown) =>
    parse(event.query);
  g.setResponseHeader = () => {};
  g.readValidatedBody = async (event: E, parse: (raw: unknown) => unknown) =>
    parse(event.body);
  g.readBody = async (event: E) => event.body;
});

vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getQuery: (event: Event) => event.query,
  getRouterParam: (event: Event, name: string) => event.params[name],
  getRequestHeader: (event: Event, name: string) =>
    event.headers[name.toLowerCase()],
  setResponseHeader: () => {},
  readValidatedBody: async (event: Event, parse: (raw: unknown) => unknown) =>
    parse(event.body),
}));

// `Bearer <uid>` is that account, its address confirmed; `admin` and
// `pipeline` hold their claims.
vi.mock("~~/server/utils/auth", () => {
  const userOf = (event: Event) => {
    const header = event.headers.authorization;
    if (!header) throw Object.assign(new Error("401"), { statusCode: 401 });
    const uid = header.replace("Bearer ", "");
    return {
      uid,
      email_verified: true,
      firebase: { sign_in_provider: "password" },
      admin: uid === "admin",
      datascience: uid === "pipeline" || uid === "admin",
    };
  };
  return {
    getUser: async (event: Event) => userOf(event),
    getOptionalUser: async (event: Event) =>
      event.headers.authorization ? userOf(event) : null,
    requireAdmin: async (event: Event) => userOf(event),
    requireDatascience: (user: unknown) => user,
  };
});
vi.mock("~~/server/utils/cachedResponses", () => ({
  dropCachedResponses: async () => {},
}));

// --- the fixture -----------------------------------------------------------

const sha = (label: string) => createHash("sha256").update(label).digest("hex");

function png(width: number, height: number, seed: number): string {
  const bytes = new Uint8Array(28);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  new DataView(bytes.buffer).setUint32(24, seed);
  return Buffer.from(bytes).toString("base64");
}

const UNIT = {
  teryt: "021704",
  unitName: "Strzelin (gmina miejsko-wiejska)",
  level: "gmina",
  office: "Rada gminy",
  year: 2024,
};

function revision(nodeId: string, collection: string, data: object) {
  return {
    node_id: nodeId,
    collection,
    data,
    status: "pending",
    update_user: "pipeline-people-import",
    update_automatic: true,
    update_time: "2026-10-01T02:00:00.000Z",
  };
}

/** The pages: drafts the import wrote, one public page, and their places. */
function fixture(): [string, string, object][] {
  const docs: [string, string, object][] = [];
  const put = (collection: string, id: string, data: object) =>
    docs.push([collection, id, data]);
  put("nodes", "teryt0217", {
    type: "region",
    name: "powiat strzeliński",
    teryt: "0217",
    published: true,
  });
  put("nodes", "wodociagi", {
    type: "place",
    name: "Wodociągi Strzelin",
    published: true,
    isPublic: true,
  });
  const person = (id: string, name: string, page: object = {}) => {
    const data = { type: "person", name, birthDate: BORN, ...page };
    put("nodes", id, { published: false, ...data });
    put("revisions", `rev-${id}`, revision(id, "nodes", data));
    const run = {
      type: "election",
      name: "kandydatura",
      source: id,
      target: "teryt0217",
      position: "Rada gminy",
      start_date: "2024-01-01",
      elected: true,
    };
    put("edges", `${id}-run`, { ...run, published: false });
    put("revisions", `rev-${id}-run`, revision(`${id}-run`, "edges", run));
    const job = {
      type: "employed",
      name: "Rada Nadzorcza",
      source: id,
      target: "wodociagi",
      start_date: "2020-03-01",
    };
    put("edges", `${id}-job`, { ...job, published: false });
    put("revisions", `rev-${id}-job`, revision(`${id}-job`, "edges", job));
  };
  person("kowalska", "Anna Kowalska");
  person("nowak", "Jan Nowak");
  person("wisniewska", "Ewa Wiśniewska");
  person("zielinski", "Piotr Zieliński", { birthDate: "" });
  person("lewandowska", "Maria Lewandowska");
  // Public already: a crop agreeing with it links the declaration on it.
  docs.push([
    "nodes",
    "dabrowski",
    {
      type: "person",
      name: "Adam Dąbrowski",
      birthDate: "1965-02-03",
      published: true,
    },
  ]);
  return docs;
}

const PEOPLE = [
  "kowalska",
  "nowak",
  "wisniewska",
  "zielinski",
  "lewandowska",
  "dabrowski",
];
const keyOf = (id: string) => sha(`candidacy-${id}`).slice(0, 16);

function payload() {
  const candidacies = PEOPLE.map((id) => ({
    key: keyOf(id),
    kids: [id],
    ...UNIT,
    status: "found",
    reason: "named",
    files: 1,
  }));
  const crop = (label: string, person: string, fields: object = {}) => ({
    sha256: sha(label),
    page: 0,
    url: `https://bip.strzelin.pl/download/${label}`,
    declarationYear: 2023,
    candidacies: [keyOf(person)],
    outcome: "crop",
    images: {
      date: png(951, 105, label.length),
      name: png(1159, 94, label.length + 1),
    },
    ...fields,
  });
  return {
    tag: "bip-cut-v1",
    runId: "run-1",
    candidacies,
    extracts: [
      crop("kowalska-2023", "kowalska"),
      crop("nowak-2023", "nowak"),
      crop("wisniewska-2023", "wisniewska"),
      crop("zielinski-2023", "zielinski"),
      crop("lewandowska-2023", "lewandowska"),
      crop("lewandowska-2022", "lewandowska", { declarationYear: 2022 }),
      crop("dabrowski-2023", "dabrowski"),
      // Read by the job with high confidence: settled at upload.
      crop("dabrowski-2022", "dabrowski", {
        declarationYear: 2022,
        outcome: "read",
        machine: {
          birthDate: "1965-02-03",
          method: "text_layer",
          confidence: "high",
        },
      }),
    ],
  };
}

const cropId = (label: string) => `${sha(label)}-p0`;
const READER = "3f2b7c1e-8d4a-4b6f-9c2e-1a5d7e9f0b3c";

// --- running it --------------------------------------------------------------

type Log = { step: string; status: number; body: unknown; ms: number }[];

async function call(
  log: Log,
  step: string,
  handler: unknown,
  event: Partial<Event> & { uid?: string; reader?: string },
) {
  const headers: Record<string, string> = { ...event.headers };
  if (event.uid) headers.authorization = `Bearer ${event.uid}`;
  if (event.reader) headers["x-reader-id"] = event.reader;
  const started = performance.now();
  let status = 200;
  let body: unknown;
  try {
    body = await (handler as Handler)({
      headers,
      query: event.query ?? {},
      body: event.body,
      params: event.params ?? {},
      context: {},
    });
  } catch (error) {
    status = (error as { statusCode?: number }).statusCode ?? 500;
    body = { error: (error as Error).message };
    if (status === 500) console.error(step, error);
  }
  log.push({ step, status, body, ms: performance.now() - started });
  return body as Record<string, unknown>;
}

async function scenario(): Promise<Log> {
  const log: Log = [];
  {
    await call(log, "ingest", ingest, { uid: "pipeline", body: payload() });
    await call(log, "next anonymous", next, {
      reader: READER,
      query: { count: "3" },
    });
    await call(log, "next u1", next, { uid: "u1", query: { count: "5" } });

    const read = async (uid: string, label: string, body: object) =>
      call(log, `answer ${uid} ${label}`, answer, {
        uid,
        params: { id: cropId(label) },
        body,
      });
    const date = (value: string) => ({ verdict: "date", value });
    // Two readers agree on her date: the draft is published.
    await read("u1", "kowalska-2023", date(BORN));
    await read("u2", "kowalska-2023", date(BORN));
    // On his: his public page links the declaration.
    await read("u1", "dabrowski-2023", date("1965-02-03"));
    await read("u2", "dabrowski-2023", date("1965-02-03"));
    // Another day than her page's: flagged.
    await read("u1", "wisniewska-2023", date("1980-01-01"));
    await read("u2", "wisniewska-2023", date("1980-01-01"));
    // Readers who disagree, then a third.
    await read("u1", "nowak-2023", date(BORN));
    await read("u2", "nowak-2023", date("1979-07-16"));
    await read("u3", "nowak-2023", date(BORN));
    // Three skips: unreadable.
    for (const uid of ["u1", "u2", "u3"]) {
      await read(uid, "zielinski-2023", { verdict: "skip" });
    }
    // A browser without an account reads, then signs in.
    await call(log, "answer anonymous", answer, {
      reader: READER,
      params: { id: cropId("lewandowska-2023") },
      body: date(BORN),
    });
    await call(log, "claim", claim, { uid: "u4", body: { readerId: READER } });
    await read("u1", "lewandowska-2023", date(BORN));

    await call(log, "progress u1", progress, { uid: "u1" });
    await call(log, "progress anonymous", progress, { reader: READER });
    await call(log, "found u1", found, { uid: "u1" });
    await call(log, "found u4", found, { uid: "u4" });
    await call(log, "images", images, {
      uid: "u1",
      params: { id: cropId("nowak-2023") },
    });
    await call(log, "images missing", images, {
      uid: "u1",
      params: { id: cropId("none") },
    });
    await call(log, "people", people, {});

    // The admin decides one and withdraws another.
    await call(log, "settle", settle, {
      uid: "admin",
      params: { id: cropId("lewandowska-2022") },
      body: { verdict: "date", value: BORN },
    });
    await call(log, "withdraw", withdraw, {
      uid: "admin",
      params: { id: cropId("dabrowski-2022") },
    });
    await call(log, "sweep", sweep, { uid: "pipeline" });
    await call(log, "publish queued", publishQueued, {
      uid: "admin",
      body: {},
    });
    await call(log, "overview", overview, { uid: "admin" });
    await call(log, "next u1 after", next, {
      uid: "u1",
      query: { count: "5" },
    });
    await call(log, "next u5", next, { uid: "u5", query: { count: "5" } });
  }
  return log;
}

let sql: postgres.Sql;
let log: Log = [];

async function docOf(table: string, id: string) {
  const [row] = await sql<{ data: Record<string, unknown> }[]>`
    SELECT data FROM ${sql(table)} WHERE id = ${id}`;
  return row?.data;
}

describe.runIf(PG_TEST_DATABASE_URL)("declarations end to end", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    sql = await openTestDatabase("declaration_flow");
    (
      useRuntimeConfig() as Record<string, unknown>
    ).declarationsDailyPublishLimit = 5;
    for (const [collection, id, data] of fixture()) {
      const table =
        collection === "nodes"
          ? "nodes"
          : collection === "edges"
            ? "edges"
            : "revisions";
      await sql`INSERT INTO ${sql(table)} (id, data) VALUES (${id}, ${sql.json(data as never)})`;
    }
    await sql`SELECT refresh_node_stats()`;
    vi.spyOn(console, "info").mockImplementation(() => {});
    log = await scenario();
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await closeTestDatabase(sql);
  });

  it("answers every request of the flow", () => {
    expect(log.map(({ step, status }) => `${step} ${status}`)).toEqual(
      STATUSES,
    );
  });

  it("publishes, links and flags what the readers settled", async () => {
    expect((await docOf("nodes", "kowalska"))!.published).toBe(true);
    expect(await docOf("declaration_publications", "kowalska")).toMatchObject({
      status: "published",
    });
    expect(await docOf("declaration_publications", "dabrowski")).toMatchObject({
      status: "confirmed",
    });
    expect(
      await docOf("declaration_extracts", cropId("wisniewska-2023")),
    ).toMatchObject({
      status: "agreed",
      pageMatch: "different",
    });
    expect(
      await docOf("declaration_extracts", cropId("zielinski-2023")),
    ).toMatchObject({
      status: "unreadable",
    });
    // Two of three readers on one date settle nothing yet; the admin's
    // withdrawal of a crop the job settled is refused (409 above).
    expect(
      await docOf("declaration_extracts", cropId("nowak-2023")),
    ).toMatchObject({ status: "open", answerCount: 3 });
    expect(
      await docOf("declaration_extracts", cropId("dabrowski-2022")),
    ).toMatchObject({ status: "agreed", agreed: { by: "machine" } });
  });

  it("settles a crop once when its readers answer at the same moment", async () => {
    const label = "race";
    const upload = payload();
    const race: Log = [];
    await call(race, "ingest", ingest, {
      uid: "pipeline",
      body: {
        ...upload,
        extracts: [
          {
            ...upload.extracts[0]!,
            sha256: sha(label),
            url: `https://bip.strzelin.pl/download/${label}`,
          },
        ],
      },
    });
    const answered = await Promise.all(
      ["r1", "r2", "r3", "r4", "r5", "r6"].map(async (uid) => {
        const each: Log = [];
        await call(each, "race", answer, {
          uid,
          params: { id: cropId(label) },
          body: { verdict: "date", value: BORN },
        });
        return each[0]!;
      }),
    );
    const crop = (await docOf("declaration_extracts", cropId(label)))!;
    expect({
      statuses: answered.map((a) => a.status),
      settledBy: answered.filter(
        (a) => (a.body as { settled?: boolean }).settled,
      ).length,
      status: crop.status,
      answerCount: crop.answerCount,
    }).toEqual({
      statuses: [200, 200, 200, 200, 200, 200],
      settledBy: 1,
      status: "agreed",
      answerCount: 6,
    });
  });
});

/** What each step of the flow answers, as the parity run found it on both
 * stores: the admin's settle and withdraw come on crops already settled. */
const STATUSES = [
  "ingest 200",
  "next anonymous 200",
  "next u1 200",
  "answer u1 kowalska-2023 200",
  "answer u2 kowalska-2023 200",
  "answer u1 dabrowski-2023 200",
  "answer u2 dabrowski-2023 200",
  "answer u1 wisniewska-2023 200",
  "answer u2 wisniewska-2023 200",
  "answer u1 nowak-2023 200",
  "answer u2 nowak-2023 200",
  "answer u3 nowak-2023 200",
  "answer u1 zielinski-2023 200",
  "answer u2 zielinski-2023 200",
  "answer u3 zielinski-2023 200",
  "answer anonymous 200",
  "claim 200",
  "answer u1 lewandowska-2023 200",
  "progress u1 200",
  "progress anonymous 200",
  "found u1 200",
  "found u4 200",
  "images 200",
  "images missing 404",
  "people 200",
  "settle 409",
  "withdraw 409",
  "sweep 200",
  "publish queued 200",
  "overview 200",
  "next u1 after 200",
  "next u5 200",
];
