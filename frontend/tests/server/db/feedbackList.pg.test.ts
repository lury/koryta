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
import handler from "~~/server/api/feedback/list.get";
import type { Feedback, FeedbackStatus } from "~~/shared/model";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** /api/feedback/list on Postgres: every open report, the newest settled
 * ones, and one more a link names.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/feedbackList.pg.test.ts
 */

const { mockGetUser } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);
  return { mockGetUser: vi.fn() };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: { query: unknown },
      parser: (q: unknown) => unknown,
    ) => parser(event.query),
  };
});

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

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

/** The queries the call sent to `table`. */
const queriesOf = (table: string) =>
  queries.filter((query) => new RegExp(`FROM ${table}\\b`).test(query.text));

/** Writes `stored` to the tables and starts the query log afresh. */
async function arrange(stored: StoredDocs) {
  await syncStored(sql, stored);
  queries.length = 0;
}

/** Opens this file's database; run inside the describe. */
function useDatabase() {
  beforeAll(async () => {
    sql = await openTestDatabase("feedback_list");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}

/** A report as stored: no `id` field, the id is the row's. */
type Stored = Omit<Feedback, "id">;

/** The `feedback` table as arranged, keyed by id. */
const store = new Map<string, Stored>();

/** The look-ups of one report by id, which only `include` makes. */
const docLookups = () =>
  queriesOf("feedback")
    .filter((query) => /WHERE id = /.test(query.text))
    .map((query) => query.args[0]);

/** A report created `minutesAgo` before a fixed moment, so fixtures sort by
 * `createdAt` the way their numbering suggests. */
function report(
  status: FeedbackStatus,
  minutesAgo: number,
  extra: Partial<Stored> = {},
): Stored {
  return {
    kind: "bug",
    message: `Zgłoszenie sprzed ${minutesAgo} min`,
    context: { route: "/osoba/jan-testowy" },
    createdAt: new Date(
      Date.UTC(2026, 8, 23, 12, 0) - minutesAgo * 60_000,
    ).toISOString(),
    adminStatus: status,
    ...extra,
  };
}

/** Puts `count` reports with ids `${prefix}-0`…, the lower index the newer. */
function seed(prefix: string, count: number, status: FeedbackStatus) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${prefix}-${i}`;
    store.set(id, report(status, i));
    ids.push(id);
  }
  return ids;
}

type Result = { feedback: Feedback[]; openTruncated: boolean };

const callHandler = async (query: Record<string, unknown> = {}) => {
  await arrange(
    Object.fromEntries(
      [...store].map(([id, data]) => [`feedback/${id}`, data as never]),
    ),
  );
  return (handler as unknown as (event: unknown) => Promise<Result>)({ query });
};

const ids = (result: Result) => result.feedback.map((item) => item.id);

describe.runIf(PG_TEST_DATABASE_URL)(
  "GET /api/feedback/list on Postgres",
  () => {
    useDatabase();

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
      store.clear();
    });

    it("refuses a caller who is not an admin", async () => {
      mockGetUser.mockResolvedValue({ uid: "reader-1", admin: false });
      store.set("fb-1", report("new", 1));

      await expect(callHandler()).rejects.toMatchObject({ statusCode: 403 });

      // This route is the only guard in front of the reports, so nothing may
      // be read before the check.
      expect(queriesOf("feedback")).toHaveLength(0);
    });

    it("returns every open report, whatever the limit", async () => {
      // Older than any settled one, so a limit applied across both would cut
      // exactly these - the oldest entries of the queue - first.
      for (let i = 0; i < 150; i++) {
        store.set(
          `open-${i}`,
          report(i % 3 === 0 ? "in_progress" : "new", 10_000 + i),
        );
      }
      seed("settled", 120, "resolved");

      const result = await callHandler({ limit: "100" });

      const open = result.feedback.filter((item) =>
        item.id!.startsWith("open-"),
      );
      expect(open).toHaveLength(150);
      expect(new Set(open.map((item) => item.id))).toEqual(
        new Set(Array.from({ length: 150 }, (_, i) => `open-${i}`)),
      );
      // The limit is for history only.
      expect(
        result.feedback.filter((item) => item.id!.startsWith("settled-")),
      ).toHaveLength(100);
      expect(result.openTruncated).toBe(false);
    });

    it("splits the statuses between the two reads without dropping one", async () => {
      // "w trakcie" is still work in the queue, so it is read with "new"; a
      // status neither read asks for would vanish from the page altogether.
      store.set("fb-new", report("new", 1));
      store.set("fb-doing", report("in_progress", 2));
      store.set("fb-done", report("resolved", 3));
      store.set("fb-wont", report("wont_fix", 4));

      const result = await callHandler({ limit: "1" });

      // Both open reports however small the limit, then the newest settled.
      expect([...ids(result)].sort()).toEqual([
        "fb-doing",
        "fb-done",
        "fb-new",
      ]);
      expect(
        (await callHandler()).feedback.map((item) => item.adminStatus).sort(),
      ).toEqual(["in_progress", "new", "resolved", "wont_fix"]);
    });

    it("reads the newest settled reports, up to the limit", async () => {
      const settled = seed("settled", 30, "resolved");

      const result = await callHandler({ limit: "25" });

      expect(ids(result)).toEqual(settled.slice(0, 25));
    });

    it("defaults the settled limit to 100", async () => {
      seed("settled", 120, "resolved");

      expect((await callHandler()).feedback).toHaveLength(100);
    });

    it("returns the newest settled reports rather than any of them", async () => {
      // Stored oldest first, so an insertion-order read would get this wrong.
      for (let i = 9; i >= 0; i--) {
        store.set(`settled-${i}`, report(i % 2 ? "wont_fix" : "resolved", i));
      }

      const result = await callHandler({ limit: "3" });

      expect(ids(result)).toEqual(["settled-0", "settled-1", "settled-2"]);
    });

    it("does not report a cut when the open reports fit under the cap", async () => {
      seed("open", 500, "new");

      const result = await callHandler();

      expect(result.feedback).toHaveLength(500);
      expect(result.openTruncated).toBe(false);
    });

    it("caps the open reports at 500 and says it did", async () => {
      seed("open", 501, "new");

      const result = await callHandler();

      expect(result.feedback).toHaveLength(500);
      expect(result.openTruncated).toBe(true);
    });

    it("returns each report with its document id", async () => {
      store.set("fb-open", report("new", 1, { queueRank: 2048 }));
      store.set(
        "fb-closed",
        report("resolved", 2, { adminNote: "poprawione" }),
      );

      const result = await callHandler();

      expect(result.feedback).toEqual([
        { id: "fb-open", ...store.get("fb-open") },
        { id: "fb-closed", ...store.get("fb-closed") },
      ]);
    });

    it("appends an old settled report named by include", async () => {
      seed("settled", 5, "resolved");
      // Older than the newest 5, so neither read returns it by itself.
      store.set("fb-old", report("wont_fix", 60 * 24 * 365));

      const result = await callHandler({ limit: "5", include: "fb-old" });

      expect(docLookups()).toEqual(["fb-old"]);
      expect(ids(result).filter((id) => id === "fb-old")).toHaveLength(1);
      expect(result.feedback.at(-1)).toEqual({
        id: "fb-old",
        ...store.get("fb-old"),
      });
      expect(result.feedback).toHaveLength(6);
    });

    it.each([
      ["open", "new"],
      ["settled", "resolved"],
    ] as const)(
      "does not repeat an included report the %s read already returned",
      async (_, status) => {
        store.set("fb-1", report(status, 1));
        store.set("fb-2", report(status, 2));

        const result = await callHandler({ include: "fb-2" });

        expect(ids(result)).toEqual(["fb-1", "fb-2"]);
      },
    );

    it("adds nothing when the included report does not exist", async () => {
      store.set("fb-1", report("new", 1));

      const result = await callHandler({ include: "fb-gone" });

      // The page says "Nie ma takiego zgłoszenia." when the hash names nothing;
      // that is its call, not a 404 that would lose the rest of the list.
      expect(docLookups()).toEqual(["fb-gone"]);
      expect(ids(result)).toEqual(["fb-1"]);
    });

    it("does not look anything up without include", async () => {
      await callHandler();

      expect(docLookups()).toHaveLength(0);
    });

    // A path rather than an id was a way, on Firestore, to address another
    // document altogether; it is still not an id.
    it.each([
      ["a nested path", "fb-1/notes/x"],
      ["another collection", "../users/admin-1"],
      ["a bare slash", "/"],
      ["an id longer than an id may be here", "x".repeat(201)],
    ])("ignores an include that is %s", async (_, include) => {
      store.set("fb-1", report("new", 1));

      const result = await callHandler({ include });

      expect(docLookups()).toHaveLength(0);
      // Ignored rather than refused, so a mangled link still opens the list.
      expect(ids(result)).toEqual(["fb-1"]);
    });

    it.each(["0", "201", "abc"])(
      "refuses a settled limit of %s",
      async (limit) => {
        await expect(callHandler({ limit })).rejects.toThrow();

        expect(queriesOf("feedback")).toHaveLength(0);
      },
    );
  },
);
