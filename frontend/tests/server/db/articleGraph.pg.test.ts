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
import { graphForArticles } from "~~/server/utils/articleGraph";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** graphForArticles on Postgres: who a set of articles puts on the record,
 * the edges read from their table, the nodes from the fetch helpers.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/articleGraph.pg.test.ts
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

/** Writes `stored` to the tables and starts the query log afresh. */
async function arrange(stored: StoredDocs) {
  await syncStored(sql, stored);
  queries.length = 0;
}

/** Opens this file's database; run inside the describe. */
function useDatabase() {
  beforeAll(async () => {
    sql = await openTestDatabase("article_graph");
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
const { mockFetchNodesByIds, mockFetchEdgesClose } = vi.hoisted(() => ({
  mockFetchNodesByIds: vi.fn(),
  mockFetchEdgesClose: vi.fn(),
}));

vi.mock("~~/server/utils/fetch", () => ({
  fetchNodesByIds: mockFetchNodesByIds,
  fetchEdgesClose: mockFetchEdgesClose,
}));

/** The article names one person and one company, and nothing rests on it yet -
 * the state anybody who has just recorded a mention is looking at. */
const mentionEdges = {
  m1: { source: "a1", target: "p1", type: "mentions", published: true },
  m2: { source: "a1", target: "c9", type: "mentions", published: true },
};

const nodes: Record<string, Doc> = {
  p1: { id: "p1", type: "person", name: "Jan Kowalski", visibility: true },
  p2: { id: "p2", type: "person", name: "Anna Nowak", visibility: true },
  c1: { id: "c1", type: "place", name: "Spółka", visibility: true },
  c9: { id: "c9", type: "place", name: "Ministerstwo", visibility: true },
  p3: { id: "p3", type: "person", name: "Urzędnik", visibility: true },
};

/** Jan's own relations, and one the ministry has that nobody should follow. */
const closeEdges = [
  {
    id: "e1",
    source: "p1",
    target: "c1",
    type: "employed",
    visibility: true,
  },
  {
    id: "e2",
    source: "p1",
    target: "p2",
    type: "connection",
    visibility: true,
  },
  {
    id: "e3",
    source: "p3",
    target: "c9",
    type: "employed",
    visibility: true,
  },
];

describe.runIf(PG_TEST_DATABASE_URL)("graphForArticles on Postgres", () => {
  useDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchNodesByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => nodes[id]).filter(Boolean),
    );
    // Only the ids actually asked for, so a test can tell whether the ministry
    // was expanded by whether its staff came back.
    mockFetchEdgesClose.mockImplementation(async (ids: string[]) =>
      closeEdges.filter(
        (edge) => ids.includes(edge.source) || ids.includes(edge.target),
      ),
    );
  });

  describe("graphForArticles", () => {
    it("draws a named person alone when nothing asks for their network", async () => {
      const graph = await on(graphForArticles)(mentionEdges, ["a1"], true);

      expect(Object.keys(graph.nodes).sort()).toEqual(["c9", "p1"]);
      expect(graph.edges).toEqual([]);
      expect(mockFetchEdgesClose).not.toHaveBeenCalled();
    });

    it("draws each named person's immediate connections around them", async () => {
      const graph = await on(graphForArticles)(mentionEdges, ["a1"], true, {
        expand: "mentions",
      });

      // Jan's employer and the person he knows are drawn as context; the
      // article's own people are still there.
      expect(Object.keys(graph.nodes).sort()).toEqual(["c1", "c9", "p1", "p2"]);
      expect(graph.edges.map((edge) => edge.id).sort()).toEqual(["e1", "e2"]);
    });

    it("does not expand a company the article names", async () => {
      await on(graphForArticles)(mentionEdges, ["a1"], true, {
        expand: "mentions",
      });

      expect(mockFetchEdgesClose).toHaveBeenCalledWith(["p1"]);
    });

    it("leaves out a relation nobody has approved, for a logged out reader", async () => {
      mockFetchEdgesClose.mockResolvedValue([
        { ...closeEdges[0], visibility: false },
      ]);

      const graph = await on(graphForArticles)(mentionEdges, ["a1"], false, {
        expand: "mentions",
      });

      expect(graph.edges).toEqual([]);
      expect(Object.keys(graph.nodes)).not.toContain("c1");
    });
  });

  /** The other way somebody gets into a story: not named by an article, but at
   * the end of a relation drawn from one. Anna is only in this graph because the
   * article is cited as the source for her connection to Jan. */
  const citedEdges = {
    ...mentionEdges,
    r1: {
      source: "p1",
      target: "p2",
      type: "connection",
      published: true,
      visibility: true,
      references: ["a1"],
    },
  };

  describe("graphForArticles, expanding every person", () => {
    it("draws the network of somebody a cited relation brought in", async () => {
      const graph = await on(graphForArticles)(citedEdges, ["a1"], true, {
        expand: "people",
      });

      // Anna is named by no article, so "mentions" left her out of the
      // expansion; here she is asked about like anybody else in the story.
      expect(mockFetchEdgesClose).toHaveBeenCalledWith(["p1", "p2"]);
      expect(Object.keys(graph.nodes).sort()).toEqual(["c1", "c9", "p1", "p2"]);
    });

    it("still leaves a company the story names unexpanded", async () => {
      await on(graphForArticles)(citedEdges, ["a1"], true, {
        expand: "people",
      });

      // c9 is the ministry, and its staff list is not the story.
      expect(mockFetchEdgesClose).not.toHaveBeenCalledWith(
        expect.arrayContaining(["c9"]),
      );
    });
  });
});
