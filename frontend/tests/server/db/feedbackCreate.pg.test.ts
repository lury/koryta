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
import handler from "~~/server/api/feedback/create.post";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** /api/feedback/create on Postgres: a report stored with what the request
 * says about its sender, and the day's ceiling on what goes to Slack.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/feedbackCreate.pg.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

let sql: postgres.Sql;

const { queries } = vi.hoisted(() => ({ queries: [] as LoggedQuery[] }));
// Every query the handler sends, logged: which tables a call read.
vi.mock("~~/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/db/client")>();
  const { logQueries } =
    await vi.importActual<typeof import("./queryLog")>("./queryLog");
  // Statements inside a transaction are logged too.
  const logged = (sql: ReturnType<typeof actual.useDb>) =>
    new Proxy(logQueries(sql, queries), {
      get(target, key, receiver) {
        if (key !== "begin") return Reflect.get(target, key, receiver);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (...args: any[]) => {
          const fn = args.pop();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (sql.begin as any)(...args, (tx: any) =>
            fn(logQueries(tx, queries)),
          );
        };
      },
    });
  return { ...actual, useDb: () => logged(actual.useDb()) };
});

/** Writes `stored` to the tables and starts the query log afresh. */
async function arrange(stored: StoredDocs) {
  await syncStored(sql, stored);
  queries.length = 0;
}

/** Opens this file's database; run inside the describe. */
function useDatabase() {
  beforeAll(async () => {
    sql = await openTestDatabase("feedback_create");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}
const { mockVerifyIdToken, dailyCount } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.getRequestHeader = (
    event: { headers?: Record<string, string> },
    name: string,
  ) => event.headers?.[name.toLowerCase()];

  return {
    mockVerifyIdToken: vi.fn(),
    // How many reports today's counter already holds, for the daily-cap tests.
    dailyCount: { value: 0 },
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => parser(event.body),
  };
});

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

type Event = { body: unknown; headers?: Record<string, string> };

/** Today's counter set to `dailyCount`, then the request. */
const callHandler = async (event: Event) => {
  const day = new Date().toISOString().slice(0, 10);
  await arrange(
    dailyCount.value > 0
      ? { [`feedbackLimits/${day}`]: { count: dailyCount.value, day } }
      : {},
  );
  return (handler as unknown as (e: Event) => Promise<{ id: string | null }>)(
    event,
  );
};

const validBody = {
  kind: "bug",
  message: "  Coś tu nie gra  ",
  context: { route: "/osoba/jan-testowy", nodeId: "node-1" },
};

/** The reports stored. */
const reports = async () =>
  (
    await sql<{ id: string; data: Record<string, any> }[]>`
      SELECT id, data FROM feedback ORDER BY id`
  ).map((row) => ({ id: row.id, ...row.data }));
/** The one report stored, without its id. */
const written = async () => {
  const [{ id: _id, ...report } = {} as Record<string, any>] = await reports();
  return report;
};

describe.runIf(PG_TEST_DATABASE_URL)("/api/feedback/create on Postgres", () => {
  useDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    dailyCount.value = 0;
  });

  it("accepts a report from a signed-out visitor", async () => {
    const result = await callHandler({ body: validBody });

    expect(result).toEqual({ id: (await reports())[0]!.id });
    expect(await written()).toMatchObject({
      kind: "bug",
      message: "Coś tu nie gra",
      adminStatus: "new",
    });
    // Anonymous reports carry no uid at all rather than a placeholder.
    expect(await written()).not.toHaveProperty("userUid");
  });

  it("attributes the report when a valid token is sent", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "user-a" });

    await callHandler({
      body: validBody,
      headers: { authorization: "Bearer good-token" },
    });

    expect(await written()).toMatchObject({ userUid: "user-a" });
  });

  it("falls back to anonymous rather than failing on a bad token", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("expired"));

    await callHandler({
      body: validBody,
      headers: { authorization: "Bearer stale-token" },
    });

    expect(await written()).not.toHaveProperty("userUid");
  });

  it("records the user agent from the request, not the body", async () => {
    await callHandler({
      body: validBody,
      headers: { "user-agent": "Mozilla/5.0 (test)" },
    });

    expect((await written()).context).toMatchObject({
      route: "/osoba/jan-testowy",
      userAgent: "Mozilla/5.0 (test)",
    });
  });

  it("rejects an empty message and an unknown kind", async () => {
    await expect(
      callHandler({ body: { ...validBody, message: "   " } }),
    ).rejects.toThrow();

    await expect(
      callHandler({ body: { ...validBody, kind: "spam" } }),
    ).rejects.toThrow();

    expect(await reports()).toEqual([]);
  });

  // The admin panel renders the route as a link, so anything that is not a
  // site-relative path is a way to hand an admin a hostile URL.
  it.each([
    "javascript:alert(1)",
    "https://evil.example/login",
    "//evil.example",
    "osoba/bez-ukosnika",
  ])("refuses a route that is not site-relative: %s", async (route) => {
    await expect(
      callHandler({ body: { ...validBody, context: { route } } }),
    ).rejects.toThrow();

    expect(await reports()).toEqual([]);
  });

  it("keeps the QA entry a verdict was written about", async () => {
    await callHandler({
      body: {
        ...validBody,
        context: {
          route: "/qa",
          qa: {
            itemId: "person-places-map",
            title: "Mapa miejsc osoby w panelu bocznym",
            status: "issue",
          },
        },
      },
    });

    // Same collection, same trigger, same queue as a report from the "Zgłoś"
    // button - it just also knows which entry was being checked.
    expect((await written()).context.qa).toEqual({
      itemId: "person-places-map",
      title: "Mapa miejsc osoby w panelu bocznym",
      status: "issue",
    });
    expect(await written()).toMatchObject({ adminStatus: "new" });
  });

  it("refuses a QA context that is not a verdict on an entry", async () => {
    for (const qa of [
      { itemId: "a", title: "T", status: "maybe" },
      { itemId: "", title: "T", status: "ok" },
      { itemId: "a", status: "ok" },
    ]) {
      await expect(
        callHandler({
          body: { ...validBody, context: { route: "/qa", qa } },
        }),
      ).rejects.toThrow();
    }

    expect(await reports()).toEqual([]);
  });

  it("drops a submission that filled the honeypot, without saying so", async () => {
    const result = await callHandler({
      body: { ...validBody, website: "http://spam.example" },
    });

    expect(result).toEqual({ id: null });
    expect(await reports()).toEqual([]);
  });

  it("still saves past the daily cap, but marks it not to reach Slack", async () => {
    dailyCount.value = 500;

    await callHandler({ body: validBody });

    // The report is kept - /admin/opinie stays authoritative - and only the
    // forward is suppressed, so one abuser cannot silence real reporters.
    expect(await reports()).toHaveLength(1);
    expect((await written()).slack).toEqual({
      state: "failed",
      error: "daily_cap",
    });
  });

  it("leaves the Slack state alone under the cap", async () => {
    dailyCount.value = 3;

    await callHandler({ body: validBody });

    expect(await written()).not.toHaveProperty("slack");
  });
});
