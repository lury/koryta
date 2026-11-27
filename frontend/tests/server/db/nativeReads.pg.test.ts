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
import extractionsGet from "~~/server/api/extractions/index.get";
import extractionGet from "~~/server/api/extractions/[id].get";
import referencesGet from "~~/server/api/edges/[id]/references.get";
import summaryGet from "~~/server/api/admin/summary.get";
import { OPEN_CAP, QUEUE_STEP } from "~~/shared/feedbackQueue";
import { writeDomainArticleStatsPg } from "~~/server/db/domainStats";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** The extraction facts, a relation's sources and the admin summary on
 * Postgres, with who may see what.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/nativeReads.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  // What Nitro auto-imports into the handlers, read off the test's event.
  type Event = {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    context: Record<string, unknown>;
  };
  g.getRouterParam = (event: Event, name: string) => event.params?.[name];
  g.getValidatedQuery = async (event: Event, parse: (q: unknown) => unknown) =>
    parse(event.query ?? {});
  g.readValidatedBody = async (event: Event, parse: (b: unknown) => unknown) =>
    parse(event.body);
  g.setResponseHeader = (event: Event, name: string, value: string) => {
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
    getRouterParam: (event: TestEvent, name: string) => event.params?.[name],
    getValidatedQuery: async (
      event: TestEvent,
      parse: (q: unknown) => unknown,
    ) => parse(event.query ?? {}),
  };
});
// The wrapper resolves the reader onto `context.hasUser` before the cache;
// `latest` is honoured for a signed-in caller only, as `wantsLatest` does.
vi.mock("~~/server/utils/handlers", () => ({
  readerAwareCachedEventHandler: (fn: unknown) => fn,
  wantsLatest: async (event: TestEvent) =>
    event.headers.authorization !== undefined && event.query?.latest === "true",
}));
vi.mock("~~/server/utils/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/utils/auth")>();
  return {
    ...actual,
    getUser: async (event: TestEvent) => {
      const header = event.headers.authorization;
      if (!header) throw Object.assign(new Error("401"), { statusCode: 401 });
      const [uid, ...claims] = header.split(",");
      return { uid, ...Object.fromEntries(claims.map((c) => [c, true])) };
    },
  };
});

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;
const sync = () => store.sync(sql);

type Facts = { facts: { id: string }[]; total: number };

describe.runIf(PG_TEST_DATABASE_URL)("native reads on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("reads");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
  });

  describe("GET /api/extractions", () => {
    const fact = (
      createdAt: string | undefined,
      fields: Record<string, unknown> = {},
    ) => ({
      url: "https://example.com/a",
      articleUrl: "https://example.com/a",
      justification: "bo tak",
      fact_type: "employment",
      tag: "v1",
      createdAt,
      ...fields,
    });
    const list = async (
      as: string | undefined,
      query: Record<string, string> = {},
    ) => {
      await sync();
      return callAs<Facts & { articles?: Record<string, unknown> }>(
        extractionsGet,
        as,
        { query },
      );
    };

    beforeEach(() => {
      Object.assign(table("extractions"), {
        old: fact("2026-01-01T00:00:00.000Z", {
          personNodeId: "kowalska",
          stats: { votes: { humanVoted: true } },
        }),
        mid: fact("2026-02-01T00:00:00.000Z", {
          articleUrl: "https://example.com/b",
          stats: { votes: { humanVoted: false } },
        }),
        new: fact("2026-03-01T00:00:00.000Z", { tag: "v2" }),
        // Dated by its article on the way in (0901), and listed with it.
        undated: fact(undefined, { articleNodeId: "article-a" }),
      });
      table("nodes")["article-a"] = {
        type: "article",
        name: "Artykuł",
        sourceURL: "https://example.com/a",
        publishedDate: "2026-01-15T00:00:00.000Z",
      };
    });

    it("serves the newest first, a page at a time, with the count of the whole query", async () => {
      expect(await list("reader")).toMatchObject({
        facts: [
          { id: "new" },
          { id: "mid" },
          { id: "undated", createdAt: "2026-01-15T00:00:00.000Z" },
          { id: "old" },
        ],
        total: 4,
      });
      const page = await list("reader", { limit: "1", page: "1" });
      expect(page.facts.map((f) => f.id)).toEqual(["mid"]);
      expect(page.total).toBe(4);
      expect(await statusOf(list("reader", { limit: "501" }))).toBe(400);
      expect(await statusOf(list("reader", { page: "-1" }))).toBe(400);
    });

    it("narrows by tag, article, person and the review state on the document", async () => {
      const ids = async (query: Record<string, string>) =>
        (await list("reader", query)).facts.map((f) => f.id);
      expect(await ids({ tag: "v2" })).toEqual(["new"]);
      expect(await ids({ articleUrl: "https://example.com/b" })).toEqual([
        "mid",
      ]);
      expect(await ids({ personNodeId: "kowalska" })).toEqual(["old"]);
      expect(await ids({ reviewed: "yes" })).toEqual(["old"]);
      // Firestore's `== false`: a fact with no aggregate matches neither.
      expect(await ids({ reviewed: "no" })).toEqual(["mid"]);
    });

    it("answers a fact as the model has it", async () => {
      const [first] = (await list("reader", { personNodeId: "kowalska" }))
        .facts;
      expect(first).toEqual({
        id: "old",
        url: "https://example.com/a",
        articleUrl: "https://example.com/a",
        justification: "bo tak",
        fact_type: "employment",
        tag: "v1",
        personNodeId: "kowalska",
        createdAt: "2026-01-01T00:00:00.000Z",
        stats: { votes: { humanVoted: true } },
        reviewed: true,
      });
    });

    it("groups a page by article", async () => {
      const answer = await list("reader", { groupBy: "article" });
      expect(Object.keys(answer.articles!)).toEqual([
        "https://example.com/a",
        "https://example.com/b",
      ]);
      expect(answer.total).toBe(4);
    });

    it("tells a caller with no user how many and never what, whatever it asked", async () => {
      for (const query of [
        {},
        { countOnly: "false" },
        { groupBy: "article" },
      ]) {
        expect(await list(undefined, query)).toEqual({ facts: [], total: 4 });
      }
      expect(await list("reader", { countOnly: "true", tag: "v1" })).toEqual({
        facts: [],
        total: 3,
      });
    });

    it("serves one fact by id to a signed-in reader only", async () => {
      await sync();
      const one = (as: string | undefined, id: string) =>
        callAs<{ fact: { id: string } }>(extractionGet, as, { params: { id } });
      expect((await one("reader", "old")).fact.id).toBe("old");
      expect(await statusOf(one(undefined, "old"))).toBe(401);
      expect(await statusOf(one("reader", "nope"))).toBe(404);
    });
  });

  describe("GET /api/edges/<id>/references", () => {
    const sources = async (as: string | undefined, latest = false) => {
      await sync();
      return callAs<{ id: string; sources: { id: string }[] }>(
        referencesGet,
        as,
        { params: { id: "edge-1" }, query: latest ? { latest: "true" } : {} },
      );
    };

    beforeEach(() => {
      Object.assign(table("nodes"), {
        "article-1": {
          type: "article",
          name: "Zet o spółce",
          sourceURL: "https://zet.pl/tekst",
          published: true,
        },
        "article-2": { type: "article", name: "Szkic", published: false },
      });
      table("edges")["edge-1"] = {
        source: "a",
        target: "b",
        type: "employed",
        published: true,
        references: ["article-1", "article-2", "ghost", "article-1"],
      };
    });

    it("names the articles a relation rests on, drafts and gone ones to an editor only", async () => {
      expect((await sources("editor", true)).sources).toEqual([
        { id: "ghost", name: null, sourceURL: null, published: false },
        { id: "article-2", name: "Szkic", sourceURL: null, published: false },
        {
          id: "article-1",
          name: "Zet o spółce",
          sourceURL: "https://zet.pl/tekst",
          published: true,
        },
      ]);
      for (const [as, latest] of [
        [undefined, false],
        [undefined, true],
        ["editor", false],
      ] as const) {
        expect((await sources(as, latest)).sources.map((s) => s.id)).toEqual([
          "article-1",
        ]);
      }
    });

    it("answers an edge with no sources with an empty list", async () => {
      table("edges")["edge-1"] = { source: "a", target: "b", published: true };
      expect(await sources(undefined)).toEqual({ id: "edge-1", sources: [] });
    });

    it("answers a draft relation to an editor, and to anybody else as if it were not there", async () => {
      table("edges")["edge-1"]!.published = false;
      expect((await sources("editor", true)).sources).toHaveLength(3);
      expect(await statusOf(sources(undefined, true))).toBe(404);
      expect(await statusOf(sources("editor"))).toBe(404);
      delete table("edges")["edge-1"];
      expect(await statusOf(sources("editor", true))).toBe(404);
    });
  });

  describe("GET /api/admin/summary", () => {
    type Summary = Awaited<ReturnType<typeof summaryGet>>;
    const summary = async () => {
      await sync();
      return callAs<Summary>(summaryGet, "admin-1,admin");
    };
    const report = (
      createdAt: string,
      extra: Record<string, unknown> = {},
    ) => ({
      kind: "bug",
      message: "Zgłoszenie",
      context: { route: "/entity/person/1" },
      createdAt,
      adminStatus: "new",
      ...extra,
    });
    const edgeRevision = (
      edgeId: string,
      automatic = false,
      at = "2026-08-04T00:00:00.000Z",
    ) => ({
      node_id: edgeId,
      collection: "edges",
      status: "pending",
      update_time: at,
      update_user: "user-1",
      ...(automatic ? { update_automatic: true } : {}),
    });

    it("refuses a caller who is not an admin, or nobody", async () => {
      await sync();
      expect(await statusOf(callAs(summaryGet, "reader-1"))).toBe(403);
      expect(await statusOf(callAs(summaryGet, undefined))).toBe(401);
    });

    it("counts the note entries waiting on an admin and the sources nobody typed", async () => {
      table("nodes")["node-1"] = { type: "person", name: "Jan Kowalski" };
      table("notes")["node-1_u"] = {
        nodeId: "node-1",
        userUid: "u",
        sources: [
          { note: "zła data urodzenia", kind: "change_request" },
          { note: "brakuje zarządu", kind: "missing" },
          {
            note: "poprawione",
            kind: "change_request",
            adminStatus: "resolved",
          },
          {
            note: "ciekawy artykuł",
            url: "https://example.com",
            adminType: "news",
          },
          { note: "odłożone", adminTypeDeferred: true },
          { note: "do sprawdzenia", adminStatus: "unresolved" },
        ],
      };
      const { notes } = await summary();
      expect(notes.needsAction).toBe(3);
      expect(notes.uncategorized).toBe(4);
      expect(notes.sample).toEqual([
        {
          noteId: "node-1_u",
          nodeId: "node-1",
          name: "Jan Kowalski",
          url: null,
          note: "zła data urodzenia",
          kind: "change_request",
          adminType: null,
        },
        expect.objectContaining({ note: "brakuje zarządu", kind: "missing" }),
        expect.objectContaining({ note: "do sprawdzenia", kind: "source" }),
      ]);
    });

    it("leaves queued and settled reports out of the untriaged count", async () => {
      Object.assign(table("feedback"), {
        "fb-unranked": report("2026-09-20T10:00:00.000Z"),
        "fb-ranked": report("2026-09-21T10:00:00.000Z", { queueRank: 1024 }),
        "fb-first": report("2026-09-22T10:00:00.000Z", { queueRank: 0 }),
        "fb-progress": report("2026-09-21T10:00:00.000Z", {
          adminStatus: "in_progress",
        }),
        "fb-resolved": report("2026-09-21T11:00:00.000Z", {
          adminStatus: "resolved",
        }),
      });
      const { feedback } = await summary();
      expect(feedback.needsAction).toBe(1);
      expect(feedback.sample).toEqual([
        {
          id: "fb-unranked",
          kind: "bug",
          message: "Zgłoszenie",
          route: "/entity/person/1",
          pageTitle: null,
          createdAt: "2026-09-20T10:00:00.000Z",
        },
      ]);
    });

    it("reads only the newest new reports, so past the cap the count is an upper bound", async () => {
      const queued = new Set([0, 1, OPEN_CAP + 1]);
      for (let i = 0; i < OPEN_CAP + 2; i++) {
        table("feedback")[`fb-${i}`] = report(
          new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
          queued.has(i) ? { queueRank: i * QUEUE_STEP } : {},
        );
      }
      const { feedback } = await summary();
      expect(feedback.needsAction).toBe(OPEN_CAP + 1);
      expect(feedback.sample.map((item) => item.id)).toEqual(
        Array.from({ length: 8 }, (_, i) => `fb-${OPEN_CAP - i}`),
      );
    });

    it("counts unapproved nodes and unsettled edge proposals, the pipeline's apart", async () => {
      Object.assign(table("nodes"), {
        "node-1": {
          type: "person",
          name: "Jan Kowalski",
          revisions: { has_unapproved: true, latest_id: "revisions/rev-human" },
        },
        "node-2": {
          type: "place",
          name: "Import",
          revisions: { has_unapproved: true, latest_id: "rev-auto" },
        },
        "node-3": {
          type: "person",
          name: "Bez rewizji",
          revisions: { has_unapproved: true },
        },
        "node-4": {
          type: "person",
          name: "Zatwierdzony",
          revisions: { has_unapproved: false },
        },
        "person-1": { type: "person", name: "Jan Kowalski" },
        teryt1465: { type: "region", name: "Powiat kaliski" },
      });
      Object.assign(table("revisions"), {
        "rev-human": {
          node_id: "node-1",
          update_time: "2026-08-01T00:00:00.000Z",
        },
        "rev-auto": {
          node_id: "node-2",
          update_time: "2026-08-01T00:00:00.000Z",
          update_automatic: true,
        },
        "rev-1": edgeRevision("edge-1", false, "2026-08-05T00:00:00.000Z"),
        "rev-gone": edgeRevision("edge-gone"),
        "rev-pipeline": edgeRevision("edge-1", true),
        "rev-done": { ...edgeRevision("edge-1"), status: "approved" },
      });
      table("edges")["edge-1"] = {
        source: "person-1",
        target: "teryt1465",
        type: "election",
      };
      const { revisions } = await summary();
      expect(revisions).toEqual({
        unapproved: 6,
        unapprovedManual: 4,
        inspected: 6,
        truncated: false,
        sample: [
          { kind: "node", id: "node-1", name: "Jan Kowalski", type: "person" },
          { kind: "node", id: "node-3", name: "Bez rewizji", type: "person" },
          {
            kind: "edge",
            id: "rev-1",
            name: "Jan Kowalski → Powiat kaliski",
            type: "election",
          },
          { kind: "edge", id: "rev-gone", name: "edge-gone", type: "" },
        ],
      });
    });

    it("gives each kind half the sample, and lets one spread into what the other leaves", async () => {
      for (let i = 0; i < 10; i++) {
        table("nodes")[`node-${i}`] = {
          type: "person",
          name: `Osoba ${i}`,
          revisions: { has_unapproved: true },
        };
      }
      for (let i = 0; i < 6; i++) {
        table("revisions")[`rev-${i}`] = edgeRevision(`edge-${i}`);
      }
      const kinds = async () =>
        (await summary()).revisions.sample.map((item) => item.kind);
      let sample = await kinds();
      expect(sample.filter((k) => k === "node")).toHaveLength(4);
      expect(sample.filter((k) => k === "edge")).toHaveLength(4);

      for (let i = 1; i < 6; i++) {
        Reflect.deleteProperty(table("revisions"), `rev-${i}`);
      }
      sample = await kinds();
      expect(sample.filter((k) => k === "node")).toHaveLength(7);
      expect(sample.filter((k) => k === "edge")).toHaveLength(1);
    });
  });

  describe("writeDomainArticleStatsPg", () => {
    it("replaces each domain's document whole and leaves the rest", async () => {
      table("stats").region_people = { type: "region_people" };
      table("stats").domain_articles_onet_pl = {
        type: "domain_articles",
        domain: "onet.pl",
        stale: true,
      };
      await sync();
      await writeDomainArticleStatsPg([
        {
          id: "domain_articles_onet_pl",
          data: { type: "domain_articles", domain: "onet.pl", articleCount: 2 },
        },
        {
          id: "domain_articles_zet_pl",
          data: { type: "domain_articles", domain: "zet.pl", articleCount: 1 },
        },
      ]);
      const rows = await sql<{ id: string; data: Record<string, unknown> }[]>`
        SELECT id, data FROM stats ORDER BY id`;
      expect(rows).toEqual([
        {
          id: "domain_articles_onet_pl",
          data: { type: "domain_articles", domain: "onet.pl", articleCount: 2 },
        },
        {
          id: "domain_articles_zet_pl",
          data: { type: "domain_articles", domain: "zet.pl", articleCount: 1 },
        },
        { id: "region_people", data: { type: "region_people" } },
      ]);
    });
  });
});
