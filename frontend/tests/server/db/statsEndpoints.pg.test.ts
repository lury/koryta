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
import computeNodesPost from "~~/server/api/stats/computeNodes.post";
import queueTiersGet from "~~/server/api/stats/queueTiers.get";
import regionsGet from "~~/server/api/stats/regions.get";
import progressGet from "~~/server/api/stats/progress.get";
import contributionsGet from "~~/server/api/stats/contributions.get";
import { readNodesByIds } from "~~/server/db/nodes";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** The stats endpoints on Postgres alone: the nightly recount behind its
 * gate, and the counters /pomoc, the home map and the table read.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/statsEndpoints.pg.test.ts
 */

const { verifyIdToken, cache } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.defineCachedEventHandler = (fn: unknown) => fn;
  g.defineCachedFunction = (fn: unknown) => fn;
  g.getRequestHeader = (event: TestEvent, name: string) =>
    event.headers[name.toLowerCase()];
  g.getValidatedQuery = async (
    event: TestEvent,
    parse: (q: unknown) => unknown,
  ) => parse(event.query ?? {});
  const cache = {
    keys: {} as Record<string, string[]>,
    removed: [] as string[],
  };
  g.useStorage = () => ({
    getKeys: async (base: string) => cache.keys[base] ?? [],
    removeItem: async (key: string) => {
      cache.removed.push(key);
    },
  });
  return {
    verifyIdToken: { fn: async (_t: string): Promise<unknown> => ({}) },
    cache,
  };
});

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: (t: string) => verifyIdToken.fn(t) }),
}));
vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: TestEvent,
      parse: (q: unknown) => unknown,
    ) => parse(event.query ?? {}),
  };
});
vi.mock("~~/server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => fn,
  editorFreshCachedEventHandler: (fn: unknown) => fn,
  wantsLatest: async () => false,
}));

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

type Call = (event: Partial<TestEvent>) => Promise<unknown>;
const call = <T>(handler: unknown, event: Partial<TestEvent> = {}) =>
  (handler as Call)({ headers: {}, context: {}, ...event }) as Promise<T>;
/** The recount as an admin unless `token` says otherwise. */
const recount = (
  headers: Record<string, string> = { authorization: "Bearer t" },
) => call<{ status: string }>(computeNodesPost, { headers });

async function served(ids: string[]) {
  return Object.fromEntries(
    (await readNodesByIds(ids)).map((row) => [
      row.id,
      row as Record<string, any>,
    ]),
  );
}

describe.runIf(PG_TEST_DATABASE_URL)("stats endpoints on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("stats_endpoints");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    cache.keys = {};
    cache.removed = [];
    verifyIdToken.fn = async () => ({ uid: "admin-1", admin: true });
  });

  describe("POST /api/stats/computeNodes", () => {
    beforeEach(() => {
      table("nodes")["person-1"] = { type: "person", name: "A" };
    });

    it("refuses a signed-in caller who is neither an admin nor in datascience", async () => {
      verifyIdToken.fn = async () => ({ uid: "reader-1" });
      await store.sync(sql);
      expect(await statusOf(recount())).toBe(403);
    });

    it("lets the datascience group through, as the night's robot is", async () => {
      verifyIdToken.fn = async () => ({
        uid: "pipeline-people-import",
        datascience: true,
      });
      await store.sync(sql);
      expect(await recount()).toMatchObject({ status: "success" });
      const [row] = await sql`SELECT count(*)::int AS n FROM node_stats`;
      expect(row!.n).toBe(1);
    });

    it("refuses a caller carrying no token", async () => {
      await store.sync(sql);
      expect(await statusOf(recount({}))).toBe(401);
    });

    it("refuses a token that does not verify", async () => {
      verifyIdToken.fn = async () => {
        throw new Error("expired");
      };
      await store.sync(sql);
      expect(await statusOf(recount())).toBe(401);
    });

    it("recounts nothing when it refuses", async () => {
      verifyIdToken.fn = async () => ({ uid: "reader-1" });
      await store.sync(sql);
      await sql`TRUNCATE node_stats`;
      expect(await statusOf(recount())).toBe(403);
      const [row] = await sql`SELECT count(*)::int AS n FROM node_stats`;
      expect(row!.n).toBe(0);
      expect(cache.removed).toEqual([]);
    });

    it("lets an admin through", async () => {
      await store.sync(sql);
      expect(await recount()).toMatchObject({
        status: "success",
        computedNodes: 1,
      });
    });

    it("fails when a step of the recount fails, before the cache is dropped", async () => {
      cache.keys = { "nitro:handlers": ["nitro:handlers:_:x.json"] };
      await store.sync(sql);
      await sql`ALTER FUNCTION refresh_database_counts() RENAME TO refresh_database_counts_away`;
      try {
        expect(await statusOf(recount())).toBe(500);
      } finally {
        await sql`ALTER FUNCTION refresh_database_counts_away() RENAME TO refresh_database_counts`;
      }
      expect(cache.removed).toEqual([]);
    });

    it("recounts the extracted facts onto each person", async () => {
      table("nodes")["person-2"] = { type: "person", name: "B" };
      table("extractions").f1 = { personNodeId: "person-1" };
      table("extractions").f2 = { personNodeId: "person-1" };
      table("extractions").f3 = { personNodeId: "" };
      await store.sync(sql);
      await recount();
      const nodes = await served(["person-1", "person-2"]);
      expect(nodes["person-1"]!.stats.factsCount).toBe(2);
      expect(nodes["person-2"]!.stats.factsCount).toBe(0);
    });

    it("sums up each node's revisions, by node_id or the older nodeId", async () => {
      table("nodes")["person-1"] = {
        type: "person",
        name: "A",
        revision_id: "revisions/rev-old",
      };
      table("nodes")["person-2"] = { type: "person", name: "B" };
      table("revisions")["rev-old"] = {
        node_id: "person-1",
        update_time: "2026-01-01T10:00:00.000Z",
      };
      table("revisions")["rev-new"] = {
        nodeId: "person-1",
        update_time: "2026-02-01T10:00:00.000Z",
      };
      await store.sync(sql);
      await recount();
      const nodes = await served(["person-1", "person-2"]);
      expect(nodes["person-1"]!.revisions).toEqual({
        latest_id: "rev-new",
        latest_time: "2026-02-01T10:00:00.000Z",
        total: 2,
        has_unapproved: true,
      });
      expect(nodes["person-2"]!.revisions ?? null).toBeNull();
    });

    it("files a person under the elections they stood in, and a region under none", async () => {
      table("nodes").teryt22 = {
        type: "region",
        name: "pomorskie",
        teryt: "22",
      };
      table("edges").run = {
        type: "election",
        source: "person-1",
        target: "teryt22",
        start_date: "2023-01-01",
        position: "Sejm",
        published: true,
      };
      await store.sync(sql);
      await recount();
      const nodes = await served(["person-1", "teryt22"]);
      const elections = (id: string) => [
        nodes[id]!.stats.edges.all.elections,
        nodes[id]!.stats.edges.approved.elections,
      ];
      expect(elections("person-1")).toEqual([
        ["parliament-2023"],
        ["parliament-2023"],
      ]);
      expect(elections("teryt22")).toEqual([[], []]);
    });

    it("counts a powiat's people by party on its row, and only a powiat's", async () => {
      store.clear();
      const person = (id: string, parties: string[], published = true) => {
        table("nodes")[id] = { type: "person", name: id, parties, published };
        table("edges")[`w-${id}`] = {
          type: "employed",
          source: id,
          target: "mzbm",
          published: true,
        };
      };
      person("pis", ["PiS"]);
      // SLD is counted with Nowa Lewica, as on every party chart.
      person("sld", ["SLD"]);
      // A named party is drawn over „Inne”.
      person("po", ["Inne", "PO"]);
      person("bez", []);
      person("szkic", ["PiS"], false);
      table("nodes").teryt1811 = {
        type: "region",
        name: "Powiat mielecki",
        teryt: "1811",
      };
      table("nodes").teryt18 = {
        type: "region",
        name: "podkarpackie",
        teryt: "18",
      };
      table("nodes").mzbm = { type: "place", name: "MZBM" };
      table("edges").seat = {
        type: "seat",
        source: "teryt1811",
        target: "mzbm",
      };
      table("edges").owns = { type: "owns", source: "teryt18", target: "mzbm" };
      await store.sync(sql);
      await recount();
      const rows = await call<unknown[]>(regionsGet);
      expect(rows).toContainEqual({
        id: "teryt1811",
        teryt: "1811",
        name: "Powiat mielecki",
        people: 4,
        parties: { PiS: 1, "Nowa Lewica": 1, PO: 1 },
      });
      expect(rows).toContainEqual({
        id: "teryt18",
        teryt: "18",
        name: "podkarpackie",
        people: 4,
      });
    });

    it("drops the cached handlers and pages once the recount is written", async () => {
      cache.keys = {
        "nitro:handlers": ["nitro:handlers:_:apistatsregions.abc.json"],
        "nitro:routes": ["nitro:routes:_:index.def.json"],
      };
      await store.sync(sql);
      await recount();
      expect(cache.removed).toEqual([
        "nitro:handlers:_:apistatsregions.abc.json",
        "nitro:routes:_:index.def.json",
      ]);
      const [row] = await sql`SELECT count(*)::int AS n FROM node_stats`;
      expect(row!.n).toBe(1);
    });

    it("stores the line the search box shows under each person", async () => {
      store.clear();
      table("nodes").radny = {
        type: "person",
        name: "Robert Wójcik",
        published: true,
        revision_id: "rev-radny",
      };
      table("nodes").nobody = { type: "person", name: "Robert Nikt" };
      // Nobody has published him, nor did an import write him.
      table("nodes").imiennik = { type: "person", name: "Robert Wójcik" };
      table("nodes").teryt1811 = {
        type: "region",
        name: "Powiat mielecki",
        teryt: "1811",
      };
      table("nodes").mzbm = {
        type: "place",
        name: "MIEJSKI ZARZĄD BUDYNKÓW MIESZKALNYCH (Mielec)",
      };
      table("edges").run = {
        type: "election",
        source: "radny",
        target: "teryt1811",
        position: "Rada miasta",
        start_date: "2024-01-01",
        elected: true,
        published: true,
      };
      table("edges").post = {
        type: "employed",
        source: "radny",
        target: "mzbm",
        start_date: "2018-07-02",
        end_date: "2019-06-26",
      };
      table("edges").seat = {
        type: "seat",
        source: "teryt1811",
        target: "mzbm",
      };
      table("edges")["imiennik-run"] = {
        type: "election",
        source: "imiennik",
        target: "teryt1811",
        position: "Rada miasta",
        start_date: "2024-01-01",
        elected: true,
      };
      table("edges")["imiennik-post"] = {
        type: "employed",
        source: "imiennik",
        target: "mzbm",
        start_date: "2020-01-01",
      };
      // The post was imported, which is what lets its teaser show it.
      table("revisions")["post-rev"] = {
        node_id: "post",
        update_time: "2026-05-01T10:00:00Z",
        update_automatic: true,
      };
      await store.sync(sql);
      await recount();
      const nodes = await served(["radny", "imiennik", "nobody", "mzbm"]);
      const seat = {
        what: "Rada miasta",
        when: "2024",
        election: "local-2024:won",
      };
      expect(nodes.radny!.stats.searchLine).toEqual({
        // The published line takes no town from a post nobody has published.
        approved: { ...seat, where: "powiat mielecki", ties: ["teryt1811"] },
        all: { ...seat, where: "Mielec", ties: ["teryt1811", "mzbm"] },
        teaser: {
          where: "Mielec",
          what: "MIEJSKI ZARZĄD BUDYNKÓW MIESZKALNYCH",
          when: "do 2019",
          ties: ["mzbm"],
        },
      });
      // Unpublished: a signed in reader is told the latest post, not the PKW
      // run (decision on 2026-11-18), and the teaser shows nothing of a
      // person no import wrote.
      expect(nodes.imiennik!.stats.searchLine).toEqual({
        all: {
          where: "Mielec",
          what: "MIEJSKI ZARZĄD BUDYNKÓW MIESZKALNYCH",
          ties: ["mzbm"],
        },
      });
      expect(nodes.nobody!.stats.searchLine).toBeUndefined();
      expect(nodes.mzbm!.stats.searchLine).toBeUndefined();
    });
  });

  describe("GET /api/stats/queueTiers", () => {
    const person = (
      id: string,
      queueTier: number,
      { published = false, voted = false } = {},
    ) => {
      table("nodes")[id] = {
        type: "person",
        name: `Osoba ${id}`,
        published,
        stats: { queueTier },
      };
      if (voted)
        table("votes")[`${id}_v`] = {
          nodeId: id,
          userUid: "volunteer",
          categoryVotes: { interesting: 1 },
          updatedAt: "2026-11-20T10:00:00.000Z",
        };
    };
    const tiers = async () => {
      await store.sync(sql);
      await sql`SELECT refresh_node_stats()`;
      return (
        await call<{
          tiers: {
            tier: number;
            toCheck: number;
            examples: { id: string; name: string }[];
          }[];
        }>(queueTiersGet)
      ).tiers;
    };

    it("leaves out the people somebody has already voted on", async () => {
      person("fresh", 1);
      person("another", 1);
      // Voted on, not published: the queue the card links to hides them, and
      // a vote is the whole of what a volunteer's check leaves behind.
      person("voted", 1, { voted: true });
      person("published", 1, { published: true, voted: true });
      person("tier2", 2);
      expect(
        (await tiers()).map(({ tier, toCheck }) => [tier, toCheck]),
      ).toEqual([
        [1, 2],
        [2, 1],
        [3, 0],
      ]);
    });

    it("offers the published people of a tier as its examples", async () => {
      person("fresh", 1);
      person("published", 1, { published: true, voted: true });
      expect((await tiers())[0]!.examples).toEqual([
        { id: "published", name: "Osoba published" },
      ]);
    });
  });

  describe("GET /api/stats/progress", () => {
    const person = (
      id: string,
      { published = false, voted = false, notes = 0 } = {},
    ) => {
      table("nodes")[id] = { type: "person", name: id, published };
      if (voted)
        table("votes")[`${id}_v`] = {
          nodeId: id,
          userUid: "volunteer",
          categoryVotes: { interesting: 1 },
          updatedAt: "2026-11-20T10:00:00.000Z",
        };
      for (let i = 0; i < notes; i++)
        table("notes")[`${id}_n${i}`] = {
          nodeId: id,
          userUid: "volunteer",
          // A note counts by its sources, as computeNodes counted them.
          sources: [{ url: `https://example.org/${id}/${i}` }],
        };
    };
    const progress = async () => {
      await store.sync(sql);
      await sql`SELECT refresh_node_stats()`;
      return call(progressGet, { query: {} });
    };

    it("splits every person into exactly one of approved, reviewed and toCheck", async () => {
      person("approved", { published: true });
      person("voted", { voted: true });
      person("noted", { notes: 1 });
      person("fresh");
      expect(await progress()).toEqual({
        total: 4,
        approved: 1,
        reviewed: 2,
        toCheck: 1,
        withVotes: 1,
        withNotes: 1,
      });
    });

    it("counts a person with both a vote and a note as reviewed once", async () => {
      person("both", { voted: true, notes: 2 });
      expect(await progress()).toMatchObject({
        total: 1,
        reviewed: 1,
        toCheck: 0,
        withVotes: 1,
        withNotes: 1,
      });
    });

    it("treats an approved person as approved however much attention they had", async () => {
      person("star", { published: true, voted: true, notes: 1 });
      expect(await progress()).toMatchObject({
        approved: 1,
        reviewed: 0,
        toCheck: 0,
        withVotes: 1,
        withNotes: 1,
      });
    });

    it("does not count a note without sources as a note", async () => {
      person("plain");
      table("notes").empty = {
        nodeId: "plain",
        userUid: "volunteer",
        sources: [],
      };
      expect(await progress()).toMatchObject({
        toCheck: 1,
        reviewed: 0,
        withNotes: 0,
      });
    });
  });

  describe("GET /api/stats/contributions", () => {
    it("counts the caller's votes, notes and proposals, nobody else's", async () => {
      table("nodes").p = { type: "person", name: "P" };
      table("votes").v1 = { nodeId: "p", userUid: "me", categoryVotes: {} };
      table("votes").v2 = { nodeId: "p", userUid: "other", categoryVotes: {} };
      table("notes").n1 = { nodeId: "p", userUid: "me", content: "x" };
      table("revisions").r1 = { node_id: "p", update_user: "me" };
      table("revisions").r2 = { node_id: "p", update_user: "me" };
      await store.sync(sql);
      verifyIdToken.fn = async () => ({ uid: "me" });
      expect(
        await call(contributionsGet, {
          headers: { authorization: "Bearer t" },
        }),
      ).toEqual({ votes: 1, notes: 1, revisions: 2 });
      expect(await statusOf(call(contributionsGet))).toBe(401);
    });
  });
});
