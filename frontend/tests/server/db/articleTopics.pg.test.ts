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
import handler from "~~/server/api/articles/topics.get";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** /api/articles/topics on Postgres: the stories each article is tagged
 * into, from the topics and `tagged` edges arranged per test.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/articleTopics.pg.test.ts
 */

/** Documents to hand back, keyed by collection. */
let docs: Record<string, Record<string, Record<string, unknown>>> = {};
/** What `wantsLatest` answers, i.e. whether the caller is signed in. */
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
    sql = await openTestDatabase("article_topics");
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

const call = async () => {
  await arrange(
    Object.fromEntries(
      Object.entries(docs).flatMap(([collection, byId]) =>
        Object.entries(byId).map(([id, data]) => [`${collection}/${id}`, data]),
      ),
    ),
  );
  return handler({} as never) as unknown as Promise<{
    byArticle: Record<
      string,
      { id: string; name: string; published: boolean }[]
    >;
  }>;
};

describe.runIf(PG_TEST_DATABASE_URL)(
  "GET /api/articles/topics on Postgres",
  () => {
    useDatabase();

    beforeEach(() => {
      latest = false;
      docs = {
        nodes: {
          "topic-a": {
            type: "topic",
            name: "Powodzianie KRR",
            published: true,
          },
          "topic-b": { type: "topic", name: "Inna sprawa", published: true },
          "topic-draft": { type: "topic", name: "Szkic", published: false },
        },
        edges: {
          "edge-1": {
            type: "tagged",
            source: "article-1",
            target: "topic-a",
            published: true,
          },
          "edge-2": {
            type: "tagged",
            source: "article-1",
            target: "topic-b",
            published: true,
          },
        },
      };
    });

    it("groups the topics under the article tagged into them, by name", async () => {
      const { byArticle } = await call();

      expect(byArticle["article-1"]).toEqual([
        { id: "topic-b", name: "Inna sprawa", published: true },
        { id: "topic-a", name: "Powodzianie KRR", published: true },
      ]);
    });

    it("leaves an untagged article out rather than mapping it to nothing", async () => {
      const { byArticle } = await call();

      expect(byArticle["article-2"]).toBeUndefined();
    });

    it("hides a draft tag from the public and shows it to a signed in reader", async () => {
      docs.edges!["edge-3"] = {
        type: "tagged",
        source: "article-2",
        target: "topic-a",
        published: false,
      };

      expect((await call()).byArticle["article-2"]).toBeUndefined();

      latest = true;
      expect((await call()).byArticle["article-2"]).toEqual([
        { id: "topic-a", name: "Powodzianie KRR", published: false },
      ]);
    });

    it("drops a tag whose topic is a draft this reader may not see", async () => {
      docs.edges!["edge-3"] = {
        type: "tagged",
        source: "article-2",
        target: "topic-draft",
        published: true,
      };

      expect((await call()).byArticle["article-2"]).toBeUndefined();

      // Visible to an editor, and marked as not live even though the tag itself
      // is - a link to a page the public cannot open is still a draft.
      latest = true;
      expect((await call()).byArticle["article-2"]).toEqual([
        { id: "topic-draft", name: "Szkic", published: false },
      ]);
    });

    it("drops a deleted tag and a deleted topic", async () => {
      docs.edges!["edge-2"]!.deleted = true;
      docs.nodes!["topic-a"]!.deleted = true;

      expect((await call()).byArticle["article-1"]).toBeUndefined();
    });

    it("counts the same article tagged twice into one topic once", async () => {
      docs.edges!["edge-3"] = {
        type: "tagged",
        source: "article-1",
        target: "topic-a",
        published: true,
      };

      expect((await call()).byArticle["article-1"]).toHaveLength(2);
    });
  },
);
