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
import handler from "~~/server/api/articles/[id]/relations.get";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** /api/articles/[id]/relations on Postgres: an article's topics and the
 * people it mentions, over rows arranged per test.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/articleRelationsRead.pg.test.ts
 */

/** Every edge in the base, keyed by id. */
let edges: Record<string, Record<string, unknown>> = {};
/** Every node, keyed by id. */
let nodes: Record<string, Record<string, unknown>> = {};
let latest = false;

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
    sql = await openTestDatabase("article_relations_read");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}
vi.mock("~~/server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => latest,
}));
vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});
globalThis.getRouterParam = vi.fn(() => "article-1");

const call = async () => {
  await arrange({
    ...Object.fromEntries(
      Object.entries(nodes).map(([id, data]) => [`nodes/${id}`, data]),
    ),
    ...Object.fromEntries(
      Object.entries(edges).map(([id, data]) => [`edges/${id}`, data]),
    ),
  });
  return handler({} as never) as unknown as Promise<{
    topics: { nodeId: string; name: string | null; published: boolean }[];
    mentions: { nodeId: string; name: string | null; published: boolean }[];
  }>;
};

describe.runIf(PG_TEST_DATABASE_URL)(
  "GET /api/articles/[id]/relations on Postgres",
  () => {
    useDatabase();

    beforeEach(() => {
      latest = false;
      nodes = {
        "person-1": { type: "person", name: "Anna Nowak" },
        "person-2": { type: "person", name: "Bogdan Zyx" },
        "topic-a": { type: "topic", name: "Sprawa" },
      };
      edges = {};
    });

    it("reads a mention the pipeline wrote, which points at the article", async () => {
      // `ingest/person.post.ts` writes person -> article and produced most of
      // them. Reading only outgoing edges left the section showing a fraction of
      // what the pipeline had found.
      edges.m1 = {
        source: "person-1",
        target: "article-1",
        type: "mentions",
        published: true,
      };

      const { mentions } = await call();
      expect(mentions).toMatchObject([
        { nodeId: "person-1", name: "Anna Nowak" },
      ]);
    });

    it("reads a mention the article page wrote, which points away from it", async () => {
      edges.m1 = {
        source: "article-1",
        target: "person-1",
        type: "mentions",
        published: true,
      };

      const { mentions } = await call();
      expect(mentions).toMatchObject([{ nodeId: "person-1" }]);
    });

    it("draws one chip when both writers recorded the same person", async () => {
      edges.m1 = {
        source: "person-1",
        target: "article-1",
        type: "mentions",
        published: true,
      };
      edges.m2 = {
        source: "article-1",
        target: "person-1",
        type: "mentions",
        published: false,
      };

      latest = true;
      const { mentions } = await call();
      // And it is the published one that is kept: it is what the public would be
      // shown, so it is what decides whether the chip reads as a draft.
      expect(mentions).toMatchObject([{ nodeId: "person-1", published: true }]);
    });

    it("keeps a tag only in the direction it is stored", async () => {
      edges.t1 = {
        source: "article-1",
        target: "topic-a",
        type: "tagged",
        published: true,
      };
      // A topic pointing at the article is not a thing anything writes, and
      // reading it would put the article itself on the far end.
      edges.t2 = {
        source: "topic-a",
        target: "article-1",
        type: "tagged",
        published: true,
      };

      const { topics } = await call();
      expect(topics).toHaveLength(1);
      expect(topics[0]).toMatchObject({ nodeId: "topic-a" });
    });

    it("hides an unapproved mention from the public", async () => {
      edges.m1 = {
        source: "article-1",
        target: "person-2",
        type: "mentions",
        published: false,
      };

      expect((await call()).mentions).toEqual([]);
      latest = true;
      expect((await call()).mentions).toMatchObject([{ nodeId: "person-2" }]);
    });
  },
);
