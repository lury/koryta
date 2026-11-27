import { PNG } from "./declarationsHarness";
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
import type { DecodedIdToken } from "firebase-admin/auth";
import {
  admitToQueuePg,
  claimAnswersPg,
  findsOfPg,
  queueForPg,
  recordAnswerPg,
  settledWithReaderPg,
} from "~~/server/db/declarationReading";
import {
  anonymousUid,
  CLAIM_LIMIT,
  READER_DAILY_LIMIT,
  ROOM_SHARDS,
  VOTELESS_ASK_DAILY_LIMIT,
  VOTELESS_DAILY_LIMIT,
  type DeclarationReader,
} from "~~/server/utils/declarations";
import { FOUND_LIST_LIMIT } from "~~/shared/declarations";
import { collectionTables } from "~~/server/db/collections";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** The readers' rules on Postgres, called on server/db/declarationReading.ts
 * itself: an answer and what it settles, the rooms and limits of the day,
 * the queue's order, a reader's progress and finds, a claim of a browser's
 * answers. The cases of tests/server/utils/declarations.test.ts that the
 * handler tests (declarationsReading.pg.test.ts) do not carry.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationReaders.pg.test.ts
 */

type Data = Record<string, unknown>;

let sql: postgres.Sql;

const NOW = new Date("2026-10-29T12:00:00Z");
const DAY = "2026-10-29";
const LIMITS = `${DAY}`;
const BORN = "1979-07-15";

/** A browser's reader id, as `crypto.randomUUID()` makes one. */
const readerId = (n: number) =>
  `0f8fad5b-d9cb-469f-a165-${String(n).padStart(12, "0")}`;

const voter = (uid: string): DeclarationReader => ({
  uid,
  votes: true,
  anonymous: false,
});
const unconfirmed = (uid: string): DeclarationReader => ({
  uid,
  votes: false,
  anonymous: false,
});
const stranger = (n: number): DeclarationReader => ({
  uid: anonymousUid(readerId(n)),
  votes: false,
  anonymous: true,
});

function account(uid: string, fields: Partial<DecodedIdToken> = {}) {
  return {
    uid,
    email_verified: true,
    firebase: { sign_in_provider: "password" },
    ...fields,
  } as unknown as DecodedIdToken;
}

async function put(table: string, id: string, data: Data) {
  await sql`
    INSERT INTO ${sql(table)} (id, data) VALUES (${id}, ${sql.json(data as never)})
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
}

async function read(table: string, id: string): Promise<Data | undefined> {
  const [row] = await sql<{ data: Data }[]>`
    SELECT data FROM ${sql(table)} WHERE id = ${id}`;
  return row?.data;
}

async function has(table: string, id: string): Promise<boolean> {
  return (await read(table, id)) !== undefined;
}

/** When a row was last written. */
async function writtenAt(table: string, id: string): Promise<string> {
  const [row] = await sql<{ at: string }[]>`
    SELECT updated_at::text AS at FROM ${sql(table)} WHERE id = ${id}`;
  return row!.at;
}

/** Every row of every table, with when it was written: equal snapshots mean
 * nothing was written in between. */
async function state(): Promise<string> {
  const all: Record<string, unknown> = {};
  for (const table of Object.values(collectionTables)) {
    all[table] = await sql.unsafe(
      `SELECT id, data, updated_at::text AS at FROM ${table} ORDER BY id`,
    );
  }
  return JSON.stringify(all);
}

async function crop(id: string, fields: Data = {}) {
  await put("declaration_extracts", id, {
    status: "open",
    priority: 0,
    answerCount: 0,
    rand: 0.5,
    url: `https://bip.example.pl/${id}.pdf`,
    host: "bip.example.pl",
    declarationYear: 2023,
    units: [{ teryt: "021704", unitName: "Strzelin", office: "Rada gminy" }],
    imageHash: "hash",
    imageSize: { date: { width: 951, height: 105 }, name: null },
    personIds: ["kowalska"],
    ...fields,
  });
  await put("declaration_extract_images", id, { date: PNG, name: null });
}

const ownCrop = (id: string, fields: Data = {}) =>
  crop(id, { personIds: [id], ...fields });

const answerAs = (reader: DeclarationReader, value: string, extractId = "c1") =>
  recordAnswerPg({
    extractId,
    reader,
    answer: { verdict: "date", value },
    now: NOW,
  });
const answer = (uid: string, value: string, extractId = "c1") =>
  answerAs(voter(uid), value, extractId);
const skipAs = (reader: DeclarationReader, extractId = "c1") =>
  recordAnswerPg({ extractId, reader, answer: { verdict: "skip" }, now: NOW });

const claim = (n: number, user: DecodedIdToken) =>
  claimAnswersPg({ readerId: readerId(n), user, now: NOW });

type Room = "voteless-answers" | "voteless-asks";

/** What readers without a vote have used of the day's room, every share. */
async function used(room: Room): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT coalesce(sum((data ->> 'count')::numeric), 0)::int AS n
    FROM declaration_reader_limits WHERE id LIKE ${`${DAY}_${room}_%`}`;
  return row!.n;
}

/** Uses up the day's room, every share of it. */
async function fill(room: Room, limit: number) {
  for (let n = 0; n < ROOM_SHARDS; n++) {
    await put("declaration_reader_limits", `${DAY}_${room}_${n}`, {
      count: limit / ROOM_SHARDS,
      day: DAY,
    });
  }
}

function served(queue: {
  task: { id: string } | null;
  upcoming: { id: string }[];
}) {
  return [queue.task?.id, ...queue.upcoming.map((t) => t.id)].filter(Boolean);
}

/** Makes the next `times` transactions that delete the answer `id` fail, as
 * one lost to contention does. A sequence counts the tries: it is not rolled
 * back with the transaction that fails. */
async function failing(id: string, times: number) {
  const seq = `fail_${id.replace(/\W/g, "_")}`;
  await sql.unsafe(`CREATE SEQUENCE IF NOT EXISTS ${seq}`);
  await sql`INSERT INTO test_failing VALUES (${id}, ${seq}, ${times})`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.runIf(PG_TEST_DATABASE_URL)("declarations, the readers' rules", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("declb_readers");
    await sql.unsafe(`
      CREATE TABLE test_failing (id text PRIMARY KEY, seq text, times int);
      CREATE FUNCTION test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE f record;
      BEGIN
        SELECT * INTO f FROM test_failing WHERE id = OLD.id;
        IF FOUND AND nextval(f.seq) <= f.times THEN
          RAISE EXCEPTION 'aborted: contention on %', OLD.id;
        END IF;
        RETURN OLD;
      END $$;
      CREATE TRIGGER test_fail BEFORE DELETE ON declaration_answers
        FOR EACH ROW EXECUTE FUNCTION test_fail();`);
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    await sql.unsafe(
      `TRUNCATE ${Object.values(collectionTables).join(", ")}, test_failing`,
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("recordAnswer", () => {
    it("keeps one answer and leaves the crop open", async () => {
      await crop("c1");
      expect(await answer("a", BORN)).toEqual({
        settled: null,
        personIds: ["kowalska"],
      });
      expect(await read("declaration_answers", "c1_a")).toMatchObject({
        extractId: "c1",
        uid: "a",
        verdict: "date",
        value: BORN,
        votes: true,
        counted: true,
        day: DAY,
        imageHash: "hash",
      });
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        status: "open",
        answerCount: 1,
        answers: { readings: { [BORN]: 1 }, unreadable: 0, empty: 0 },
      });
    });

    it("settles the crop when a second reader reads the same date", async () => {
      await crop("c1");
      await answer("a", BORN);
      expect((await answer("b", BORN)).settled).toMatchObject({
        status: "agreed",
        value: BORN,
      });
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        status: "agreed",
        agreed: { value: BORN, kind: "date", by: "readers", readers: 2 },
      });
    });

    it("keeps an answer to a crop already settled, and changes nothing", async () => {
      await crop("c1", { status: "agreed", agreed: { value: BORN } });
      expect((await answer("c", "1980-01-01")).settled).toBeNull();
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        status: "agreed",
        agreed: { value: BORN },
      });
      expect(await has("declaration_answers", "c1_c")).toBe(true);
    });

    it("refuses a crop that was withdrawn", async () => {
      await crop("c1", { status: "withdrawn" });
      await expect(answer("a", BORN)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    // A skip with a vote is a voice (three settle a crop as unreadable), so it
    // is held to the limit too; a stranger's skip has no say and is not.
    it("stops a reader who votes at the daily limit, skips included", async () => {
      await crop("c1");
      await put("declaration_reader_limits", `${LIMITS}_a`, {
        count: READER_DAILY_LIMIT,
        day: DAY,
      });
      await expect(answer("a", BORN)).rejects.toMatchObject({
        statusCode: 429,
      });
      await expect(skipAs(voter("a"))).rejects.toMatchObject({
        statusCode: 429,
      });
      expect(await has("declaration_answers", "c1_a")).toBe(false);

      await put("declaration_reader_limits", `${LIMITS}_anon:${readerId(1)}`, {
        count: READER_DAILY_LIMIT,
        day: DAY,
      });
      await skipAs(stranger(1));
      expect(
        await read("declaration_answers", `c1_anon:${readerId(1)}`),
      ).toMatchObject({ verdict: "skip", counted: false });
    });

    it("counts a skip of a reader who votes in their day, but not in their readings", async () => {
      await crop("c1");
      await skipAs(voter("a"));
      expect(
        await read("declaration_reader_limits", `${LIMITS}_a`),
      ).toMatchObject({ count: 1 });
      expect(await read("declaration_answers", "c1_a")).toMatchObject({
        verdict: "skip",
        counted: false,
        votes: true,
      });
    });

    it("settles a crop as unreadable on the third skip of readers who vote, strangers' adding nothing", async () => {
      await crop("c1");
      expect((await skipAs(voter("a"))).settled).toBeNull();
      expect((await skipAs(voter("b"))).settled).toBeNull();
      await skipAs(stranger(1));
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        status: "open",
        answerCount: 2,
      });
      expect((await skipAs(voter("c"))).settled).toEqual({
        status: "unreadable",
        readers: 3,
      });
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        status: "unreadable",
        answerCount: 3,
        answers: { unreadable: 3 },
      });
    });

    it("keeps a reader's answer without an account as theirs, and leaves the crop as it was", async () => {
      await crop("c1");
      const before = await writtenAt("declaration_extracts", "c1");
      expect((await answerAs(stranger(1), BORN)).settled).toBeNull();
      expect(
        await read("declaration_answers", `c1_anon:${readerId(1)}`),
      ).toMatchObject({
        uid: `anon:${readerId(1)}`,
        value: BORN,
        votes: false,
        counted: true,
        day: DAY,
        imageHash: "hash",
      });
      // Not written at all: neither the queue's order nor an admin's list
      // hears it.
      expect(await writtenAt("declaration_extracts", "c1")).toBe(before);
      expect(
        await read(
          "declaration_reader_limits",
          `${LIMITS}_anon:${readerId(1)}`,
        ),
      ).toMatchObject({ count: 1 });
      expect(await used("voteless-answers")).toBe(1);
    });

    it("never settles a crop on two answers without an account", async () => {
      await crop("c1");
      await answerAs(stranger(1), BORN);
      expect((await answerAs(stranger(2), BORN)).settled).toBeNull();
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        status: "open",
        answerCount: 0,
      });
    });

    it("never settles a crop on one voter and one answer without a vote", async () => {
      await crop("c1");
      await crop("c2");
      await answer("a", BORN, "c1");
      expect((await answerAs(stranger(1), BORN, "c1")).settled).toBeNull();
      await answer("a", BORN, "c2");
      expect((await answerAs(unconfirmed("u"), BORN, "c2")).settled).toBeNull();
      for (const id of ["c1", "c2"]) {
        expect(await read("declaration_extracts", id)).toMatchObject({
          status: "open",
          answerCount: 1,
        });
      }
      expect((await answer("b", BORN, "c1")).settled).toEqual({
        status: "agreed",
        value: BORN,
        kind: "date",
        readers: 2,
      });
    });

    // Firestore counted the documents read; in SQL a stranger's answer takes
    // no lock on the crop and reads no answer, so a crop a voter holds does
    // not keep it waiting.
    it("reads none of a crop's answers without a vote, however many strangers gave them", async () => {
      await crop("c1");
      for (let n = 1; n <= 50; n++) {
        await answerAs(stranger(n), "1979-07-16");
      }
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const holder = sql.begin(async (tx) => {
        await tx`SELECT 1 FROM declaration_extracts WHERE id = 'c1' FOR UPDATE`;
        locked();
        await held;
      });
      await isLocked;
      await expect(answerAs(stranger(51), "1979-07-16")).resolves.toEqual({
        settled: null,
        personIds: ["kowalska"],
      });
      const voting = answer("a", BORN);
      expect(
        await Promise.race([
          voting.then(() => "answered"),
          wait(300).then(() => "waiting"),
        ]),
      ).toBe("waiting");
      release();
      await holder;
      await voting;
      expect((await answer("b", BORN)).settled).toMatchObject({
        status: "agreed",
        readers: 2,
      });
    });

    it("lets an account without a confirmed address answer, without a vote, within the room for answers without one", async () => {
      await crop("c1");
      const before = await writtenAt("declaration_extracts", "c1");
      await answerAs(unconfirmed("u"), BORN);
      expect(await read("declaration_answers", "c1_u")).toMatchObject({
        votes: false,
        counted: true,
      });
      expect(await writtenAt("declaration_extracts", "c1")).toBe(before);
      expect(
        await read("declaration_reader_limits", `${LIMITS}_u`),
      ).toMatchObject({ count: 1 });
      expect(await used("voteless-answers")).toBe(1);
    });

    it("holds a reader without an account to the daily limit of a reader", async () => {
      await crop("c1");
      await put("declaration_reader_limits", `${LIMITS}_anon:${readerId(1)}`, {
        count: READER_DAILY_LIMIT,
        day: DAY,
      });
      await expect(answerAs(stranger(1), BORN)).rejects.toMatchObject({
        statusCode: 429,
      });
      await expect(answerAs(stranger(2), BORN)).resolves.toMatchObject({
        settled: null,
      });
    });

    it("stops readers without a vote at the day's room for them, and asks for what lets them go on", async () => {
      await crop("c1");
      await fill("voteless-answers", VOTELESS_DAILY_LIMIT);
      const refused = answerAs(stranger(1), BORN);
      await expect(refused).rejects.toMatchObject({ statusCode: 429 });
      await expect(refused).rejects.toThrow(/załóż konto/);
      await expect(skipAs(stranger(1))).rejects.toMatchObject({
        statusCode: 429,
      });
      await expect(answerAs(unconfirmed("u"), BORN)).rejects.toThrow(
        /Potwierdź adres/,
      );
      expect(await has("declaration_answers", `c1_anon:${readerId(1)}`)).toBe(
        false,
      );
      expect(await has("declaration_answers", "c1_u")).toBe(false);
      // The reader's own count is taken back with the refused answer.
      expect(
        await has("declaration_reader_limits", `${LIMITS}_anon:${readerId(1)}`),
      ).toBe(false);
      expect(await used("voteless-answers")).toBe(VOTELESS_DAILY_LIMIT);
      await expect(answer("a", BORN)).resolves.toMatchObject({
        settled: null,
      });
    });

    it("finds the room left in any share of it, and counts a skip there too", async () => {
      await crop("c1");
      await fill("voteless-answers", VOTELESS_DAILY_LIMIT);
      const share = VOTELESS_DAILY_LIMIT / ROOM_SHARDS;
      const last = `${DAY}_voteless-answers_7`;
      await put("declaration_reader_limits", last, {
        count: share - 1,
        day: DAY,
      });
      await skipAs(stranger(1));
      expect(await read("declaration_reader_limits", last)).toMatchObject({
        count: share,
      });
      await expect(skipAs(stranger(2))).rejects.toMatchObject({
        statusCode: 429,
      });
    });
  });

  describe("admitToQueue", () => {
    it("counts every ask of a reader without a vote, and none of a reader who votes", async () => {
      await admitToQueuePg(stranger(1), NOW);
      await admitToQueuePg(stranger(2), NOW);
      await admitToQueuePg(unconfirmed("u"), NOW);
      expect(await used("voteless-asks")).toBe(3);
      await fill("voteless-asks", VOTELESS_ASK_DAILY_LIMIT);
      await fill("voteless-answers", VOTELESS_DAILY_LIMIT);
      await expect(admitToQueuePg(voter("a"), NOW)).resolves.toBeUndefined();
    });

    it("refuses once the day's asks are used up", async () => {
      await fill("voteless-asks", VOTELESS_ASK_DAILY_LIMIT);
      await expect(admitToQueuePg(stranger(1), NOW)).rejects.toThrow(
        /załóż konto/,
      );
      await expect(admitToQueuePg(unconfirmed("u"), NOW)).rejects.toMatchObject(
        { statusCode: 429 },
      );
    });

    it("serves no crop once the day's answers without a vote are used up, as any reading of it would be refused", async () => {
      await fill("voteless-answers", VOTELESS_DAILY_LIMIT);
      await expect(admitToQueuePg(stranger(1), NOW)).rejects.toMatchObject({
        statusCode: 429,
      });
      await expect(admitToQueuePg(unconfirmed("u"), NOW)).rejects.toThrow(
        /Potwierdź adres/,
      );
    });
  });

  describe("queueFor", () => {
    it("serves drafts first, finishes half-read crops first, and never repeats one", async () => {
      await ownCrop("published", { priority: 3, rand: 0.1 });
      await ownCrop("fresh", { priority: 0, answerCount: 0, rand: 0.2 });
      await ownCrop("half-read", { priority: 0, answerCount: 1, rand: 0.9 });
      await ownCrop("undated-draft", { priority: 1, rand: 0.3 });
      await ownCrop("read-already", { priority: 4, rand: 0.01 });
      await ownCrop("settled", { status: "agreed", rand: 0.05 });
      await put("declaration_answers", "fresh_a", {
        extractId: "fresh",
        uid: "a",
        counted: true,
        day: DAY,
      });

      const queue = await queueForPg("a", 5);

      expect(served(queue)).toEqual([
        "half-read",
        "undated-draft",
        "published",
        "read-already",
      ]);
      expect(queue.task).toMatchObject({
        unit: "Strzelin",
        office: "Rada gminy",
        declarationYear: 2023,
        documentUrl: "https://bip.example.pl/half-read.pdf",
        host: "bip.example.pl",
        images: { date: `data:image/png;base64,${PNG.$bytes}`, name: null },
      });
      // Nothing that names the person but the form, and no date.
      expect(JSON.stringify(queue)).not.toMatch(
        /kowalska|birth|\d{4}-\d{2}-\d{2}/,
      );
      expect(queue.open).toBe(5);
      expect(queue.mine.total).toBe(1);
    });

    it("sends no name crop while readers are not asked for names", async () => {
      await crop("named", {
        imageSize: {
          date: { width: 951, height: 105 },
          name: { width: 1160, height: 94 },
        },
      });
      await put("declaration_extract_images", "named", {
        date: PNG,
        name: PNG,
      });
      const queue = await queueForPg("a", 1);
      expect(queue.task?.images.name).toBeNull();
      expect(queue.task?.imageSize.name).toBeNull();
    });

    it("leaves out the crops the page already holds", async () => {
      await ownCrop("one", { rand: 0.1 });
      await ownCrop("two", { rand: 0.2 });
      const queue = await queueForPg("a", 3, new Set(["one"]));
      expect(queue.task?.id).toBe("two");
      expect(queue.upcoming).toEqual([]);
    });

    it("serves a reader without an account like any other: never a crop twice, and their own count", async () => {
      await ownCrop("one", { rand: 0.1 });
      await ownCrop("two", { rand: 0.2 });
      await answerAs(stranger(1), BORN, "one");
      const queue = await queueForPg(stranger(1).uid, 3);
      expect(served(queue)).toEqual(["two"]);
      expect(queue.mine.total).toBe(1);
    });

    it("finishes first the crops a vote short, not those only answers without a vote reached", async () => {
      await ownCrop("voted", { rand: 0.9 });
      await ownCrop("unvoted", { rand: 0.1 });
      await answer("a", BORN, "voted");
      await answerAs(stranger(1), BORN, "unvoted");
      await answerAs(stranger(2), BORN, "unvoted");
      expect(served(await queueForPg("b", 3))).toEqual(["voted", "unvoted"]);
    });

    describe("one crop a person", () => {
      it("serves the first of a person's crops in the queue's order, and the next person's", async () => {
        await crop("hers-1", { personIds: ["kowalska"], rand: 0.1 });
        await crop("hers-2", { personIds: ["kowalska"], rand: 0.2 });
        await crop("his", { personIds: ["nowak"], rand: 0.3 });
        await crop("hers-3", { personIds: ["kowalska"], rand: 0.4 });
        expect(served(await queueForPg("a", 5))).toEqual(["hers-1", "his"]);
      });

      it("sends every reader to the same crop of a person, until it settles", async () => {
        await crop("hers-1", { personIds: ["kowalska"], rand: 0.1 });
        await crop("hers-2", { personIds: ["kowalska"], rand: 0.2 });
        await crop("his", { personIds: ["nowak"], rand: 0.3 });
        await answer("a", BORN, "hers-1");
        expect(served(await queueForPg("a", 5))).toEqual(["his"]);
        expect(served(await queueForPg("b", 5))).toEqual(["hers-1", "his"]);
        await answer("b", BORN, "hers-1");
        expect(served(await queueForPg("c", 5))).toEqual(["hers-2", "his"]);
      });

      it("holds a reader's crops without a vote the same way", async () => {
        await crop("hers-1", { personIds: ["kowalska"], rand: 0.1 });
        await crop("hers-2", { personIds: ["kowalska"], rand: 0.2 });
        await crop("his", { personIds: ["nowak"], rand: 0.3 });
        await answerAs(stranger(1), BORN, "hers-1");
        expect(served(await queueForPg(stranger(1).uid, 5))).toEqual(["his"]);
      });

      it("passes over the people of the crops the page holds, and those it is told of", async () => {
        await crop("hers-1", { personIds: ["kowalska"], rand: 0.1 });
        await crop("hers-2", { personIds: ["kowalska"], rand: 0.2 });
        await crop("his", { personIds: ["nowak"], rand: 0.3 });
        expect(served(await queueForPg("a", 5, new Set(["hers-1"])))).toEqual([
          "his",
        ]);
        expect(
          served(
            await queueForPg("a", 5, new Set(["gone"]), new Set(["kowalska"])),
          ),
        ).toEqual(["his"]);
      });

      it("serves a crop of two people while one of them has none in hand", async () => {
        await crop("hers", { personIds: ["kowalska"], rand: 0.1 });
        await crop("theirs", { personIds: ["kowalska", "nowak"], rand: 0.2 });
        await crop("his", { personIds: ["nowak"], rand: 0.3 });
        expect(served(await queueForPg("a", 5))).toEqual(["hers", "theirs"]);
      });
    });
  });

  describe("how far the readers got", () => {
    it("counts the crops that want no more readers, and neither those that failed nor those withdrawn", async () => {
      await crop("open", { rand: 0.1 });
      for (const status of [
        "agreed",
        "unreadable",
        "disputed",
        "failed",
        "withdrawn",
      ]) {
        await crop(status, { status });
      }
      const queue = await queueForPg("a", 1);
      expect(queue.open).toBe(1);
      expect(queue.settledCrops).toBe(3);
    });

    it("gives a reader the settled crops their readings voted on", async () => {
      for (const id of ["settled", "unreadable", "still-open", "withdrawn"]) {
        await crop(id);
      }
      await answer("a", BORN, "settled");
      await answer("b", BORN, "settled");
      await answer("a", BORN, "unreadable");
      await answer("a", BORN, "still-open");
      await answer("a", BORN, "withdrawn");
      await sql`UPDATE declaration_extracts
        SET data = data || jsonb_build_object('status', id) WHERE id IN ('unreadable', 'withdrawn')`;
      expect(await settledWithReaderPg("a")).toBe(2);
      expect(await settledWithReaderPg("b")).toBe(1);
    });

    it("gives a reader nothing for a skip, or for a reading with no vote", async () => {
      await crop("skipped", { status: "agreed" });
      await crop("voteless", { status: "agreed" });
      await skipAs(voter("a"), "skipped");
      await answerAs(unconfirmed("a"), BORN, "voteless");
      expect(await settledWithReaderPg("a")).toBe(0);
    });

    // Firestore read no crop for a reader with no answer; in SQL it is one
    // statement either way, and it answers 0.
    it("gives a reader who read nothing nothing", async () => {
      await crop("settled", { status: "agreed" });
      expect(await settledWithReaderPg("a")).toBe(0);
    });
  });

  describe("a reader's finds", () => {
    const found = (uid: string, personId: string, extractId: string, n = 0) =>
      put("declaration_reader_finds", `${uid}_${personId}`, {
        uid,
        personId,
        extractId,
        at: new Date(NOW.getTime() + n * 1000).toISOString(),
      });
    const personPage = (id: string, fields: Data = {}) =>
      put("nodes", id, {
        type: "person",
        name: `Jan ${id}`,
        published: true,
        ...fields,
      });

    it("counts the people a reader found in their queue's „Znaleziono”", async () => {
      await crop("c1");
      await found("a", "kowalska", "c1");
      await found("a", "nowak", "c1");
      await found("b", "kowalska", "c1");
      expect((await queueForPg("a", 1)).mine.found).toBe(2);
      expect((await queueForPg("c", 1)).mine.found).toBe(0);
    });

    it("moves what a browser found to the account it signs in to, once a person", async () => {
      await crop("c1");
      await answerAs(stranger(1), BORN, "c1");
      const anon = `anon:${readerId(1)}`;
      await found(anon, "kowalska", "c1");
      await found(anon, "nowak", "c9");
      // The account found Nowak itself already.
      await found("a", "nowak", "c8");
      await claim(1, account("a"));
      const ids = (
        await sql<
          { id: string }[]
        >`SELECT id FROM declaration_reader_finds ORDER BY id`
      ).map((row) => row.id);
      expect(ids).toEqual(["a_kowalska", "a_nowak"]);
      expect((await queueForPg("a", 1)).mine.found).toBe(2);
    });

    // A claim that failed after its answers had moved, and before its finds
    // did: the next claim has only finds to move.
    it("moves what a browser found when no answer is left to move with it", async () => {
      const anon = `anon:${readerId(1)}`;
      await found(anon, "kowalska", "c1");
      expect(await claim(1, account("a"))).toEqual({
        claimed: 0,
        settled: [],
        left: 0,
      });
      expect(await has("declaration_reader_finds", `${anon}_kowalska`)).toBe(
        false,
      );
      expect(
        await read("declaration_reader_finds", "a_kowalska"),
      ).toMatchObject({ uid: "a", personId: "kowalska" });
    });

    it("lists whom a reader found, the newest first, with the declaration that found them", async () => {
      await crop("c1");
      await crop("c2", {
        declarationYear: 2024,
        units: [
          { teryt: "0264011", unitName: "Testowice", office: "Burmistrz" },
        ],
      });
      await personPage("szablonowy");
      await personPage("atrapowa", { published: false });
      await found("a", "szablonowy", "c1", 1);
      await found("a", "atrapowa", "c2", 2);
      await found("b", "szablonowy", "c1", 3);
      expect(await findsOfPg("a")).toEqual({
        total: 2,
        people: [
          {
            id: "atrapowa",
            name: "Jan atrapowa",
            published: false,
            unit: "Testowice",
            office: "Burmistrz",
            declarationYear: 2024,
          },
          {
            id: "szablonowy",
            name: "Jan szablonowy",
            published: true,
            unit: "Strzelin",
            office: "Rada gminy",
            declarationYear: 2023,
          },
        ],
      });
      expect(await findsOfPg("c")).toEqual({ people: [], total: 0 });
    });

    it("lists a page merged since as the page it went into, once", async () => {
      await crop("c1");
      await personPage("stara", { merged_into: "nowa" });
      await personPage("nowa");
      await found("a", "stara", "c1", 1);
      await found("a", "nowa", "c1", 2);
      const { people, total } = await findsOfPg("a");
      expect(people.map((person) => person.id)).toEqual(["nowa"]);
      expect(total).toBe(2);
    });

    it("leaves out a page that is gone, removed or not a person, and counts it", async () => {
      await crop("c1");
      await personPage("jest");
      await personPage("usunieta", { deleted: true });
      await personPage("firma", { type: "place" });
      await found("a", "jest", "c1", 1);
      await found("a", "usunieta", "c1", 2);
      await found("a", "firma", "c1", 3);
      await found("a", "nie-ma", "c1", 4);
      const { people, total } = await findsOfPg("a");
      expect(people.map((person) => person.id)).toEqual(["jest"]);
      expect(total).toBe(4);
    });

    it("lists a person whose crop is gone without the declaration", async () => {
      await personPage("szablonowy");
      await found("a", "szablonowy", "zniknal", 1);
      expect((await findsOfPg("a")).people).toEqual([
        {
          id: "szablonowy",
          name: "Jan szablonowy",
          published: true,
          unit: "",
          office: null,
          declarationYear: null,
        },
      ]);
    });

    it("lists the newest of a long run, and counts them all", async () => {
      await crop("c1");
      for (let n = 0; n <= FOUND_LIST_LIMIT; n++) {
        await personPage(`p${n}`);
        await found("a", `p${n}`, "c1", n);
      }
      const { people, total } = await findsOfPg("a");
      expect(people).toHaveLength(FOUND_LIST_LIMIT);
      expect(people[0]!.id).toBe(`p${FOUND_LIST_LIMIT}`);
      expect(people.map((person) => person.id)).not.toContain("p0");
      expect(total).toBe(FOUND_LIST_LIMIT + 1);
    });

    it("has the index its query needs: a reader's finds, the newest first", async () => {
      const indexes = await sql<{ def: string }[]>`
        SELECT indexdef AS def FROM pg_indexes
        WHERE tablename = 'declaration_reader_finds'`;
      expect(
        indexes.some(
          ({ def }) =>
            def.includes("jsonb_text((data -> 'uid'::text))") &&
            /jsonb_text\(\(data -> 'at'::text\)\) COLLATE "C" DESC/.test(def),
        ),
      ).toBe(true);
    });
  });

  describe("claimAnswers", () => {
    it("moves a browser's answers onto the account, with the account's vote", async () => {
      await crop("c1");
      await crop("c2");
      await answerAs(stranger(1), BORN, "c1");
      await skipAs(stranger(1), "c2");
      expect(await claim(1, account("a"))).toEqual({
        claimed: 2,
        settled: [],
        left: 0,
      });
      expect(await has("declaration_answers", `c1_anon:${readerId(1)}`)).toBe(
        false,
      );
      expect(await read("declaration_answers", "c1_a")).toMatchObject({
        extractId: "c1",
        uid: "a",
        verdict: "date",
        value: BORN,
        votes: true,
        counted: true,
        day: DAY,
        imageHash: "hash",
        claimedFrom: `anon:${readerId(1)}`,
      });
      expect(await read("declaration_answers", "c2_a")).toMatchObject({
        verdict: "skip",
        counted: false,
      });
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        status: "open",
        answerCount: 1,
        answers: { readings: { [BORN]: 1 } },
      });
      expect((await queueForPg("a", 1)).mine.total).toBe(1);
      expect(
        await read("declaration_reader_limits", `${LIMITS}_a`),
      ).toMatchObject({ count: 1 });
    });

    it("keeps the account's own answer to a crop it answered itself, and gives back the vote it took for the other", async () => {
      await crop("c1");
      await answer("a", "1980-01-01");
      await answerAs(stranger(1), BORN);
      expect(await claim(1, account("a"))).toEqual({
        claimed: 0,
        settled: [],
        left: 0,
      });
      const own = await read("declaration_answers", "c1_a");
      expect(own).toMatchObject({ value: "1980-01-01" });
      expect(own).not.toHaveProperty("claimedFrom");
      expect(await has("declaration_answers", `c1_anon:${readerId(1)}`)).toBe(
        false,
      );
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        answerCount: 1,
        answers: { readings: { "1980-01-01": 1 } },
      });
      expect(
        await read("declaration_reader_limits", `${LIMITS}_a`),
      ).toMatchObject({ count: 1 });
    });

    it("lets the browser's reading that votes stand over one the account gave before its address was confirmed", async () => {
      await crop("c1");
      await answerAs(unconfirmed("u"), "1980-01-01");
      await answerAs(stranger(1), BORN);
      expect(await claim(1, account("u"))).toEqual({
        claimed: 1,
        settled: [],
        left: 0,
      });
      expect(await read("declaration_answers", "c1_u")).toMatchObject({
        value: BORN,
        votes: true,
        claimedFrom: `anon:${readerId(1)}`,
      });
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        answerCount: 1,
        answers: { readings: { [BORN]: 1 } },
      });
    });

    it("settles a crop once two accounts that vote have claimed answers that agree", async () => {
      await crop("c1");
      await answerAs(stranger(1), BORN);
      await answerAs(stranger(2), BORN);
      expect(await claim(1, account("a"))).toEqual({
        claimed: 1,
        settled: [],
        left: 0,
      });
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        status: "open",
      });
      expect(await claim(2, account("b"))).toEqual({
        claimed: 1,
        settled: [
          {
            extractId: "c1",
            settlement: {
              status: "agreed",
              value: BORN,
              kind: "date",
              readers: 2,
            },
          },
        ],
        left: 0,
      });
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        status: "agreed",
        agreed: { value: BORN, kind: "date", by: "readers", readers: 2 },
        answerCount: 2,
      });
    });

    it("refuses an account without a confirmed address, and leaves the answers for a claim once it is confirmed", async () => {
      await crop("c1");
      await answerAs(stranger(1), BORN);
      const before = await state();
      const refused = claim(1, account("u", { email_verified: false }));
      await expect(refused).rejects.toMatchObject({ statusCode: 403 });
      await expect(refused).rejects.toThrow(/Potwierdź adres/);
      expect(await state()).toBe(before);
      expect(await claim(1, account("u"))).toEqual({
        claimed: 1,
        settled: [],
        left: 0,
      });
      expect(await read("declaration_answers", "c1_u")).toMatchObject({
        votes: true,
      });
    });

    it("answers 0 to an account without a confirmed address for a browser with no reading to move, and moves nothing", async () => {
      await crop("c1");
      // Another browser's reading is not this one's to wait for.
      await answerAs(stranger(3), BORN);
      const before = await state();
      expect(await claim(1, account("u", { email_verified: false }))).toEqual({
        claimed: 0,
        settled: [],
        left: 0,
      });
      expect(await state()).toBe(before);
      // A skip is no reading, as the reader's own count has it.
      await skipAs(stranger(2), "c1");
      const skipped = await state();
      expect(await claim(2, account("u", { email_verified: false }))).toEqual({
        claimed: 0,
        settled: [],
        left: 0,
      });
      expect(await state()).toBe(skipped);
    });

    it("votes within the account's daily limit, on the day each answer was given, and moves the rest without a vote", async () => {
      await crop("c1");
      await crop("c2");
      await crop("c3");
      await put("declaration_reader_limits", `${LIMITS}_a`, {
        count: READER_DAILY_LIMIT - 1,
        day: DAY,
      });
      await answerAs(stranger(1), BORN, "c1");
      await answerAs(stranger(1), BORN, "c2");
      const from = anonymousUid(readerId(1));
      await put("declaration_answers", `c3_${from}`, {
        extractId: "c3",
        uid: from,
        verdict: "date",
        value: BORN,
        votes: false,
        counted: true,
        day: "2026-10-28",
        imageHash: "hash",
      });
      expect((await claim(1, account("a"))).claimed).toBe(3);
      const today = await Promise.all(
        ["c1", "c2"].map(
          async (id) => (await read("declaration_answers", `${id}_a`))!.votes,
        ),
      );
      expect(today.sort()).toEqual([false, true]);
      expect(await read("declaration_answers", "c3_a")).toMatchObject({
        votes: true,
      });
      expect(
        await read("declaration_reader_limits", `${LIMITS}_a`),
      ).toMatchObject({ count: READER_DAILY_LIMIT });
      expect(
        await read("declaration_reader_limits", "2026-10-28_a"),
      ).toMatchObject({ count: 1 });
    });

    it("lets no account vote on more crops a day by claiming one browser after another", async () => {
      await crop("c1");
      await crop("c2");
      await put("declaration_reader_limits", `${LIMITS}_a`, {
        count: READER_DAILY_LIMIT - 1,
        day: DAY,
      });
      await answerAs(stranger(1), BORN, "c1");
      await answerAs(stranger(2), BORN, "c2");
      await claim(1, account("a"));
      await claim(2, account("a"));
      expect(await read("declaration_answers", "c1_a")).toMatchObject({
        votes: true,
      });
      expect(await read("declaration_answers", "c2_a")).toMatchObject({
        votes: false,
      });
      expect(await read("declaration_extracts", "c2")).toMatchObject({
        answerCount: 0,
      });
      expect(
        await read("declaration_reader_limits", `${LIMITS}_a`),
      ).toMatchObject({ count: READER_DAILY_LIMIT });
    });

    it("drops an answer read off a picture the crop has since been cut again from, and gives its vote back", async () => {
      await crop("c1");
      await answerAs(stranger(1), BORN);
      await crop("c1", { imageHash: "recut" });
      expect(await claim(1, account("a"))).toEqual({
        claimed: 0,
        settled: [],
        left: 0,
      });
      expect(await has("declaration_answers", `c1_anon:${readerId(1)}`)).toBe(
        false,
      );
      expect(await has("declaration_answers", "c1_a")).toBe(false);
      expect(await read("declaration_extracts", "c1")).toMatchObject({
        answerCount: 0,
      });
      expect(
        await read("declaration_reader_limits", `${LIMITS}_a`),
      ).toMatchObject({ count: 0 });
    });

    it("finds nothing the second time, and writes nothing", async () => {
      await crop("c1");
      await answerAs(stranger(1), BORN);
      await claim(1, account("a"));
      const before = await state();
      expect(await claim(1, account("a"))).toEqual({
        claimed: 0,
        settled: [],
        left: 0,
      });
      expect(await state()).toBe(before);
    });

    it("leaves another browser's answers alone", async () => {
      await crop("c1");
      await answerAs(stranger(1), BORN);
      await answerAs(stranger(2), "1979-07-16");
      await claim(1, account("a"));
      expect(
        await read("declaration_answers", `c1_anon:${readerId(2)}`),
      ).toMatchObject({ value: "1979-07-16", votes: false });
    });

    it(`moves at most ${CLAIM_LIMIT} answers a claim`, async () => {
      const from = anonymousUid(readerId(1));
      const rows = Array.from({ length: CLAIM_LIMIT + 1 }, (_, i) => ({
        id: `x${i}_${from}`,
        data: {
          extractId: `x${i}`,
          uid: from,
          verdict: "date",
          value: BORN,
          votes: false,
          counted: true,
          day: "2026-10-28",
        },
      }));
      await sql`
        INSERT INTO declaration_answers (id, data)
        SELECT r ->> 'id', r -> 'data' FROM jsonb_array_elements(${sql.json(rows)}::jsonb) AS r`;
      expect((await claim(1, account("a"))).claimed).toBe(CLAIM_LIMIT);
      expect((await claim(1, account("a"))).claimed).toBe(1);
      // All given on one day, so a day's worth of them vote.
      const [voting] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM declaration_answers
        WHERE data -> 'votes' = 'true'::jsonb`;
      expect(voting!.n).toBe(READER_DAILY_LIMIT);
    }, 120_000);

    // 2026-10-31: one of twenty crops lost to contention, and the claim
    // stopped with eight readings under the browser's id.
    it("moves the rest when one crop's transaction fails among the others, and that crop once they are done", async () => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      const crops = Array.from({ length: 25 }, (_, i) => `c${i}`);
      for (const id of crops) {
        await crop(id);
        await answerAs(stranger(1), BORN, id);
      }
      await failing(`c3_anon:${readerId(1)}`, 1);
      expect(await claim(1, account("a"))).toEqual({
        claimed: 25,
        settled: [],
        left: 0,
      });
      for (const id of crops) {
        expect(await read("declaration_answers", `${id}_a`)).toMatchObject({
          votes: true,
        });
      }
      expect(
        await read("declaration_reader_limits", `${LIMITS}_a`),
      ).toMatchObject({ count: 25 });
      quiet.mockRestore();
    });

    it("leaves what fails alone too under the browser's id, gives back its votes, and moves it with the next claim", async () => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      for (const id of ["c1", "c2", "c3"]) {
        await crop(id);
        await answerAs(stranger(1), BORN, id);
      }
      const from = anonymousUid(readerId(1));
      await put("declaration_reader_finds", `${from}_kowalska`, {
        uid: from,
        personId: "kowalska",
        extractId: "c1",
      });
      // c1 fails with the others and alone; c2 with the others only, and is
      // not tried alone once c1 has failed there.
      await failing(`c1_${from}`, 2);
      await failing(`c2_${from}`, 1);
      expect(await claim(1, account("a"))).toEqual({
        claimed: 1,
        settled: [],
        left: 2,
      });
      for (const id of ["c1", "c2"]) {
        expect(
          await read("declaration_answers", `${id}_${from}`),
        ).toMatchObject({ votes: false });
      }
      expect(await read("declaration_answers", "c3_a")).toMatchObject({
        votes: true,
      });
      expect(
        await read("declaration_reader_limits", `${LIMITS}_a`),
      ).toMatchObject({ count: 1 });
      expect(
        await read("declaration_reader_finds", "a_kowalska"),
      ).toMatchObject({ uid: "a" });
      expect(quiet).toHaveBeenCalled();
      expect(await claim(1, account("a"))).toEqual({
        claimed: 2,
        settled: [],
        left: 0,
      });
      expect(await read("declaration_answers", "c1_a")).toMatchObject({
        votes: true,
      });
      expect(
        await read("declaration_reader_limits", `${LIMITS}_a`),
      ).toMatchObject({ count: 3 });
      quiet.mockRestore();
    });
  });
});
