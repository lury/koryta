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
import handler from "~~/server/api/edges/recentEmployments.get";
import type { RecentEmployments } from "~~/server/api/edges/recentEmployments.get";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** /api/edges/recentEmployments on Postgres: the feed of newly begun
 * employments, its cursor and its filters, over rows arranged per test.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/recentEmployments.pg.test.ts
 */

let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};

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
    sql = await openTestDatabase("recent_employments");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}
vi.mock("~~/server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => false,
}));

const { mockGetValidatedQuery } = vi.hoisted(() => {
  const mockGetValidatedQuery = vi.fn();
  globalThis.getValidatedQuery = mockGetValidatedQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockGetValidatedQuery };
});

function request(query: Record<string, unknown> = {}) {
  mockGetValidatedQuery.mockImplementation(
    async (_event: unknown, parse: (q: unknown) => unknown) => {
      try {
        return parse(query);
      } catch {
        throw { statusCode: 400, statusMessage: "Bad Request" };
      }
    },
  );
}

const call = async () => {
  await arrange({
    ...Object.fromEntries(
      Object.entries(nodes).map(([id, data]) => [`nodes/${id}`, data]),
    ),
    ...Object.fromEntries(
      Object.entries(edges).map(([id, data]) => [`edges/${id}`, data]),
    ),
  });
  return handler({} as never) as Promise<RecentEmployments>;
};

/** A published employment between the two live pages the fixtures seed. */
function employment(fields: Record<string, unknown> = {}) {
  return {
    source: "anna",
    target: "orlen",
    type: "employed",
    published: true,
    start_date: "2024-01-01",
    ...fields,
  };
}

describe.runIf(PG_TEST_DATABASE_URL)(
  "api/edges/recentEmployments on Postgres",
  () => {
    useDatabase();

    beforeEach(() => {
      vi.clearAllMocks();
      nodes = {
        anna: { name: "Anna Nowak", type: "person", published: true },
        jan: { name: "Jan Kowalski", type: "person", published: true },
        draftPerson: { name: "Ktoś Nowy", type: "person", published: false },
        orlen: {
          name: "Orlen",
          type: "place",
          published: true,
          isPublic: true,
        },
        draftCompany: { name: "Firma Ukryta", type: "place", published: false },
      };
      edges = {};
      request();
    });

    it("names both ends of an employment and links it to the person", async () => {
      edges.e1 = employment({ name: "Prezes zarządu", end_date: "2025-06-30" });

      const { employments } = await call();

      expect(employments).toHaveLength(1);
      expect(employments[0]).toMatchObject({
        id: "e1",
        personId: "anna",
        personName: "Anna Nowak",
        companyId: "orlen",
        companyName: "Orlen",
        companyIsPublic: true,
        role: "Prezes zarządu",
        start_date: "2024-01-01",
        end_date: "2025-06-30",
      });
    });

    it("carries the employer's sectors through to the card", async () => {
      // Stored as a sanitized map, because a node written before 2026-07-28 is:
      // the card reads a plain array, so the unwrapping has to happen here.
      nodes.orlen!.categories = { "0": "energetyka", "1": "koleje" };
      edges.e1 = employment();

      const { employments } = await call();

      expect(employments[0]!.companyCategories).toEqual([
        "energetyka",
        "koleje",
      ]);
    });

    it("says nothing about the sector of a company filed under none", async () => {
      edges.e1 = employment();

      const { employments } = await call();

      // Omitted rather than an empty array, so twenty cards do not each carry a
      // key that means nothing.
      expect(employments[0]).not.toHaveProperty("companyCategories");
    });

    it("puts the most recently begun spell on top", async () => {
      edges.old = employment({ start_date: "2019-05-01" });
      edges.newest = employment({ source: "jan", start_date: "2026-02-01" });
      edges.middle = employment({ start_date: "2022-11-11" });

      const { employments } = await call();

      expect(employments.map((e) => e.id)).toEqual(["newest", "middle", "old"]);
    });

    it("leaves an unpublished relation out", async () => {
      edges.hidden = employment({ published: false, start_date: "2026-12-01" });
      edges.shown = employment();

      const { employments } = await call();

      expect(employments.map((e) => e.id)).toEqual(["shown"]);
    });

    it("leaves out a relation whose person is still a draft", async () => {
      // The publish rule refuses this, and unpublishing a node cascades to its
      // edges - but the ingest can autoapprove an edge onto a draft person, so
      // the endpoint checks rather than trusting the flag on the edge.
      edges.draft = employment({ source: "draftPerson" });
      edges.live = employment({ start_date: "2020-01-01" });

      const { employments } = await call();

      expect(employments.map((e) => e.id)).toEqual(["live"]);
    });

    it("leaves out a relation whose company is still a draft", async () => {
      edges.draft = employment({ target: "draftCompany" });

      expect((await call()).employments).toEqual([]);
    });

    it("leaves out a relation whose page was removed", async () => {
      edges.gone = employment({ deleted: true });

      expect((await call()).employments).toEqual([]);
    });

    it("leaves out an edge that does not run from a person to a place", async () => {
      // A mislabelled row has nowhere to send a click.
      edges.backwards = employment({ source: "orlen", target: "anna" });
      edges.dangling = employment({ target: "nie-ma-takiego" });

      expect((await call()).employments).toEqual([]);
    });

    it("says nothing about a role nobody recorded", async () => {
      edges.e1 = employment();

      expect((await call()).employments[0]!.role).toBeNull();
    });

    it("reads a spell that has not ended as still running", async () => {
      edges.e1 = employment();

      expect((await call()).employments[0]!.end_date).toBeNull();
    });

    it("hands back a cursor that resumes without repeating or skipping", async () => {
      for (let i = 0; i < 5; i++) {
        edges[`e${i}`] = employment({
          start_date: `202${i}-01-01`,
          source: i % 2 === 0 ? "anna" : "jan",
        });
      }
      request({ limit: 2 });

      const first = await call();
      expect(first.employments.map((e) => e.id)).toEqual(["e4", "e3"]);
      expect(first.nextCursor).toBe("2023-01-01|e3");

      request({ limit: 2, cursor: first.nextCursor! });
      const second = await call();
      expect(second.employments.map((e) => e.id)).toEqual(["e2", "e1"]);

      request({ limit: 2, cursor: second.nextCursor! });
      const third = await call();
      expect(third.employments.map((e) => e.id)).toEqual(["e0"]);
      expect(third.nextCursor).toBeNull();
    });

    it("separates two spells that began on the same day", async () => {
      // Every row of a KRS batch carries the same start, so a cursor made of the
      // date alone would resume at the top of the group and loop.
      edges.b = employment({ start_date: "2024-03-01" });
      edges.a = employment({ start_date: "2024-03-01", source: "jan" });
      request({ limit: 1 });

      const first = await call();
      expect(first.employments.map((e) => e.id)).toEqual(["b"]);
      expect(first.nextCursor).toBe("2024-03-01|b");

      request({ limit: 1, cursor: first.nextCursor! });
      expect((await call()).employments.map((e) => e.id)).toEqual(["a"]);
    });

    it("keeps scanning past a batch that filtered away to nothing", async () => {
      // The cursor follows what was examined rather than what was returned. A
      // page filled halfway through a batch that then jumped to the end of it
      // would drop every employment behind the break, silently.
      for (let i = 0; i < 70; i++) {
        edges[`draft${String(i).padStart(3, "0")}`] = employment({
          source: "draftPerson",
          start_date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
        });
      }
      edges.buried = employment({ start_date: "2001-01-01" });

      const { employments } = await call();

      expect(employments.map((e) => e.id)).toEqual(["buried"]);
      expect(queriesOf("edges").length).toBeGreaterThan(1);
    });

    it("never orders on a field the index cannot serve", async () => {
      // An employment with no start date is not in the index and cannot appear -
      // the same 195-odd hand entered edges the pipeline invariants budget for.
      edges.undated = employment({ start_date: undefined });
      edges.dated = employment();

      expect((await call()).employments.map((e) => e.id)).toEqual(["dated"]);
    });

    it("skips a spell whose start date was written as an explicit null", async () => {
      // /api/edges/create writes null for a blank date field, and null is a value
      // the index sorts rather than one it drops - so unlike an absent date this
      // one does come back, sorting last. It cannot be a cursor and it cannot be
      // rendered as a period, so it is passed over.
      edges.blank = { ...employment(), start_date: null };
      edges.dated = employment();

      const { employments } = await call();

      expect(employments.map((e) => e.id)).toEqual(["dated"]);
    });

    it("refuses a page size the feed was not designed to serve", async () => {
      request({ limit: 500 });

      await expect(call()).rejects.toMatchObject({ statusCode: 400 });
    });
  },
);
