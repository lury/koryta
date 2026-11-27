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
import pagesGet from "~~/server/api/pages/index.get";
import pageGet from "~~/server/api/pages/[id].get";
import { normalizeUrl } from "~~/shared/url";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** The captures the extension and /zrodla poll, read from `article_pages`.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/pages.pg.test.ts
 */

const { verifyIdToken } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.getRequestHeader = () => "Bearer token-under-test";
  g.getValidatedQuery = async (
    event: TestEvent,
    parse: (q: unknown) => unknown,
  ) => parse(event.query ?? {});
  g.getRouterParam = (event: TestEvent, name: string) => event.params?.[name];
  return {
    verifyIdToken: {
      fn: async (): Promise<unknown> => ({ uid: "u", datascience: true }),
    },
  };
});
// server/utils/auth stays real, so the datascience gate is the one the
// endpoint runs; only the token lookup is faked.
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: () => verifyIdToken.fn() }),
}));

const store = new Collections();
let sql: postgres.Sql;

const list = (query: Record<string, string> = {}) =>
  (pagesGet as (e: unknown) => Promise<{ captures: { id: string }[] }>)({
    query,
    headers: {},
  });
const ids = async (query: Record<string, string> = {}) =>
  (await list(query)).captures.map((c) => c.id);

/** A capture of `url`, `minutes` past 10:00 on 2026-11-20. */
function capture(id: string, url: string, minutes: number, extra = {}) {
  store.table("articlePages")[id] = {
    url,
    normalizedUrl: normalizeUrl(url),
    status: "done",
    capturedAt: new Date(Date.UTC(2026, 10, 20, 10, minutes)).toISOString(),
    ...extra,
  };
}

describe.runIf(PG_TEST_DATABASE_URL)("GET /api/pages on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("pages");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    verifyIdToken.fn = async () => ({ uid: "u", datascience: true });
  });

  it("matches a capture across the spellings of one url", async () => {
    // Filed under the page's canonical url, asked for from a browser's bar:
    // the scheme, a leading www. and a trailing slash do not matter.
    capture("a", "https://example.pl/artykuł", 1);
    capture("b", "https://example.pl/inny", 2);
    await store.sync(sql);
    expect(await ids({ url: "https://www.example.pl/artykuł/" })).toEqual([
      "a",
    ]);
    expect(await ids({ url: "example.pl/artykuł" })).toEqual(["a"]);
  });

  it("keeps the query string, which is an article id on some sites", async () => {
    capture("seven", "https://example.pl/a?id=7", 1);
    capture("eight", "https://example.pl/a?id=8", 2);
    await store.sync(sql);
    expect(await ids({ url: "https://example.pl/a?id=7" })).toEqual(["seven"]);
  });

  it("does not filter by url unless asked, and filters by status", async () => {
    capture("a", "https://example.pl/a", 1);
    capture("b", "https://example.pl/b", 2, { status: "error" });
    await store.sync(sql);
    expect(await ids()).toEqual(["b", "a"]);
    expect(await ids({ status: "error" })).toEqual(["b"]);
  });

  it("serves newest first, limited", async () => {
    for (let i = 0; i < 5; i++) capture(`c${i}`, `https://example.pl/${i}`, i);
    await store.sync(sql);
    expect(await ids({ limit: "2" })).toEqual(["c4", "c3"]);
    expect(await ids()).toHaveLength(5);
  });

  it("refuses a caller outside the datascience group", async () => {
    verifyIdToken.fn = async () => ({ uid: "someone", datascience: false });
    await store.sync(sql);
    expect(await statusOf(list())).toBe(403);
  });

  it("serves one capture by id, 404 for none", async () => {
    capture("a", "https://example.pl/a", 1, { title: "Tytuł" });
    await store.sync(sql);
    const one = (id: string) =>
      (
        pageGet as (e: unknown) => Promise<{ capture: Record<string, unknown> }>
      )({
        params: { id },
        headers: {},
      });
    expect((await one("a")).capture).toMatchObject({
      id: "a",
      title: "Tytuł",
      capturedAt: "2026-11-20T10:01:00.000Z",
    });
    expect(await statusOf(one("nope"))).toBe(404);
  });
});
