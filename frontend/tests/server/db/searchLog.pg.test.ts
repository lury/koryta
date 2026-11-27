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
import logHandler from "~~/server/api/search/log.post";
import { searchesSincePg } from "~~/server/db/ops";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** The search box's log on Postgres (`ops.search_queries`): what is kept of
 * a settled search, and nothing about who asked.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/searchLog.pg.test.ts
 */

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);
});
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
  readBody: async (event: { body: unknown }) => event.body,
}));
vi.mock("~~/server/utils/auth", () => ({
  getOptionalUser: async (event: { headers?: Record<string, string> }) =>
    event.headers?.authorization
      ? { uid: "reader-uid", email: "a@b.pl" }
      : null,
}));

let sql: postgres.Sql;
const stored = async () =>
  (
    await sql<{ data: Record<string, unknown> }[]>`
      SELECT data FROM ops.search_queries ORDER BY id`
  ).map((row) => row.data);

const log = (body: unknown, headers: Record<string, string> = {}) =>
  (logHandler as unknown as (event: unknown) => Promise<unknown>)({
    body,
    headers,
  });

const ENTRY = {
  query: "  Jan   KOWALSKI ",
  results: 2,
  unverified: 2,
  outcome: "pick",
  picked: "person",
  pickedUnverified: true,
};

describe.runIf(PG_TEST_DATABASE_URL)("POST /api/search/log on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("search_log");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(async () => {
    await sql`TRUNCATE ops.search_queries`;
  });

  it("keeps the search, normalised, in the ops schema", async () => {
    expect(await log(ENTRY)).toEqual({ recorded: true });

    const added = await stored();
    expect(added).toHaveLength(1);
    const [doc] = added;
    expect(doc).toMatchObject({
      query: "jan kowalski",
      results: 2,
      unverified: 2,
      outcome: "pick",
      picked: "person",
      pickedUnverified: true,
      signedIn: false,
    });
    // Kept for 180 days, then expire_documents() takes it.
    const at = Date.parse(doc!.at as string);
    const expireAt = Date.parse(doc!.expireAt as string);
    expect(expireAt - at).toBe(180 * 24 * 60 * 60 * 1000);
    // As the summary reads it back, and as expire_documents() deletes it.
    expect(await searchesSincePg(new Date(at - 1).toISOString(), 10)).toEqual(
      added,
    );
    await sql`UPDATE ops.search_queries SET data = data || jsonb_build_object('expireAt', '2000-01-01T00:00:00.000Z')`;
    await sql`SELECT expire_documents()`;
    expect(await stored()).toEqual([]);
  });

  it("notes that somebody was signed in, and nothing else about them", async () => {
    await log(ENTRY, { authorization: "Bearer token" });

    const [doc] = await stored();
    expect(doc!.signedIn).toBe(true);
    expect(JSON.stringify(doc)).not.toMatch(/reader-uid|a@b\.pl/);
  });

  it("never stores more unpublished hits than there were hits", async () => {
    await log({ ...ENTRY, results: 1, unverified: 9 });
    expect((await stored())[0]!.unverified).toBe(1);
  });

  it("keeps what was opened only for a search that opened something", async () => {
    await log({ ...ENTRY, outcome: "abandon" });
    const [doc] = await stored();
    expect(doc).not.toHaveProperty("picked");
    expect(doc).not.toHaveProperty("pickedUnverified");
  });

  it("skips a query too short to be a search", async () => {
    expect(await log({ ...ENTRY, query: " ko " })).toEqual({
      recorded: false,
    });
    expect(await stored()).toHaveLength(0);
  });

  it("refuses what the search box would never send", async () => {
    for (const body of [
      { ...ENTRY, outcome: "hover" },
      { ...ENTRY, picked: "Jan Kowalski" },
      { ...ENTRY, results: -1 },
      { ...ENTRY, query: "x".repeat(500) },
      null,
    ]) {
      await expect(log(body)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(await stored()).toHaveLength(0);
  });
});
