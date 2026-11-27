import {
  call,
  cropId,
  decodeTestToken,
  MIDDAY,
  PNG,
  takeCleared,
} from "./declarationsHarness";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type postgres from "postgres";
import { useRuntimeConfig } from "#app";
import answerPost from "~~/server/api/declarations/[id]/answer.post";
import claimPost from "~~/server/api/declarations/claim.post";
import foundGet from "~~/server/api/declarations/found.get";
import nextGet from "~~/server/api/declarations/next.get";
import progressGet from "~~/server/api/declarations/progress.get";
import publishQueuedPost from "~~/server/api/declarations/publish-queued.post";
import sweepPost from "~~/server/api/declarations/sweep.post";
import {
  drainPublicationsPg,
  matchAndDrainPg,
  sweepDeclarationsPg,
} from "~~/server/db/declarationPublish";
import { claimAnswersPg } from "~~/server/db/declarationReading";
import { warsawDate } from "~~/shared/dates";
import {
  DAILY_AUTO_PUBLISH_LIMIT,
  PRESS_BATCH,
  READ_NAME_MAX_LENGTH,
  type DeclarationQueue,
  type DrainResult,
} from "~~/shared/declarations";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
} from "./pgHarness";
import { peopleEntries, seedPeople } from "./declarationPeopleSeed";

/** The readers' and the job's declaration endpoints on Postgres, past what
 * declarationsReading.pg and declarationsPublish.pg cover: what an answer, a
 * claim, the sweep and a press hand the comparison (the crops, the
 * configured limit, a page or a batch at most), that a failure there or in
 * the people count fails no reader, whom the people count moves, the finds
 * credited with an answer, the crops a page holds, the gate in front of
 * each. The cases of the Firestore-mock test
 * tests/server/api/declarations/endpoints.test.ts.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationEndpoints.pg.test.ts
 */

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (t: string) => {
      if (t === "stale") {
        throw Object.assign(new Error("id-token-expired"), {
          code: "auth/id-token-expired",
        });
      }
      return decodeTestToken(t);
    },
  }),
}));
// The real statements, watched for what the handlers hand them.
vi.mock("~~/server/db/declarationPublish", async (original) => {
  const real =
    await original<typeof import("~~/server/db/declarationPublish")>();
  return {
    ...real,
    matchAndDrainPg: vi.fn(real.matchAndDrainPg),
    drainPublicationsPg: vi.fn(real.drainPublicationsPg),
    sweepDeclarationsPg: vi.fn(real.sweepDeclarationsPg),
  };
});
vi.mock("~~/server/db/declarationReading", async (original) => {
  const real =
    await original<typeof import("~~/server/db/declarationReading")>();
  return { ...real, claimAnswersPg: vi.fn(real.claimAnswersPg) };
});

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;
const sync = () => store.sync(sql);

const READER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const BORN = "1979-07-15";
const DAY = warsawDate(MIDDAY);
const AT = "2026-11-20T10:00:00.000Z";
const config = () => useRuntimeConfig() as Record<string, unknown>;
let shippedLimit: unknown;

type Doc = Record<string, unknown>;

async function doc(name: string, id: string): Promise<Doc | undefined> {
  const [row] = await sql<{ data: Doc }[]>`
    SELECT data FROM ${sql(name)} WHERE id = ${id}`;
  return row?.data;
}

async function ids(name: string): Promise<string[]> {
  return (
    await sql<{ id: string }[]>`SELECT id FROM ${sql(name)} ORDER BY id`
  ).map((row) => row.id);
}

const crop = (fields: Doc = {}) => ({
  status: "open",
  priority: 0,
  answerCount: 0,
  rand: 0.5,
  personIds: ["kowalska"],
  url: "https://bip.test/1",
  declarationYear: 2023,
  units: [{ unitName: "Strzelin", office: "Rada gminy" }],
  imageHash: "h1",
  imageSize: { date: { width: 10, height: 2 } },
  ...fields,
});

const voterAnswer = (extractId: string, uid: string, value: string) => ({
  extractId,
  uid,
  verdict: "date",
  value,
  votes: true,
  counted: true,
  day: DAY,
  imageHash: "h1",
});

/** Whether the people count re-staged the page just now. */
async function restaged(page: string): Promise<boolean> {
  return (await peopleEntries(sql))[page]?.at === MIDDAY.getTime();
}

/** A draft the pass can put up: the import's revision, a paid post at a
 * public company, the candidacy, a crop that settled on her day. */
function publishablePage(id: string, extractId: string) {
  const page = { type: "person", name: `Osoba ${id}`, birthDate: BORN };
  table("nodes")[id] = { ...page, published: false };
  table("nodes").spolka = {
    type: "place",
    name: "Spółka",
    published: true,
    isPublic: true,
  };
  table("nodes").teryt0217 = {
    type: "region",
    name: "powiat",
    published: true,
  };
  const revision = (node: string, collection: string, data: Doc) => ({
    node_id: node,
    collection,
    data,
    update_time: AT,
    update_user: "pipeline-people",
    update_automatic: true,
    status: "pending",
  });
  table("revisions")[`r-${id}`] = revision(id, "nodes", page);
  const edges: Record<string, Doc> = {
    [`${id}-job`]: {
      type: "employed",
      source: id,
      target: "spolka",
      name: "Prezes",
      start_date: "2020-01-01",
    },
    [`${id}-candidacy`]: {
      type: "election",
      source: id,
      target: "teryt0217",
      start_date: "2024-04-07",
      position: "Rada gminy",
    },
  };
  for (const [edge, data] of Object.entries(edges)) {
    table("edges")[edge] = { ...data, published: false };
    table("revisions")[`r-${edge}`] = revision(edge, "edges", data);
  }
  table("declarationExtracts")[extractId] = crop({
    status: "agreed",
    personIds: [id],
    agreed: { value: BORN, kind: "date", by: "readers", readers: 2 },
    pageMatch: "same",
    units: [
      {
        teryt: "021704",
        level: "gmina",
        unitName: "Strzelin",
        office: "Rada gminy",
        year: 2024,
      },
    ],
  });
  table("declarationPublications")[id] = {
    personId: id,
    status: "queued",
    reason: null,
    extractIds: [extractId],
    declarations: [],
    queuedAt: AT,
  };
}

describe.runIf(PG_TEST_DATABASE_URL)("declarations, the endpoints", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("decla_endpoints");
    shippedLimit = config().declarationsDailyPublishLimit;
  }, 120_000);
  afterAll(async () => {
    config().declarationsDailyPublishLimit = shippedLimit;
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MIDDAY);
    for (const spy of [
      matchAndDrainPg,
      drainPublicationsPg,
      sweepDeclarationsPg,
      claimAnswersPg,
    ]) {
      vi.mocked(spy).mockClear();
    }
    config().declarationsDailyPublishLimit = 4;
    store.clear();
    takeCleared();
    table("nodes").kowalska = {
      type: "person",
      name: "Anna Kowalska",
      published: false,
      birthDate: BORN,
    };
    table("nodes").nowak = {
      type: "person",
      name: "Jan Nowak",
      published: false,
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("POST /api/declarations/<id>/answer", () => {
    beforeEach(() => {
      table("declarationExtracts")[cropId(1)] = crop();
      table("declarationExtractImages")[cropId(1)] = { date: PNG };
      // Her other crop, and another person's.
      table("declarationExtracts")[cropId(2)] = crop({ rand: 0.1 });
      table("declarationExtracts")[cropId(3)] = crop({ personIds: ["nowak"] });
      for (const n of [2, 3]) {
        table("declarationExtractImages")[cropId(n)] = { date: PNG };
      }
    });
    const answer = (
      as: string | undefined,
      body: unknown,
      readerId?: string,
      id = cropId(1),
    ) =>
      call<DeclarationQueue & { settled: boolean }>(answerPost, as, {
        params: { id },
        body,
        readerId,
      });

    it("compares a crop it settles on a day with its pages, one page of the queue at most", async () => {
      await sync();
      await answer("anna,verified", { verdict: "date", value: BORN });
      expect(matchAndDrainPg).not.toHaveBeenCalled();
      const result = await answer("piotr,verified", {
        verdict: "date",
        value: BORN,
      });
      expect(result).toMatchObject({
        settled: true,
        answered: { id: cropId(1) },
      });
      const [ids, , limit, options] = vi.mocked(matchAndDrainPg).mock.calls[0]!;
      expect(ids).toEqual([cropId(1)]);
      expect(limit).toBe(4);
      expect(options).toEqual({ maxPages: 1 });
      // The next crops are of other people: this one settled hers, and her
      // other crops move in the queue only once the comparison has run.
      expect([result.task, ...result.upcoming].map((task) => task?.id)).toEqual(
        [cropId(3)],
      );
    });

    it("compares nothing for an answer that settles nothing, or settles a year", async () => {
      seedPeople(store, ["kowalska"]);
      await sync();
      await answer("anna,verified", { verdict: "date", value: "1979" });
      expect(
        await answer("piotr,verified", { verdict: "date", value: "1979" }),
      ).toMatchObject({ settled: true });
      expect(
        (await doc("declaration_extracts", cropId(1)))!.agreed,
      ).toMatchObject({ kind: "year" });
      expect(matchAndDrainPg).not.toHaveBeenCalled();
      // Nor does a year move her in the people count.
      expect(await restaged("kowalska")).toBe(false);
    });

    it("still answers the reader when the comparison fails", async () => {
      await sync();
      vi.mocked(matchAndDrainPg).mockRejectedValueOnce(new Error("contention"));
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      await answer("anna,verified", { verdict: "date", value: BORN });
      const result = await answer("piotr,verified", {
        verdict: "date",
        value: BORN,
      });
      expect(result).toMatchObject({ settled: true, task: { id: cropId(3) } });
      expect(quiet).toHaveBeenCalledWith(
        expect.stringContaining("comparing"),
        expect.any(Error),
      );
    });

    it("moves the pages its comparison touched in the people count", async () => {
      seedPeople(store, ["kowalska", "nowak"]);
      await sync();
      await answer("anna,verified", { verdict: "date", value: BORN });
      expect(await restaged("kowalska")).toBe(false);
      await answer("piotr,verified", { verdict: "date", value: BORN });
      expect(await restaged("kowalska")).toBe(true);
      expect(await restaged("nowak")).toBe(false);
    });

    it("moves the people of a crop it settles as unreadable, and nobody for a year or a dispute", async () => {
      seedPeople(store, ["kowalska", "nowak"]);
      table("declarationExtracts")[cropId(4)] = crop({ personIds: ["nowak"] });
      await sync();
      for (const uid of ["anna", "piotr", "ewa"]) {
        await answer(`${uid},verified`, { verdict: "skip" });
      }
      expect((await doc("declaration_extracts", cropId(1)))!.status).toBe(
        "unreadable",
      );
      expect(matchAndDrainPg).not.toHaveBeenCalled();
      expect(await restaged("kowalska")).toBe(true);

      // Six readers who never agree: a dispute, for an admin.
      const readers = ["a", "b", "c", "d", "e", "f"];
      for (const [i, uid] of readers.entries()) {
        await answer(
          `${uid},verified`,
          { verdict: "date", value: i % 2 ? "1980-01-01" : BORN },
          undefined,
          cropId(4),
        );
      }
      expect((await doc("declaration_extracts", cropId(4)))!.status).toBe(
        "disputed",
      );
      expect(await restaged("nowak")).toBe(false);
    });

    it("still answers the reader when the people count cannot be moved", async () => {
      seedPeople(store, ["kowalska"], {
        someone: { stage: "queued", detail: "", future: true },
      });
      await sync();
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      for (const uid of ["anna", "piotr"]) {
        await answer(`${uid},verified`, { verdict: "skip" });
      }
      const result = await answer("ewa,verified", { verdict: "skip" });
      expect(result).toMatchObject({ settled: true });
      expect(quiet).toHaveBeenCalledWith(
        expect.stringContaining("re-staging kowalska"),
        expect.any(Error),
      );
    });

    it("takes a reader without an account by their reader id, and never sets publication going", async () => {
      // Two strangers on one day agree, and settle nothing: they have no vote.
      await sync();
      await answer(undefined, { verdict: "date", value: BORN }, READER);
      const result = await answer(
        undefined,
        { verdict: "date", value: BORN },
        "1f8fad5b-d9cb-469f-a165-70867728950e",
      );
      expect(result.settled).toBe(false);
      expect(await ids("declaration_answers")).toEqual([
        `${cropId(1)}_anon:${READER}`,
        `${cropId(1)}_anon:1f8fad5b-d9cb-469f-a165-70867728950e`,
      ]);
      // Their queue is theirs: one answer of theirs today.
      expect(result.mine).toMatchObject({ today: 1, total: 1 });
      expect(matchAndDrainPg).not.toHaveBeenCalled();
    });

    it("credits the reader with whom their date found before it reads their queue, with or without an account", async () => {
      await sync();
      expect(
        (await answer("anna,verified", { verdict: "date", value: BORN })).mine,
      ).toMatchObject({ found: 1 });
      expect(
        (await answer(undefined, { verdict: "date", value: "1979" }, READER))
          .mine,
      ).toMatchObject({ found: 1 });
      expect(await ids("declaration_reader_finds")).toEqual([
        `anna_kowalska`,
        `anon:${READER}_kowalska`,
      ]);
      expect(
        await doc("declaration_reader_finds", "anna_kowalska"),
      ).toMatchObject({
        uid: "anna",
        personId: "kowalska",
        extractId: cropId(1),
      });
    });

    it("credits nobody for an answer that is not a date", async () => {
      await sync();
      for (const verdict of ["unreadable", "empty", "skip"]) {
        await answer("anna,verified", { verdict });
      }
      expect(await ids("declaration_answers")).toEqual([`${cropId(1)}_anna`]);
      expect(await ids("declaration_reader_finds")).toEqual([]);
    });

    it("refuses a bad token even beside a reader id", async () => {
      await sync();
      expect(await statusOf(answer("stale", { verdict: "skip" }, READER))).toBe(
        401,
      );
      expect(await ids("declaration_answers")).toEqual([]);
    });

    it("keeps a name as long as the reading page's field holds, and turns a longer one down", async () => {
      await sync();
      const name = "Ż".repeat(READ_NAME_MAX_LENGTH);
      await answer("anna,verified", { verdict: "unreadable", name });
      expect(
        await doc("declaration_answers", `${cropId(1)}_anna`),
      ).toMatchObject({ verdict: "unreadable", name });
      expect(
        await statusOf(
          answer("piotr,verified", { verdict: "unreadable", name: `${name}Ż` }),
        ),
      ).toBe(400);
      expect(await ids("declaration_answers")).toEqual([`${cropId(1)}_anna`]);
    });
  });

  describe("GET /api/declarations/next and progress", () => {
    it("serves an account without a confirmed address, within the room for readers without a vote", async () => {
      table("declarationExtracts")[cropId(1)] = crop();
      table("declarationExtractImages")[cropId(1)] = { date: PNG };
      await sync();
      const queue = await call<DeclarationQueue>(nextGet, "anna");
      expect(queue.task?.id).toBe(cropId(1));
      expect(
        (await ids("declaration_reader_limits")).filter((id) =>
          id.startsWith(`${DAY}_voteless-asks_`),
        ),
      ).toHaveLength(1);
    });

    it("takes ten crops at most as held by the page", async () => {
      const crops = Array.from({ length: 12 }, (_, i) => cropId(i + 1));
      crops.forEach((id, i) => {
        table("declarationExtracts")[id] = crop({
          personIds: [`p${i}`],
          rand: i / 100,
        });
        table("declarationExtractImages")[id] = { date: PNG };
      });
      await sync();
      const queue = await call<DeclarationQueue>(nextGet, "anna,verified", {
        query: { count: "5", exclude: [...crops, "nope"].join(",") },
      });
      expect(
        [queue.task, ...queue.upcoming].map((task) => task?.id).sort(),
      ).toEqual(crops.slice(10).sort());
    });

    it("clamps `count` to five, and refuses one that is not a whole number or an `exclude` past ten crops' room", async () => {
      const crops = Array.from({ length: 7 }, (_, i) => cropId(i + 1));
      crops.forEach((id, i) => {
        table("declarationExtracts")[id] = crop({
          personIds: [`p${i}`],
          rand: i / 100,
        });
        table("declarationExtractImages")[id] = { date: PNG };
      });
      await sync();
      const asked = async (count: string) => {
        const queue = await call<DeclarationQueue>(nextGet, "anna,verified", {
          query: { count },
        });
        return [queue.task, ...queue.upcoming].filter(Boolean).length;
      };
      expect(await asked("9")).toBe(await asked("5"));
      for (const query of [
        { count: "many" },
        { count: "2.5" },
        { exclude: "x".repeat(2001) },
      ]) {
        expect(
          await statusOf(call(nextGet, "anna,verified", { query })),
        ).toBe(400);
      }
    });

    it("gives a voter their settled crops never to be cached, and an unconfirmed account none", async () => {
      table("declarationExtracts")[cropId(1)] = crop({ status: "agreed" });
      for (const uid of ["anna", "ewa"]) {
        table("declarationAnswers")[`${cropId(1)}_${uid}`] = voterAnswer(
          cropId(1),
          uid,
          BORN,
        );
      }
      await sync();
      const asked = { context: {} as Record<string, unknown> };
      expect(await call(progressGet, "anna,verified", asked)).toEqual({
        settled: 1,
        votes: true,
      });
      expect(asked.context["header:Cache-Control"]).toBe("private, no-store");
      // Her answer is on a settled crop, but her address waits for a click.
      expect(await call(progressGet, "ewa")).toEqual({
        settled: 0,
        votes: false,
      });
    });

    it("lists whom the token's account found, never from a cache", async () => {
      await sync();
      const asked = { context: {} as Record<string, unknown> };
      expect(await call(foundGet, "anna", asked)).toEqual({
        people: [],
        total: 0,
      });
      expect(asked.context["header:Cache-Control"]).toBe("private, no-store");
    });
  });

  describe("POST /api/declarations/claim", () => {
    const anon = `anon:${READER}`;
    /** A crop a voter read on `value`, and this browser too. */
    function halfRead(n: number, value = BORN, person = "kowalska") {
      table("declarationExtracts")[cropId(n)] = crop({
        answerCount: 1,
        personIds: [person],
      });
      table("declarationAnswers")[`${cropId(n)}_piotr`] = voterAnswer(
        cropId(n),
        "piotr",
        value,
      );
      table("declarationAnswers")[`${cropId(n)}_${anon}`] = {
        ...voterAnswer(cropId(n), anon, value),
        votes: false,
      };
    }
    const claim = (as: string, readerId: unknown = READER.toUpperCase()) =>
      call<{ claimed: number; settled: number }>(claimPost, as, {
        body: { readerId },
      });

    it("refuses a reader id that is not one", async () => {
      await sync();
      expect(await statusOf(claim("anna,verified", anon))).toBe(400);
      expect(
        await statusOf(call(claimPost, "anna,verified", { body: {} })),
      ).toBe(400);
      expect(claimAnswersPg).not.toHaveBeenCalled();
    });

    it("claims for the account and compares the crops it settled on a day", async () => {
      halfRead(1);
      halfRead(2, "1979");
      table("declarationExtracts")[cropId(3)] = crop({ answerCount: 2 });
      for (const uid of ["piotr", "ewa", anon]) {
        table("declarationAnswers")[`${cropId(3)}_${uid}`] = {
          ...voterAnswer(cropId(3), uid, ""),
          verdict: "unreadable",
          value: null,
          votes: uid !== anon,
        };
      }
      await sync();
      // The browser's id as the page sends it, in capitals.
      expect(await claim("anna,verified")).toEqual({ claimed: 3, settled: 3 });
      expect(vi.mocked(claimAnswersPg).mock.calls[0]![0]).toMatchObject({
        readerId: READER,
        user: { uid: "anna" },
      });
      const [ids, , limit, options] = vi.mocked(matchAndDrainPg).mock.calls[0]!;
      expect(ids).toEqual([cropId(1)]);
      expect(limit).toBe(4);
      expect(options).toEqual({ maxPages: 1 });
    });

    it("moves the people of the crops it settled as unreadable", async () => {
      table("declarationExtracts")[cropId(3)] = crop({
        answerCount: 2,
        personIds: ["nowak"],
      });
      for (const uid of ["piotr", "ewa", anon]) {
        table("declarationAnswers")[`${cropId(3)}_${uid}`] = {
          ...voterAnswer(cropId(3), uid, ""),
          verdict: "unreadable",
          value: null,
          votes: uid !== anon,
        };
      }
      seedPeople(store, ["kowalska", "nowak"]);
      await sync();
      expect(await claim("anna,verified")).toEqual({ claimed: 1, settled: 1 });
      expect(await restaged("nowak")).toBe(true);
      expect(await restaged("kowalska")).toBe(false);
    });

    it("compares ten crops at most, and leaves the rest to the sweep", async () => {
      for (let n = 1; n <= 12; n++) halfRead(n, BORN, `p${n}`);
      await sync();
      expect(await claim("anna,verified")).toEqual({
        claimed: 12,
        settled: 12,
      });
      expect(vi.mocked(matchAndDrainPg).mock.calls[0]![0]).toHaveLength(10);
    });

    it("fails a claim that left answers under the browser's id, so the page keeps it, once the crops it settled are compared", async () => {
      halfRead(1);
      await sync();
      const real = vi.mocked(claimAnswersPg).getMockImplementation()!;
      // A crop whose transaction kept failing, as the real claim counts it.
      vi.mocked(claimAnswersPg).mockImplementationOnce(async (args) => ({
        ...(await real(args)),
        left: 8,
      }));
      expect(await statusOf(claim("anna,verified"))).toBe(503);
      expect(vi.mocked(matchAndDrainPg).mock.calls[0]![0]).toEqual([cropId(1)]);
    });

    it("refuses an account without a confirmed address before anything moves, so the page keeps the id", async () => {
      halfRead(1);
      await sync();
      expect(await statusOf(claim("anna"))).toBe(403);
      expect(await ids("declaration_answers")).toEqual([
        `${cropId(1)}_${anon}`,
        `${cropId(1)}_piotr`,
      ]);
      expect(matchAndDrainPg).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/declarations/sweep", () => {
    it("is the job's, not a reader's", async () => {
      await sync();
      expect(await statusOf(call(sweepPost, "anna,verified"))).toBe(403);
      expect(sweepDeclarationsPg).not.toHaveBeenCalled();
    });

    it("sweeps under the configured limit and says what it did", async () => {
      publishablePage("kowalska", cropId(1));
      // Settled, and compared by nothing yet.
      table("declarationExtracts")[cropId(1)]!.pageMatch = null;
      Reflect.deleteProperty(table("declarationPublications"), "kowalska");
      seedPeople(store, ["kowalska"]);
      await sync();
      const result = await call<Doc>(sweepPost, "job,datascience");
      expect(vi.mocked(sweepDeclarationsPg).mock.calls[0]![1]).toBe(4);
      // The pages it touched go to the people count, not to the job's log.
      expect(result).not.toHaveProperty("touched");
      expect(result).toMatchObject({
        checked: 1,
        drain: { published: ["kowalska"] },
      });
      expect(takeCleared()).toContain("nitro:handlers");
      expect(await restaged("kowalska")).toBe(true);
    });
  });

  describe("POST /api/declarations/publish-queued", () => {
    it("hands the configured limit on, and answers what the pass did", async () => {
      await sync();
      const asked = { context: {} as Record<string, unknown> };
      const result = await call<DrainResult>(
        publishQueuedPost,
        "boss,admin",
        asked,
      );
      expect(result).toMatchObject({ published: [], held: [], waiting: 0 });
      expect(vi.mocked(drainPublicationsPg).mock.calls[0]![1]).toBe(4);
      expect(asked.context["header:Cache-Control"]).toBe("private, no-store");
      // Nobody went up, so the cached pages stay.
      expect(takeCleared()).not.toContain("nitro:handlers");
    });

    it("moves the people it took up in the people count, and presses in the admin's name, a batch at most", async () => {
      publishablePage("kowalska", cropId(1));
      publishablePage("nowak", cropId(2));
      // A person's proposal his page waits on: the pass holds it.
      table("revisions").proposal = {
        node_id: "nowak",
        collection: "nodes",
        data: { type: "person", name: "Jan Nowak-Kowalski" },
        update_time: AT,
        update_user: "anna",
        update_automatic: false,
        status: "pending",
      };
      seedPeople(store, ["kowalska", "nowak"]);
      await sync();
      const result = await call<DrainResult>(publishQueuedPost, "boss,admin");
      expect(vi.mocked(drainPublicationsPg).mock.calls[0]![2]).toEqual({
        pressedBy: "boss",
        maxPages: PRESS_BATCH,
      });
      expect(result.published).toEqual(["kowalska"]);
      expect(result.held).toEqual([
        { personId: "nowak", reason: "pending_proposal" },
      ]);
      expect(takeCleared()).toContain("nitro:handlers");
      expect(await restaged("kowalska")).toBe(true);
      expect(await restaged("nowak")).toBe(true);
    });
  });

  describe("the daily limit, as the endpoints read it", () => {
    it("takes NUXT_DECLARATIONS_DAILY_PUBLISH_LIMIT as a string too", async () => {
      // What an environment override can arrive as.
      config().declarationsDailyPublishLimit = "4";
      await sync();
      await call(publishQueuedPost, "boss,admin");
      expect(vi.mocked(drainPublicationsPg).mock.calls[0]![1]).toBe(4);
    });

    it("is off where the config says nothing", async () => {
      Reflect.deleteProperty(config(), "declarationsDailyPublishLimit");
      await sync();
      await call(publishQueuedPost, "boss,admin");
      expect(vi.mocked(drainPublicationsPg).mock.calls[0]![1]).toBe(0);
    });

    it("ships at DAILY_AUTO_PUBLISH_LIMIT", () => {
      // Read as text: loading the config would load Nuxt. The key is the one
      // the endpoints read, and NUXT_DECLARATIONS_DAILY_PUBLISH_LIMIT maps to
      // it, so a rename shows up here and not on a day nothing is published.
      const path = existsSync(resolve(process.cwd(), "nuxt.config.ts"))
        ? resolve(process.cwd(), "nuxt.config.ts")
        : resolve(process.cwd(), "frontend", "nuxt.config.ts");
      expect(DAILY_AUTO_PUBLISH_LIMIT).toBe(200);
      expect(readFileSync(path, "utf8")).toMatch(
        new RegExp(
          `^\\s+declarationsDailyPublishLimit: ${DAILY_AUTO_PUBLISH_LIMIT},$`,
          "m",
        ),
      );
    });
  });
});
