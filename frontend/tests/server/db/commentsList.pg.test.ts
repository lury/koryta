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
import handler from "~~/server/api/comments/list.get";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** /api/comments/list on Postgres: the comments under a page.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/commentsList.pg.test.ts
 */

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).defineEventHandler = (fn: unknown) =>
    fn;
});

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
    sql = await openTestDatabase("comments_list");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}

// Recorded rather than merely stubbed, as in stats-hospitals.test.ts: which
// wrapper this route uses is the whole difference between an author seeing the
// comment they just posted and being served the list from before it, and the
// wrapping happens once, at import, before any `beforeEach`.
const { wrappedWith } = vi.hoisted(() => ({ wrappedWith: [] as string[] }));
vi.mock("~~/server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => {
    wrappedWith.push("authCachedEventHandler");
    return fn;
  },
  editorFreshCachedEventHandler: (fn: unknown) => {
    wrappedWith.push("editorFreshCachedEventHandler");
    return fn;
  },
}));

let query: Record<string, string> = {};
(globalThis as Record<string, unknown>).getQuery = () => query;
let stored: StoredDocs = {};

const call = async () => {
  await arrange(stored);
  return (handler as unknown as (event: unknown) => Promise<{ id: string }[]>)(
    {},
  );
};

const comment = (nodeId: string, createdAt: string) => ({
  content: "Treść",
  nodeId,
  edgeId: null,
  parentId: null,
  createdAt,
});

describe.runIf(PG_TEST_DATABASE_URL)("/api/comments/list on Postgres", () => {
  useDatabase();

  beforeEach(() => {
    stored = {};
    query = {};
  });

  it("reads a signed-in reader's list through the cache", () => {
    // „Dodałem testowy komentarz, ale nie jest widoczny” - the reporter took
    // it for moderation. Nothing moderates a comment: the list was held for
    // six hours for everybody, its author included, because the plain cached
    // wrapper never looks at who is asking. `editorFresh` answers the
    // `latest=true` every signed-in request carries, and still serves
    // everybody else from the cache.
    expect(wrappedWith).toEqual(["editorFreshCachedEventHandler"]);
  });

  it("lists one page's comments, oldest first", async () => {
    query = { nodeId: "person-1" };
    stored["comments/later"] = comment("person-1", "2026-09-18T11:42:10Z");
    stored["comments/earlier"] = comment("person-1", "2026-09-01T08:00:00Z");
    stored["comments/elsewhere"] = comment("person-2", "2026-09-05T08:00:00Z");

    const comments = await call();

    expect(comments.map((each) => each.id)).toEqual(["earlier", "later"]);
  });
});
