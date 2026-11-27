import {
  call,
  cropId,
  decodeTestToken,
  MIDDAY,
  PNG,
  takeCleared,
} from "./declarationsHarness";
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
import nextGet from "~~/server/api/declarations/next.get";
import answerPost from "~~/server/api/declarations/[id]/answer.post";
import claimPost from "~~/server/api/declarations/claim.post";
import progressGet from "~~/server/api/declarations/progress.get";
import foundGet from "~~/server/api/declarations/found.get";
import peopleGet from "~~/server/api/declarations/people.get";
import imagesGet from "~~/server/api/declarations/[id]/images.get";
import {
  READER_DAILY_LIMIT,
  ROOM_SHARDS,
  VOTELESS_DAILY_LIMIT,
} from "~~/server/utils/declarations";
import { warsawDate } from "~~/shared/dates";
import type { DeclarationQueue } from "~~/shared/declarations";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
} from "./pgHarness";

/** The readers' side of the declarations on Postgres
 * (server/db/declarationReading.ts) through its handlers: the queue, an
 * answer and what it settles, a claim, a reader's finds and progress, the
 * crop's pictures; who may ask for what. The cases of the Firestore-mock
 * tests they replace (tests/server/utils/declarations.test.ts).
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationsReading.pg.test.ts
 */

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: async (t: string) => decodeTestToken(t) }),
}));

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;
const sync = () => store.sync(sql);

const READER = "0b6f0c52-7f8e-4b8e-9d3a-1f0a2b3c4d5e";
const BORN = "1979-07-15";
const DAY = warsawDate(MIDDAY);

const crop = (fields: Record<string, unknown> = {}) => ({
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

async function rows(
  name: string,
): Promise<Record<string, Record<string, unknown>>> {
  const found = await sql<{ id: string; data: Record<string, unknown> }[]>`
    SELECT id, data FROM ${sql(name)} ORDER BY id`;
  return Object.fromEntries(found.map((row) => [row.id, row.data]));
}

describe.runIf(PG_TEST_DATABASE_URL)("declarations, the readers' side", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("declarations_reading");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MIDDAY);
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
      published: true,
    };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET /api/declarations/next", () => {
    beforeEach(() => {
      const crops = table("declarationExtracts");
      const images = table("declarationExtractImages");
      crops[cropId(1)] = crop({ priority: 1 });
      crops[cropId(2)] = crop({
        priority: 0,
        answerCount: 1,
        personIds: ["nowak"],
      });
      crops[cropId(3)] = crop({
        priority: 0,
        answerCount: 0,
        personIds: ["nowak"],
      });
      crops[cropId(4)] = crop({ status: "agreed", personIds: ["x"] });
      for (const n of [1, 2, 3, 4]) images[cropId(n)] = { date: PNG };
    });

    it("refuses a caller with neither a token nor a reader id", async () => {
      await sync();
      expect(await statusOf(call(nextGet, undefined))).toBe(401);
    });

    it("serves by priority, a vote short first, one crop a person", async () => {
      await sync();
      const queue = await call<DeclarationQueue>(nextGet, "anna,verified", {
        query: { count: "5" },
      });
      expect([queue.task?.id, ...queue.upcoming.map((t) => t.id)]).toEqual([
        cropId(2),
        cropId(1),
      ]);
      expect(queue.task?.images.date).toMatch(/^data:image\/png;base64,/);
      expect(queue.open).toBe(3);
      expect(queue.settledCrops).toBe(1);
    });

    it("passes over a crop the reader answered, and the page's excluded ones", async () => {
      table("declarationAnswers")[`${cropId(2)}_anna`] = {
        extractId: cropId(2),
        uid: "anna",
        verdict: "date",
        value: BORN,
        votes: true,
        counted: true,
        day: DAY,
      };
      await sync();
      const queue = await call<DeclarationQueue>(nextGet, "anna,verified", {
        query: { count: "5", exclude: cropId(1) },
      });
      // Nowak is in hand through the answered crop 2, Kowalska's is excluded.
      expect(queue.task).toBeNull();
      expect(queue.mine.total).toBe(1);
      expect(queue.mine.today).toBe(1);
    });

    it("counts a stranger's ask on the day's room, and refuses once it is full", async () => {
      await sync();
      await call(nextGet, undefined, { readerId: READER });
      const limits = await rows("declaration_reader_limits");
      expect(
        Object.keys(limits).filter((id) =>
          id.startsWith(`${DAY}_voteless-asks_`),
        ),
      ).toHaveLength(1);

      const full = Math.ceil(VOTELESS_DAILY_LIMIT / ROOM_SHARDS);
      for (let i = 0; i < ROOM_SHARDS; i++) {
        table("declarationReaderLimits")[`${DAY}_voteless-answers_${i}`] = {
          count: full,
          day: DAY,
        };
      }
      await sync();
      expect(
        await statusOf(call(nextGet, undefined, { readerId: READER })),
      ).toBe(429);
      // A reader whose answers vote is never held to the room.
      expect(await statusOf(call(nextGet, "anna,verified"))).toBe(200);
    });
  });

  describe("POST /api/declarations/<id>/answer", () => {
    beforeEach(() => {
      table("declarationExtracts")[cropId(1)] = crop();
      table("declarationExtractImages")[cropId(1)] = { date: PNG };
    });
    const answer = (as: string | undefined, body: unknown, readerId?: string) =>
      call(answerPost, as, { params: { id: cropId(1) }, body, readerId });

    it("refuses a caller with neither a token nor a reader id, and a bad id", async () => {
      await sync();
      expect(await statusOf(answer(undefined, { verdict: "skip" }))).toBe(401);
      expect(
        await statusOf(
          call(answerPost, "anna,verified", {
            params: { id: "nope" },
            body: { verdict: "skip" },
          }),
        ),
      ).toBe(404);
      expect(
        await statusOf(
          call(answerPost, "anna,verified", {
            params: { id: cropId(9) },
            body: { verdict: "skip" },
          }),
        ),
      ).toBe(404);
    });

    it("keeps a stranger's answer without a vote and leaves the crop alone", async () => {
      await sync();
      await answer(undefined, { verdict: "date", value: BORN }, READER);
      const answers = await rows("declaration_answers");
      expect(answers[`${cropId(1)}_anon:${READER}`]).toMatchObject({
        votes: false,
        counted: true,
        value: BORN,
      });
      const [extract] = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM declaration_extracts WHERE id = ${cropId(1)}`;
      expect(extract!.data.answerCount).toBe(0);
    });

    it("settles the crop when two voters agree, and credits their finds", async () => {
      await sync();
      const first = await answer("anna,verified", {
        verdict: "date",
        value: BORN,
      });
      expect(first).toMatchObject({
        settled: false,
        answered: { id: cropId(1) },
      });
      const second = await answer("piotr,verified", {
        verdict: "date",
        value: BORN,
      });
      expect(second).toMatchObject({ settled: true });
      const [extract] = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM declaration_extracts WHERE id = ${cropId(1)}`;
      expect(extract!.data).toMatchObject({
        status: "agreed",
        answerCount: 2,
        agreed: { value: BORN, kind: "date", by: "readers", readers: 2 },
        answers: { readings: { [BORN]: 2 }, unreadable: 0, empty: 0 },
        // Compared with its page at once: Kowalska is born that day.
        pageMatch: "same",
      });
      const finds = await rows("declaration_reader_finds");
      expect(Object.keys(finds)).toEqual(["anna_kowalska", "piotr_kowalska"]);
      const records = await rows("declaration_publications");
      // Queued, and taken up by the pass after it under nuxt.config's limit:
      // a draft with no revision of the import's is held for it.
      expect(records.kowalska).toMatchObject({
        status: "held",
        reason: "no_revision",
        extractIds: [cropId(1)],
      });
    });

    it("does not let an unconfirmed account vote", async () => {
      await sync();
      await answer("anna", { verdict: "date", value: BORN });
      await answer("piotr,verified", { verdict: "date", value: BORN });
      const [extract] = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM declaration_extracts WHERE id = ${cropId(1)}`;
      expect(extract!.data.status).toBe("open");
      expect(extract!.data.answerCount).toBe(1);
    });

    it("replaces a reader's earlier answer instead of adding a voice", async () => {
      await sync();
      await answer("anna,verified", { verdict: "date", value: BORN });
      await answer("anna,verified", { verdict: "date", value: "1980-01-01" });
      const answers = await rows("declaration_answers");
      expect(Object.keys(answers)).toEqual([`${cropId(1)}_anna`]);
      expect(answers[`${cropId(1)}_anna`]!.value).toBe("1980-01-01");
      const [extract] = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM declaration_extracts WHERE id = ${cropId(1)}`;
      expect(extract!.data).toMatchObject({ status: "open", answerCount: 1 });
    });

    it("settles a crop as unreadable on the third skip of readers who vote", async () => {
      await sync();
      for (const uid of ["anna", "piotr", "ewa"]) {
        await answer(`${uid},verified`, { verdict: "skip" });
      }
      const [extract] = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM declaration_extracts WHERE id = ${cropId(1)}`;
      expect(extract!.data).toMatchObject({
        status: "unreadable",
        agreed: null,
      });
    });

    it("keeps an answer to a settled crop, changing nothing, and refuses a withdrawn one", async () => {
      table("declarationExtracts")[cropId(1)] = crop({
        status: "agreed",
        agreed: { value: BORN, kind: "date", by: "readers" },
      });
      table("declarationExtracts")[cropId(2)] = crop({ status: "withdrawn" });
      await sync();
      expect(
        await answer("anna,verified", { verdict: "date", value: "1990-01-01" }),
      ).toMatchObject({ settled: false });
      const [extract] = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM declaration_extracts WHERE id = ${cropId(1)}`;
      expect(extract!.data.agreed).toMatchObject({ value: BORN });
      expect(
        await statusOf(
          call(answerPost, "anna,verified", {
            params: { id: cropId(2) },
            body: { verdict: "skip" },
          }),
        ),
      ).toBe(404);
    });

    it("holds an unconfirmed account to the room for answers without a vote", async () => {
      const full = Math.ceil(VOTELESS_DAILY_LIMIT / ROOM_SHARDS);
      for (let i = 0; i < ROOM_SHARDS; i++) {
        table("declarationReaderLimits")[`${DAY}_voteless-answers_${i}`] = {
          count: full,
          day: DAY,
        };
      }
      await sync();
      expect(
        await statusOf(answer("anna", { verdict: "date", value: BORN })),
      ).toBe(429);
      expect(
        await statusOf(
          answer("anna,verified", { verdict: "date", value: BORN }),
        ),
      ).toBe(200);
    });

    it("stops a reader at the daily limit", async () => {
      table("declarationReaderLimits")[`${DAY}_anna`] = {
        count: READER_DAILY_LIMIT,
        day: DAY,
      };
      await sync();
      expect(
        await statusOf(
          answer("anna,verified", { verdict: "date", value: BORN }),
        ),
      ).toBe(429);
      expect(await rows("declaration_answers")).toEqual({});
    });
  });

  describe("POST /api/declarations/claim", () => {
    const anon = `anon:${READER}`;
    beforeEach(() => {
      table("declarationExtracts")[cropId(1)] = crop({ answerCount: 1 });
      table("declarationAnswers")[`${cropId(1)}_piotr`] = {
        extractId: cropId(1),
        uid: "piotr",
        verdict: "date",
        value: BORN,
        votes: true,
        counted: true,
        day: DAY,
        imageHash: "h1",
      };
      table("declarationAnswers")[`${cropId(1)}_${anon}`] = {
        extractId: cropId(1),
        uid: anon,
        verdict: "date",
        value: BORN,
        votes: false,
        counted: true,
        day: DAY,
        imageHash: "h1",
      };
      table("declarationReaderFinds")[`${anon}_kowalska`] = {
        uid: anon,
        personId: "kowalska",
        extractId: cropId(1),
        at: MIDDAY.toISOString(),
      };
    });
    const claim = (as: string | undefined) =>
      call(claimPost, as, { body: { readerId: READER } });

    it("needs a token and a reader id", async () => {
      await sync();
      expect(await statusOf(claim(undefined))).toBe(401);
      expect(
        await statusOf(
          call(claimPost, "anna,verified", { body: { readerId: "x" } }),
        ),
      ).toBe(400);
    });

    it("refuses an unconfirmed account with readings to move, answers 0 without", async () => {
      await sync();
      expect(await statusOf(claim("anna"))).toBe(403);
      Reflect.deleteProperty(
        table("declarationAnswers"),
        `${cropId(1)}_${anon}`,
      );
      await sync();
      expect(await claim("anna")).toEqual({ claimed: 0, settled: 0 });
    });

    it("moves the browser's answers and finds onto the account, and settles", async () => {
      await sync();
      expect(await claim("anna,verified")).toEqual({ claimed: 1, settled: 1 });
      const answers = await rows("declaration_answers");
      expect(answers[`${cropId(1)}_${anon}`]).toBeUndefined();
      expect(answers[`${cropId(1)}_anna`]).toMatchObject({
        uid: "anna",
        votes: true,
        claimedFrom: anon,
      });
      const [extract] = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM declaration_extracts WHERE id = ${cropId(1)}`;
      expect(extract!.data.status).toBe("agreed");
      expect(Object.keys(await rows("declaration_reader_finds"))).toEqual([
        "anna_kowalska",
      ]);
      const limits = await rows("declaration_reader_limits");
      expect(limits[`${DAY}_anna`]).toMatchObject({ count: 1 });
      // Sent again, it finds nothing.
      expect(await claim("anna,verified")).toEqual({ claimed: 0, settled: 0 });
    });

    it("votes within the account's daily limit, and moves the rest without a vote", async () => {
      table("declarationReaderLimits")[`${DAY}_anna`] = {
        count: READER_DAILY_LIMIT,
        day: DAY,
      };
      await sync();
      expect(await claim("anna,verified")).toEqual({ claimed: 1, settled: 0 });
      const answers = await rows("declaration_answers");
      expect(answers[`${cropId(1)}_anna`]).toMatchObject({ votes: false });
    });

    it("drops a reading of a picture cut again since", async () => {
      table("declarationExtracts")[cropId(1)] = crop({ imageHash: "h2" });
      await sync();
      expect(await claim("anna,verified")).toEqual({ claimed: 0, settled: 0 });
      expect(Object.keys(await rows("declaration_answers"))).toEqual([
        `${cropId(1)}_piotr`,
      ]);
    });
  });

  describe("progress, finds, people, pictures", () => {
    beforeEach(() => {
      table("declarationExtracts")[cropId(1)] = crop({ status: "agreed" });
      table("declarationExtracts")[cropId(2)] = crop();
      table("declarationExtractImages")[cropId(1)] = { date: PNG };
      for (const n of [1, 2]) {
        table("declarationAnswers")[`${cropId(n)}_anna`] = {
          extractId: cropId(n),
          uid: "anna",
          verdict: "date",
          value: BORN,
          votes: true,
          counted: true,
          day: DAY,
        };
      }
      table("declarationReaderFinds").anna_kowalska = {
        uid: "anna",
        personId: "kowalska",
        extractId: cropId(1),
        at: MIDDAY.toISOString(),
      };
      table("declarationReaderFinds").anna_gone = {
        uid: "anna",
        personId: "gone",
        extractId: cropId(1),
        at: MIDDAY.toISOString(),
      };
    });

    it("counts a voter's settled crops, and nothing for a stranger", async () => {
      await sync();
      expect(await call(progressGet, "anna,verified")).toEqual({
        settled: 1,
        votes: true,
      });
      expect(await call(progressGet, undefined, { readerId: READER })).toEqual({
        settled: 0,
        votes: false,
      });
      expect(await statusOf(call(progressGet, undefined))).toBe(401);
    });

    it("lists a signed-in reader's finds, a page gone left out of the list", async () => {
      await sync();
      expect(
        await statusOf(call(foundGet, undefined, { readerId: READER })),
      ).toBe(401);
      expect(await call(foundGet, "anna")).toEqual({
        people: [
          {
            id: "kowalska",
            name: "Anna Kowalska",
            published: false,
            unit: "Strzelin",
            office: "Rada gminy",
            declarationYear: 2023,
          },
        ],
        total: 2,
      });
    });

    it("answers the people snapshot, or null before the first count", async () => {
      await sync();
      expect(await call(peopleGet, undefined)).toEqual({ people: null });
    });

    it("draws a crop's pictures for a signed-in reader only", async () => {
      await sync();
      const event = { params: { id: cropId(1) } };
      expect(await statusOf(call(imagesGet, undefined, event))).toBe(401);
      expect(await call(imagesGet, "anna", event)).toEqual({
        date: `data:image/png;base64,${PNG.$bytes}`,
        name: null,
      });
      expect(
        await statusOf(call(imagesGet, "anna", { params: { id: cropId(7) } })),
      ).toBe(404);
    });
  });
});
