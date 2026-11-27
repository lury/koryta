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
import nodeGet from "~~/server/api/nodes/[id].get";
import teaserGet from "~~/server/api/nodes/[id]/teaser.get";
import mentionsGet from "~~/server/api/nodes/[id]/mentions.get";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** A page, its teaser and its press mentions on Postgres, through the real
 * cache wrappers of server/utils/handlers.ts: what nodeReads.pg.test.ts does
 * not pin - the cache headers, the draft stats, the date shapes, the teaser's
 * whole answer and each way an article reaches the mentions.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/nodePages.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.defineCachedEventHandler = (fn: unknown) => fn;
  g.defineCachedFunction = (fn: unknown) => fn;
  g.getRouterParam = (event: TestEvent, name: string) => event.params?.[name];
  g.setResponseHeader = (event: TestEvent, name: string, value: string) => {
    event.context[`header:${name}`] = value;
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    createError: (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts),
    defineEventHandler: (fn: unknown) => fn,
    getQuery: (event: TestEvent) => event.query ?? {},
    getRouterParam: (event: TestEvent, name: string) => event.params?.[name],
  };
});
// `callAs` puts the reader on `event.context.hasUser`, which is what
// `resolveReader` reads first; a token is a signed-in reader otherwise.
vi.mock("~~/server/utils/auth", () => ({
  getOptionalUser: async (event: TestEvent) =>
    event.headers.authorization ? { uid: event.headers.authorization } : null,
}));

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;
const sync = async () => {
  await store.sync(sql);
  await sql`SELECT refresh_node_stats()`;
};

type Node = {
  id: string;
  name?: string;
  published?: boolean;
  stats?: { edges?: Record<string, unknown> };
};

describe.runIf(PG_TEST_DATABASE_URL)("node pages on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("node_pages");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
  });

  describe("GET /api/nodes/[id]", () => {
    const get = async (as?: string, query: Record<string, string> = {}) => {
      await sync();
      // `callAs`'s event, kept here so the headers it was given can be read.
      const event: TestEvent = {
        params: { id: "anna" },
        query,
        headers: as ? { authorization: as } : {},
        context: { hasUser: as !== undefined },
      };
      const handler = nodeGet as unknown as (
        e: TestEvent,
      ) => Promise<{ node: Node }>;
      return { node: (await handler(event)).node, event };
    };
    const cacheControl = (event: TestEvent) =>
      event.context["header:Cache-Control"];
    beforeEach(() => {
      table("nodes").anna = {
        type: "person",
        name: "Anna Nowak",
        published: true,
        revision_id: "revisions/r0",
      };
    });

    it("still answers a reader asking for the latest of a page with no revision at all", async () => {
      const { node } = await get("reader", { latest: "true" });
      expect(node.name).toBe("Anna Nowak");
      expect(node.published).toBe(true);
    });

    it("hides a draft waiting for its first review with a 404", async () => {
      table("nodes").anna = {
        type: "person",
        name: "Anna Nowak",
        published: false,
        revision_id: null,
      };
      expect(await statusOf(get())).toBe(404);
    });

    it("still refuses a published page with no name", async () => {
      table("nodes").anna = { type: "person", published: true };
      expect(await statusOf(get())).not.toBe(200);
    });

    it("keeps the signed-in reader's answer, and the public one to a `latest` url, out of every cache", async () => {
      expect(
        cacheControl((await get("reader", { latest: "true" })).event),
      ).toMatch(/no-store/);
      expect(
        cacheControl((await get(undefined, { latest: "true" })).event),
      ).toMatch(/no-store/);
      expect(cacheControl((await get()).event)).toBeUndefined();
    });

    it("tells a logged-out reader how many places its drafts lead to, never which", async () => {
      table("nodes").c1 = { type: "place", name: "C1", published: true };
      table("nodes").c2 = { type: "place", name: "C2", published: true };
      table("nodes").r9 = { type: "place", name: "R9", published: true };
      table("edges").live = {
        type: "employed",
        source: "anna",
        target: "c1",
        published: true,
      };
      table("edges").d1 = { type: "employed", source: "anna", target: "c2" };
      table("edges").d2 = {
        type: "employed",
        source: "anna",
        target: "r9",
        published: false,
      };
      const edges = (await get()).node.stats!.edges!;
      expect(edges).not.toHaveProperty("all");
      expect(edges.approved).toMatchObject({ targetNodeIds: ["c1"] });
      expect(edges.hiddenTargets).toBe(2);
    });

    it("leaves the search index out of the page", async () => {
      table("nodes").anna!.nameChunksLower = ["a", "an", "anna"];
      expect((await get()).node).not.toHaveProperty("nameChunksLower");
    });
  });

  describe("GET /api/nodes/[id]/teaser", () => {
    const teaser = async (id = "p1") => {
      await sync();
      return callAs<Record<string, unknown>>(teaserGet, undefined, {
        params: { id },
      });
    };
    beforeEach(() => {
      table("nodes").p1 = {
        type: "person",
        name: "Jan Kowalski",
        published: false,
        revision_id: "revisions/p1",
        parties: ["PiS"],
        partiesSource: "manual",
        birthDate: "1970-01-01",
        rejestrIo: "https://rejestr.io/osoby/1",
      };
      table("nodes").c1 = {
        type: "place",
        name: "ENERGA",
        published: true,
        revision_id: "revisions/c1",
      };
      table("nodes").gmina = {
        type: "place",
        name: "Urząd Gminy",
        published: false,
        revision_id: "revisions/g",
      };
      table("edges").job = {
        type: "employed",
        source: "p1",
        target: "c1",
        name: "Prezes Zarządu",
        start_date: "2023-02-01",
        published: false,
        revision_id: "revisions/job",
      };
      table("edges").older = {
        type: "employed",
        source: "p1",
        target: "gmina",
        name: "Sekretarz",
        start_date: "2010-01-01",
        end_date: "2018-01-01",
        revision_id: "revisions/older",
      };
      table("edges").candidacy = {
        type: "election",
        source: "p1",
        target: "gmina",
        party: "PiS",
        committee: "KW Prawo i Sprawiedliwość",
        start_date: "2024-04-07",
        revision_id: "revisions/cand",
      };
    });

    it("names an unpublished person and their most recent post, a party only as hidden", async () => {
      expect(await teaser()).toEqual({
        id: "p1",
        name: "Jan Kowalski",
        post: {
          id: "job",
          name: "Prezes Zarządu",
          start_date: "2023-02-01",
          company: { id: "c1", name: "ENERGA", visibility: true },
        },
        employmentCount: 2,
        partyHidden: true,
      });
    });

    it("says nothing of a party where none is on record", async () => {
      table("nodes").p1!.parties = [];
      expect(await teaser()).not.toHaveProperty("partyHidden");
    });

    it("never sends the party, a candidacy, the birth date or the register link", async () => {
      const body = JSON.stringify(await teaser());
      expect(body).not.toContain("PiS");
      expect(body).not.toContain("Prawo i Sprawiedliwość");
      expect(body).not.toContain("1970");
      expect(body).not.toContain("rejestr.io");
    });

    it("answers for the person a duplicate was merged into", async () => {
      table("nodes").dup = {
        type: "person",
        name: "J. Kowalski",
        deleted: true,
        merged_into: "p1",
      };
      expect(await teaser("dup")).toMatchObject({
        id: "p1",
        name: "Jan Kowalski",
      });
    });

    it("neither names nor counts a post somebody added, naming the register's older one", async () => {
      delete table("edges").job!.revision_id;
      table("revisions").added = {
        node_id: "job",
        collection: "edges",
        data: {},
        update_time: "2026-01-01T00:00:00.000Z",
        update_user: "reader",
        update_automatic: false,
      };
      expect(await teaser()).toMatchObject({
        post: { id: "older", name: "Sekretarz", company: { id: "gmina" } },
        employmentCount: 1,
      });
    });

    it("says nothing about employment for a person with none", async () => {
      delete table("edges").job;
      delete table("edges").older;
      delete table("edges").candidacy;
      expect(await teaser()).toEqual({
        id: "p1",
        name: "Jan Kowalski",
        employmentCount: 0,
        partyHidden: true,
      });
    });
  });

  describe("GET /api/nodes/[id]/mentions", () => {
    type Mention = {
      nodeId: string;
      name: string | null;
      published: boolean;
      publishedDate: string | null;
    };
    const mentions = async (id = "p", as?: string) => {
      await sync();
      return (
        await callAs<{ mentions: Mention[] }>(mentionsGet, as, {
          params: { id },
          query: as ? { latest: "true" } : {},
        })
      ).mentions;
    };
    const ids = async (id = "p", as?: string) =>
      (await mentions(id, as)).map((m) => m.nodeId).sort();
    const article = (name: string, extra: Record<string, unknown> = {}) => ({
      type: "article",
      name,
      published: true,
      sourceURL: `https://example.pl/${name}`,
      ...extra,
    });
    const mention = (
      source: string,
      target: string,
      extra: Record<string, unknown> = {},
    ) => ({ type: "mentions", source, target, published: true, ...extra });
    const job = (extra: Record<string, unknown> = {}) => ({
      type: "employed",
      source: "p",
      target: "firma",
      published: true,
      references: ["a1"],
      ...extra,
    });
    beforeEach(() => {
      table("nodes").p = { type: "person", name: "Anna", published: true };
      table("nodes").firma = { type: "place", name: "Spółka", published: true };
      table("nodes").a1 = article("a");
      table("nodes").a2 = article("b");
    });

    it("shows one article once when both writers recorded it, the published copy kept", async () => {
      table("edges").m1 = mention("p", "a1", { published: false });
      table("edges").m2 = mention("a1", "p");
      const all = await mentions("p", "reader");
      expect(all).toHaveLength(1);
      expect(all[0]!.published).toBe(true);
    });

    it("hides a draft mention from the public and shows it to a reader", async () => {
      table("edges").m1 = mention("a1", "p", { published: false });
      expect(await mentions()).toEqual([]);
      expect(await mentions("p", "reader")).toHaveLength(1);
    });

    it("ignores relations that are not mentions, and ends that are not articles", async () => {
      table("edges").e1 = {
        type: "employed",
        source: "p",
        target: "firma",
        published: true,
      };
      table("edges").e2 = mention("p", "firma");
      expect(await mentions()).toEqual([]);
    });

    it("skips a deleted edge", async () => {
      table("edges").m1 = mention("p", "a1", { deleted: true });
      expect(await mentions()).toEqual([]);
    });

    it("counts an article a relation cites as mentioning both its ends", async () => {
      table("edges").e1 = job();
      const fromPerson = await mentions();
      expect(fromPerson).toHaveLength(1);
      expect(fromPerson[0]).toMatchObject({
        nodeId: "a1",
        name: "a",
        published: true,
      });
      expect(await ids("firma")).toEqual(["a1"]);
    });

    it("reads a list of citations the sanitizer stored as a map", async () => {
      table("edges").e1 = job({ references: { 0: "a1", 1: "a2" } });
      expect(await ids()).toEqual(["a1", "a2"]);
    });

    it("follows the citing relation's publication, not only the article's", async () => {
      table("edges").e1 = job({ published: false });
      expect(await mentions()).toEqual([]);
      const all = await mentions("p", "reader");
      expect(all).toHaveLength(1);
      expect(all[0]!.published).toBe(false);
    });

    it("withholds a draft article even when the citing relation is live", async () => {
      table("nodes").a1 = article("a", { published: false });
      table("edges").e1 = job();
      expect(await mentions()).toEqual([]);
    });

    it("skips a deleted citing relation", async () => {
      table("edges").e1 = job({ deleted: true });
      expect(await mentions()).toEqual([]);
    });

    it("gets past a cited id that could name no document", async () => {
      table("edges").m1 = mention("a2", "p");
      table("edges").e1 = job({ references: [42, "", "a/b", null, "a1"] });
      expect(await ids()).toEqual(["a1", "a2"]);
    });

    it("puts the newest first and the undated last, whatever shape the date is in", async () => {
      table("nodes").a1 = article("a", { publishedDate: "2024-01-01" });
      table("nodes").a2 = article("b", {
        publishedDate: { _seconds: Date.parse("2025-06-01") / 1000 },
      });
      table("nodes").a3 = article("c");
      table("edges").m0 = mention("p", "a1");
      table("edges").m1 = mention("p", "a2");
      table("edges").m2 = mention("p", "a3");
      const list = await mentions();
      expect(list.map((m) => m.nodeId)).toEqual(["a2", "a1", "a3"]);
      expect(list[0]!.publishedDate).toBe("2025-06-01T00:00:00.000Z");
      expect(list[1]!.publishedDate).toBe("2024-01-01T00:00:00.000Z");
    });
  });
});
