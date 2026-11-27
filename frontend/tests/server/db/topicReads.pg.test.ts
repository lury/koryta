import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import {
  articleIdsForTopic,
  edgesCitingArticles,
  nodesMentionedByArticles,
} from "~~/server/utils/topics";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** The reads behind a story (server/utils/topics.ts) on Postgres: its
 * articles, the relations they are cited by, the people they name.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/topicReads.pg.test.ts
 */

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
    sql = await openTestDatabase("topic_reads");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}

type Doc = Record<string, unknown>;

/** `fn` run over `edges`, written to their table first. */
const on =
  <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
  async (edges: Record<string, Doc>, ...args: A): Promise<R> => {
    await arrange(
      Object.fromEntries(
        Object.entries(edges).map(([id, data]) => [`edges/${id}`, data]),
      ),
    );
    return fn(...args);
  };
describe.runIf(PG_TEST_DATABASE_URL)("the story reads on Postgres", () => {
  useDatabase();

  describe("articleIdsForTopic", () => {
    const edges = {
      t1: { source: "a1", target: "topic", type: "tagged", published: true },
      t2: { source: "a2", target: "topic", type: "tagged", published: false },
      t3: { source: "a3", target: "topic", type: "tagged", deleted: true },
      t4: { source: "a4", target: "other", type: "tagged", published: true },
      m1: { source: "a5", target: "topic", type: "mentions", published: true },
    };

    it("returns only approved tags for a logged out reader", async () => {
      expect(await on(articleIdsForTopic)(edges, "topic", false)).toEqual([
        "a1",
      ]);
    });

    it("includes drafts for someone who may see them", async () => {
      const ids = await on(articleIdsForTopic)(edges, "topic", true);
      expect(ids.sort()).toEqual(["a1", "a2"]);
    });

    it("never returns an article whose tag was removed", async () => {
      const ids = await on(articleIdsForTopic)(edges, "topic", true);
      expect(ids).not.toContain("a3");
    });
  });

  describe("edgesCitingArticles", () => {
    it("finds the relations an article is cited by", async () => {
      const edges = {
        e1: {
          source: "p1",
          target: "c1",
          type: "employed",
          published: true,
          references: ["a1"],
        },
        e2: {
          source: "p2",
          target: "c2",
          type: "employed",
          published: true,
          references: ["a9"],
        },
      };

      const found = await on(edgesCitingArticles)(edges, ["a1"], false);
      expect(found.map((edge) => edge.id)).toEqual(["e1"]);
    });

    it("hides an unapproved relation from a logged out reader", async () => {
      const edges = {
        e1: {
          source: "p1",
          target: "c1",
          type: "employed",
          references: ["a1"],
        },
      };

      expect(await on(edgesCitingArticles)(edges, ["a1"], false)).toEqual([]);
      expect(
        (await on(edgesCitingArticles)(edges, ["a1"], true)).map((e) => e.id),
      ).toEqual(["e1"]);
    });

    it("asks once for a story of any size", async () => {
      // Firestore's array-contains-any took 30 values a query; one statement
      // takes every article of a story of 71.
      const articleIds = Array.from({ length: 71 }, (_, i) => `a${i}`);
      const edges = {
        e70: {
          source: "p1",
          target: "c1",
          type: "employed",
          published: true,
          references: ["a70"],
        },
      };

      const found = await on(edgesCitingArticles)(edges, articleIds, true);

      expect(found.map((edge) => edge.id)).toEqual(["e70"]);
      expect(queriesOf("edges")).toHaveLength(1);
    });

    it("returns an edge once even when several of its sources are in the story", async () => {
      // The same relation cited to two articles comes back from two different
      // chunks; merging on the edge id is what stops it being drawn twice.
      const articleIds = Array.from({ length: 40 }, (_, i) => `a${i}`);
      const edges = {
        e1: {
          source: "p1",
          target: "c1",
          type: "employed",
          published: true,
          references: ["a0", "a35"],
        },
      };

      const found = await on(edgesCitingArticles)(edges, articleIds, false);
      expect(found).toHaveLength(1);
    });

    it("asks nothing when the story has no articles", async () => {
      const asked: unknown[] = [];
      await on(edgesCitingArticles)(({}, (v) => asked.push(v)), [], true);
      expect(asked).toHaveLength(0);
    });
  });

  describe("nodesMentionedByArticles", () => {
    // `mentions` is stored with the article at either end: this page writes
    // article -> person, `ingest/person.post.ts` writes person -> article.
    const edges = {
      m1: { source: "a1", target: "p1", type: "mentions", published: true },
      m2: { source: "p2", target: "a1", type: "mentions", published: true },
      m3: { source: "a1", target: "p3", type: "mentions", published: false },
      m4: { source: "a1", target: "p4", type: "mentions", deleted: true },
      m5: { source: "a9", target: "p5", type: "mentions", published: true },
      // Not a mention, and not the article's kind of edge either.
      t1: { source: "a1", target: "topic", type: "tagged", published: true },
    };

    it("reads both directions, and only what is approved", async () => {
      const ids = await on(nodesMentionedByArticles)(edges, ["a1"], false);
      expect(ids.sort()).toEqual(["p1", "p2"]);
    });

    it("includes drafts for someone who may see them", async () => {
      const ids = await on(nodesMentionedByArticles)(edges, ["a1"], true);
      expect(ids.sort()).toEqual(["p1", "p2", "p3"]);
    });

    it("never returns one of the articles it was asked about", async () => {
      const both = {
        ...edges,
        m6: { source: "a1", target: "a2", type: "mentions", published: true },
      };
      const ids = await on(nodesMentionedByArticles)(both, ["a1", "a2"], false);
      expect(ids).not.toContain("a2");
    });

    it("asks nothing of the database for a story with no articles", async () => {
      expect(await on(nodesMentionedByArticles)(edges, [], true)).toEqual([]);
      expect(queries).toHaveLength(0);
    });
  });
});
