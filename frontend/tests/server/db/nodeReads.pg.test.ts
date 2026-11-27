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
import articlesIndexGet from "~~/server/api/nodes/articles/index.get";
import articlesListGet from "~~/server/api/nodes/articles/list.get";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** One page, its teaser, its press mentions and the sources list, read from
 * Postgres alone, with what each reader may see.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/nodeReads.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.defineCachedFunction = (fn: unknown) => fn;
  g.authCachedEventHandler = (fn: unknown) => fn;
  g.getRouterParam = (event: TestEvent, name: string) => event.params?.[name];
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    createError: (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts),
    defineEventHandler: (fn: unknown) => fn,
    getRouterParam: (event: TestEvent, name: string) => event.params?.[name],
    getValidatedQuery: async (
      event: TestEvent,
      parse: (q: unknown) => unknown,
    ) => parse(event.query ?? {}),
  };
});
// `latest` honoured for a signed-in caller only, as `wantsLatest` does.
vi.mock("~~/server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => fn,
  editorFreshCachedEventHandler: (fn: unknown) => fn,
  wantsLatest: async (event: TestEvent) =>
    event.headers.authorization !== undefined && event.query?.latest === "true",
}));

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;
const sync = async () => {
  await store.sync(sql);
  await sql`SELECT refresh_node_stats()`;
};

type Page = { node: Record<string, unknown> };

describe.runIf(PG_TEST_DATABASE_URL)("node reads on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("nodereads");
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
      return callAs<Page>(nodeGet, as, { params: { id: "anna" }, query });
    };
    beforeEach(() => {
      table("nodes").anna = {
        type: "person",
        name: "Anna Nowak",
        published: true,
        revision_id: "revisions/r0",
      };
      table("revisions").r1 = {
        node_id: "anna",
        data: { type: "person", name: "Anna Nowak (poprawiona)" },
        update_time: "2026-10-01T00:00:00.000Z",
        update_user: "u",
      };
    });

    it("answers a signed-in reader who asks for the latest from the newest revision, with the page's visibility", async () => {
      const { node } = await get("reader", { latest: "true" });
      expect(node).toMatchObject({
        id: "anna",
        name: "Anna Nowak (poprawiona)",
        published: true,
      });
      table("nodes").anna!.published = false;
      expect((await get("reader", { latest: "true" })).node.published).toBe(
        false,
      );
    });

    it("serves the stored page to everybody else, a draft as a 404", async () => {
      expect((await get()).node.name).toBe("Anna Nowak");
      expect((await get(undefined, { latest: "true" })).node.name).toBe(
        "Anna Nowak",
      );
      table("nodes").anna!.published = false;
      expect(await statusOf(get())).toBe(404);
      expect(await statusOf(get(undefined, { latest: "true" }))).toBe(404);
      expect(await statusOf(get("reader", { latest: "false" }))).toBe(404);
    });

    it("answers the survivor for a merged page, and a 404 for none", async () => {
      table("nodes").anna = {
        type: "person",
        name: "A. Nowak",
        deleted: true,
        merged_into: "survivor",
      };
      table("nodes").survivor = {
        type: "person",
        name: "Anna Nowak",
        published: true,
      };
      expect((await get()).node.id).toBe("survivor");
      store.clear();
      expect(await statusOf(get())).toBe(404);
    });

    it("serves a published page waiting for its first review, and keeps what drafts lead to from the public", async () => {
      table("nodes").anna = {
        type: "person",
        name: "Anna Nowak",
        published: true,
        revision_id: null,
      };
      const { node } = await get();
      expect(node.name).toBe("Anna Nowak");
      expect((node.stats as { edges: object }).edges).not.toHaveProperty("all");
    });
  });

  describe("GET /api/nodes/[id]/teaser", () => {
    const teaser = async (id = "jan") => {
      await sync();
      return callAs<{
        id: string;
        name: string;
        employmentCount: number;
        post?: unknown;
      }>(teaserGet, undefined, { params: { id } });
    };
    beforeEach(() => {
      table("nodes").jan = {
        type: "person",
        name: "Jan Kowalski",
        published: false,
        revision_id: "revisions/x",
        parties: ["PiS"],
      };
      table("nodes").s = {
        type: "place",
        name: "Spółka SA",
        published: true,
        isPublic: true,
      };
      table("edges").job = {
        type: "employed",
        source: "jan",
        target: "s",
        name: "Prezes",
        start_date: "2020-01-01",
        revision_id: "revisions/y",
      };
      table("edges").added = {
        type: "employed",
        source: "jan",
        target: "s",
        name: "Członek",
        start_date: "2021-01-01",
      };
      table("revisions").first = {
        node_id: "added",
        collection: "edges",
        data: {},
        update_time: "2026-01-01T00:00:00.000Z",
        update_user: "reader",
        update_automatic: false,
      };
    });

    it("names an unpublished person and the post an import or a reviewer stands behind", async () => {
      const answer = await teaser();
      expect(answer).toMatchObject({
        id: "jan",
        name: "Jan Kowalski",
        employmentCount: 1,
      });
      expect(JSON.stringify(answer)).not.toContain("PiS");
      expect(JSON.stringify(answer)).not.toContain("Członek");
    });

    it("is a 404 for a removed person, a company, an unknown id and a proposal nobody reviewed", async () => {
      expect(await statusOf(teaser("s"))).toBe(404);
      expect(await statusOf(teaser("nope"))).toBe(404);
      table("nodes").jan!.revision_id = null;
      expect(await statusOf(teaser())).toBe(404);
      table("nodes").jan!.deleted = true;
      expect(await statusOf(teaser())).toBe(404);
    });
  });

  describe("GET /api/nodes/[id]/mentions", () => {
    const mentions = async (
      as?: string,
      query: Record<string, string> = {},
    ) => {
      await sync();
      return (
        await callAs<{ mentions: { nodeId: string; published: boolean }[] }>(
          mentionsGet,
          as,
          { params: { id: "jan" }, query },
        )
      ).mentions;
    };
    beforeEach(() => {
      table("nodes").jan = { type: "person", name: "Jan", published: true };
      table("nodes").a1 = {
        type: "article",
        name: "Stary",
        sourceURL: "https://e.test/1",
        publishedDate: "2025-01-01",
        published: true,
      };
      table("nodes").a2 = {
        type: "article",
        name: "Nowy",
        sourceURL: "https://e.test/2",
        publishedDate: "2026-01-01",
        published: true,
      };
      table("nodes").a3 = {
        type: "article",
        name: "Szkic",
        sourceURL: "https://e.test/3",
        published: false,
      };
      table("nodes").s = { type: "place", name: "S", published: true };
      table("edges").m1 = {
        type: "mentions",
        source: "jan",
        target: "a1",
        published: true,
      };
      table("edges").m2 = {
        type: "mentions",
        source: "a2",
        target: "jan",
        published: true,
      };
      table("edges").m3 = {
        type: "mentions",
        source: "jan",
        target: "a3",
        published: true,
      };
      table("edges").job = {
        type: "employed",
        source: "jan",
        target: "s",
        published: false,
        references: ["a1", "nope", "s"],
      };
      table("edges").gone = {
        type: "mentions",
        source: "jan",
        target: "a2",
        deleted: true,
      };
    });

    it("lists the articles either way round, newest first, once each, drafts withheld from the public", async () => {
      expect((await mentions()).map((m) => m.nodeId)).toEqual(["a2", "a1"]);
      const all = await mentions("reader", { latest: "true" });
      expect(all.map((m) => m.nodeId)).toEqual(["a2", "a1", "a3"]);
      // The live mention wins over the draft relation citing the same one.
      expect(all.find((m) => m.nodeId === "a1")?.published).toBe(true);
    });
  });

  describe("GET /api/nodes/articles", () => {
    it("lists the domains by how many people they name, and the article and note urls", async () => {
      table("stats").d1 = {
        type: "domain_articles",
        domain: "a.pl",
        articleCount: 3,
        peopleCount: 1,
      };
      table("stats").d2 = {
        type: "domain_articles",
        domain: "b.pl",
        articleCount: 1,
        peopleCount: 5,
        people: ["x"],
      };
      table("nodes").a1 = {
        type: "article",
        name: "A",
        sourceURL: "https://e.test/1",
      };
      table("notes").n1 = {
        nodeId: "x",
        userUid: "u",
        sources: [{ url: "https://e.test/n" }, { url: "https://e.test/1" }],
      };
      await sync();
      const domains = await callAs<{ domain: string; people: string[] }[]>(
        articlesIndexGet,
        undefined,
      );
      expect(domains.map((d) => d.domain)).toEqual(["b.pl", "a.pl"]);
      expect(domains[1]!.people).toEqual([]);
      expect(await callAs(articlesListGet, undefined, { query: {} })).toEqual({
        articles: ["https://e.test/1"],
        notes: ["https://e.test/n", "https://e.test/1"],
      });
    });
  });
});
