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
import createPost from "~~/server/api/edges/create.post";
import deletePost from "~~/server/api/edges/delete.post";
import updatePost from "~~/server/api/edges/update.post";
import publishPost from "~~/server/api/edges/publish.post";
import referencesPost from "~~/server/api/edges/[id]/references.post";
import pendingGet from "~~/server/api/edges/pending.get";
import unpublishedGet from "~~/server/api/edges/unpublished.get";
import topicApprove from "~~/server/api/topics/[id]/approve.post";
import mentionsPost from "~~/server/api/articles/[id]/mentions.post";
import topicsPost from "~~/server/api/articles/[id]/topics.post";
import articleIngest from "~~/server/api/ingest/article.post";
import { edgeDocumentId } from "~~/server/utils/edges";
import {
  proposalId,
  sanitizeFirestoreData,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** The edge writes, the edge queues, a topic's approval and an article's
 * relations on Postgres, with who may do what.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/edges.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  type Event = {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    context: Record<string, unknown>;
  };
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.getRouterParam = (event: Event, name: string) => event.params?.[name];
  g.getValidatedQuery = async (event: Event, parse: (q: unknown) => unknown) =>
    parse(event.query ?? {});
  g.readValidatedBody = async (event: Event, parse: (b: unknown) => unknown) =>
    parse(event.body);
  g.readBody = async (event: Event) => event.body;
  g.setResponseHeader = (event: Event, name: string, value: string) => {
    event.context[`header:${name}`] = value;
  };
});
const clear = vi.fn();
(globalThis as Record<string, unknown>).useStorage = () => ({ clear });

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    createError: (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts),
    defineEventHandler: (fn: unknown) => fn,
    setResponseHeader: (event: TestEvent, name: string, value: string) => {
      event.context[`header:${name}`] = value;
    },
  };
});

/** `authorization: <uid>[,claim...]`, as pgHarness's callers pass it. */
function userOf(event: TestEvent) {
  const header = event.headers.authorization;
  if (!header) throw Object.assign(new Error("401"), { statusCode: 401 });
  const [uid, ...claims] = header.split(",");
  return { uid, ...Object.fromEntries(claims.map((c) => [c, true])) } as {
    uid: string;
    admin?: boolean;
    datascience?: boolean;
  };
}
vi.mock("~~/server/utils/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/utils/auth")>();
  return {
    ...actual,
    getUser: async (event: TestEvent) => userOf(event),
    requireAdmin: async (event: TestEvent) => {
      const user = userOf(event);
      if (user.admin !== true)
        throw Object.assign(new Error("403"), { statusCode: 403 });
      return user;
    },
  };
});

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;
const sync = () => store.sync(sql);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows read back as stored
type Row = { id: string; data: Record<string, any> };
const rows = (name: string) =>
  sql<Row[]>`SELECT id, data FROM ${sql(name)} ORDER BY id`;
const edge = async (id: string) =>
  (await sql<Row[]>`SELECT id, data FROM edges WHERE id = ${id}`)[0]?.data;
const revisionsOf = async (nodeId: string) =>
  (await rows("revisions")).filter((r) => r.data.node_id === nodeId);
const audits = async () => (await rows("audit")).map((r) => r.data);

const ADMIN = "admin-uid,admin";
const READER = "reader-uid";

const post = <T>(
  handler: unknown,
  as: string | undefined,
  body: unknown,
  params?: Record<string, string>,
) => callAs<T>(handler, as, { body, params });

type Created = { id: string; created: boolean; deleted?: boolean };

describe.runIf(PG_TEST_DATABASE_URL)("edges on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("edges");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    clear.mockClear();
    Object.assign(table("nodes"), {
      "person-1": { type: "person", name: "Jan Kowalski", published: true },
      "place-1": { type: "place", name: "Spółka Wodna", published: true },
      "region-1": { type: "region", name: "Gmina", published: true },
      draft: { type: "person", name: "Szkic Osoby", published: false },
    });
  });

  describe("POST /api/edges/create", () => {
    it("writes a relation as a draft, with its revision, for a signed-in reader only", async () => {
      await sync();
      const body = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        name: "prezes",
      };
      expect(await statusOf(post(createPost, undefined, body))).toBe(401);
      const result = await post<Created>(createPost, READER, body);
      expect(result.created).toBe(true);
      expect(await edge(result.id)).toMatchObject({
        source: "person-1",
        target: "place-1",
        type: "employed",
        name: "prezes",
        published: false,
      });
      expect(await revisionsOf(result.id)).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({
            collection: "edges",
            status: "pending",
            update_user: "reader-uid",
            update_automatic: false,
          }),
        }),
      ]);
    });

    it("lands the same relation stated twice on one document, and never over a live one", async () => {
      await sync();
      const body = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        start_date: "2020-01-01",
      };
      const first = await post<Created>(createPost, READER, body);
      await sql`UPDATE edges SET data = data || '{"published": true}' WHERE id = ${first.id}`;
      const second = await post<Created>(createPost, READER, body);
      expect(second).toEqual({ id: first.id, created: false });
      expect((await edge(first.id))!.published).toBe(true);
      expect(await revisionsOf(first.id)).toHaveLength(1);
      // Another spell is another relation.
      const third = await post<Created>(createPost, READER, {
        ...body,
        start_date: "2022-01-01",
      });
      expect(third.id).not.toBe(first.id);
      expect(third.id).toBe(
        edgeDocumentId({
          source: "person-1",
          target: "place-1",
          type: "employed",
          name: "",
          content: "",
          start_date: "2022-01-01",
          party: "",
          committee: "",
          term: "",
        }),
      );
    });

    it("refuses an undeclared type or position, accepts a blank position", async () => {
      await sync();
      const base = { source: "person-1", target: "region-1" };
      expect(
        await statusOf(
          post(createPost, READER, { ...base, type: "wspolpracuje" }),
        ),
      ).toBe(400);
      expect(
        await statusOf(
          post(createPost, READER, {
            ...base,
            type: "election",
            position: "Krolowa",
          }),
        ),
      ).toBe(400);
      expect(
        await post<Created>(createPost, READER, {
          source: "person-1",
          target: "place-1",
          type: "employed",
          position: "",
        }),
      ).toMatchObject({ created: true });
    });

    it("records a win on a candidacy and nowhere else, and keeps the cited article", async () => {
      await sync();
      const won = await post<Created>(createPost, READER, {
        source: "person-1",
        target: "region-1",
        type: "election",
        elected: true,
      });
      expect((await edge(won.id))!.elected).toBe(true);
      const job = await post<Created>(createPost, READER, {
        source: "person-1",
        target: "place-1",
        type: "employed",
        elected: true,
        references: ["article-1"],
      });
      const stored = (await edge(job.id))!;
      expect(stored).not.toHaveProperty("elected");
      expect(stored.references).toEqual(["article-1"]);
    });

    describe("made from an extracted fact", () => {
      const promotion = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        name: "prezes",
        extraction: "fact-1",
      };
      const fact = async () =>
        (await sql<Row[]>`SELECT data FROM extractions WHERE id = 'fact-1'`)[0]!
          .data;
      beforeEach(() => {
        table("extractions")["fact-1"] = {
          fact_type: "employment",
          personNodeId: "person-1",
          articleUrl: "https://example.com/a",
        };
      });

      it("tells the fact which relation it became, once, also when it was there", async () => {
        await sync();
        const first = await post<Created>(createPost, READER, promotion);
        expect((await fact()).promotedEdgeIds).toEqual([first.id]);
        const second = await post<Created>(createPost, READER, promotion);
        expect(second).toEqual({ id: first.id, created: false });
        expect((await fact()).promotedEdgeIds).toEqual([first.id]);
      });

      it("leaves the fact alone when that relation was removed, and says so", async () => {
        await sync();
        const first = await post<Created>(createPost, READER, promotion);
        await sql`UPDATE edges SET data = data || '{"deleted": true}' WHERE id = ${first.id}`;
        await sql`UPDATE extractions SET data = data - 'promotedEdgeIds'`;
        expect(await post(createPost, READER, promotion)).toEqual({
          id: first.id,
          created: false,
          deleted: true,
        });
        expect(await fact()).not.toHaveProperty("promotedEdgeIds");
      });

      it("refuses a fact it cannot become, and writes nothing", async () => {
        table("extractions")["fact-2"] = {
          fact_type: "party_membership",
          personNodeId: "person-1",
          articleUrl: "https://example.com/a",
        };
        await sync();
        for (const body of [
          { ...promotion, source: "draft" },
          { ...promotion, type: "election", target: "region-1" },
          { ...promotion, extraction: "fact-2" },
          { ...promotion, target: "region-1" },
          { ...promotion, target: "ghost" },
          { ...promotion, extraction: "nope" },
        ]) {
          expect(await statusOf(post(createPost, READER, body))).toBe(400);
        }
        expect(await rows("edges")).toEqual([]);
        expect(await rows("revisions")).toEqual([]);
        expect(await fact()).not.toHaveProperty("promotedEdgeIds");
      });
    });
  });

  describe("POST /api/edges/delete", () => {
    beforeEach(() => {
      table("edges").e1 = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        published: true,
        deleted: false,
        stats: { votes: 3 },
      };
      table("extractions")["fact-1"] = {
        fact_type: "employment",
        articleUrl: "https://example.com/a",
        promotedEdgeIds: ["e1", "e2"],
      };
    });
    const remove = (as: string | undefined, body: unknown) =>
      post<{ edge_id: string; deleted: true; revision_id: string | null }>(
        deletePost,
        as,
        body,
      );

    it("is an admin's only", async () => {
      await sync();
      const body = { edge_id: "e1", reason: "zły merge" };
      expect(await statusOf(remove(undefined, body))).toBe(401);
      expect(await statusOf(remove(READER, body))).toBe(403);
      expect((await edge("e1"))!.deleted).toBe(false);
    });

    it("marks it deleted and hidden, as an approved revision, audited, off its facts", async () => {
      await sync();
      const result = await remove(ADMIN, {
        edge_id: "e1",
        reason: "zły merge",
      });
      expect(result.revision_id).toEqual(expect.any(String));
      expect(await edge("e1")).toMatchObject({
        deleted: true,
        delete_reason: "zły merge",
        published: false,
        stats: { votes: 3 },
        revision_id: `revisions/${result.revision_id}`,
      });
      const [revision] = await revisionsOf("e1");
      expect(revision!.data).toMatchObject({
        status: "approved",
        update_user: "admin-uid",
        review_user: "admin-uid",
        data: expect.objectContaining({ deleted: true }),
      });
      expect(await audits()).toEqual([
        expect.objectContaining({
          action: "delete",
          collection: "edges",
          target_id: "e1",
          revision_id: result.revision_id,
          reason: "zły merge",
          user: "admin-uid",
        }),
      ]);
      const [fact] = await rows("extractions");
      expect(fact!.data.promotedEdgeIds).toEqual(["e2"]);
      expect(clear).toHaveBeenCalledWith("nitro:handlers");
    });

    it("is idempotent, and refuses a missing relation or reason", async () => {
      await sync();
      await remove(ADMIN, { edge_id: "e1", reason: "raz" });
      expect(await remove(ADMIN, { edge_id: "e1", reason: "dwa" })).toEqual({
        edge_id: "e1",
        deleted: true,
        revision_id: null,
      });
      expect(await revisionsOf("e1")).toHaveLength(1);
      expect(
        await statusOf(remove(ADMIN, { edge_id: "ghost", reason: "x" })),
      ).toBe(404);
      expect(
        await statusOf(remove(ADMIN, { edge_id: "e1", reason: " " })),
      ).toBe(400);
    });
  });

  describe("POST /api/edges/update", () => {
    const stored = {
      source: "jan",
      target: "orlen",
      type: "employed",
      name: "czlonek rady nadzorczej",
      start_date: "2019-01-01",
      published: true,
      revision_id: "revisions/old",
    };
    const renamed = () =>
      sanitizeFirestoreData({
        ...withoutInternalFields(stored),
        name: "prezes zarządu",
      }) as Record<string, unknown>;
    beforeEach(() => {
      table("edges").e1 = { ...stored };
    });
    type Updated = {
      edge_id: string;
      revision_id: string | null;
      applied: boolean;
      unchanged: boolean;
      duplicate: boolean;
    };
    const update = (as: string | undefined, body: unknown) =>
      post<Updated>(updatePost, as, body);

    it("files a contributor's change as their proposal and leaves the relation alone", async () => {
      await sync();
      expect(
        await statusOf(update(undefined, { edge_id: "e1", name: "x" })),
      ).toBe(401);
      const result = await update(READER, {
        edge_id: "e1",
        name: "prezes zarządu",
        end_date: "",
      });
      const id = proposalId("e1_reader-uid", {
        ...renamed(),
        end_date: "",
      });
      expect(result).toEqual({
        edge_id: "e1",
        revision_id: id,
        applied: false,
        unchanged: false,
        duplicate: false,
      });
      expect(await edge("e1")).toEqual(stored);
      const [revision] = await revisionsOf("e1");
      expect(revision).toMatchObject({
        id,
        data: {
          collection: "edges",
          status: "pending",
          update_user: "reader-uid",
          data: expect.objectContaining({
            name: "prezes zarządu",
            start_date: "2019-01-01",
            end_date: "",
            source: "jan",
          }),
        },
      });
    });

    it("hands back a proposal still waiting, and files a second ask beside a rejected one", async () => {
      await sync();
      const body = { edge_id: "e1", name: "prezes zarządu" };
      const first = await update(READER, body);
      expect(await update(READER, body)).toMatchObject({
        revision_id: first.revision_id,
        duplicate: true,
      });
      // Another contributor files their own.
      const other = await update("second-reader", body);
      expect(other.revision_id).toBe(proposalId("e1_second-reader", renamed()));
      await sql`UPDATE revisions SET data = data || '{"status": "rejected"}' WHERE id = ${first.revision_id!}`;
      const again = await update(READER, body);
      expect(again.revision_id).not.toBe(first.revision_id);
      expect(again.duplicate).toBe(false);
      expect(await revisionsOf("e1")).toHaveLength(3);
    });

    it("applies an admin's change at once, as visible as it was", async () => {
      table("edges").e1 = { ...stored, published: false };
      await sync();
      const result = await update(ADMIN, {
        edge_id: "e1",
        name: "prezes zarządu",
        source: "anna",
        type: "election",
      });
      expect(result.applied).toBe(true);
      expect(await edge("e1")).toMatchObject({
        name: "prezes zarządu",
        source: "jan",
        type: "employed",
        published: false,
        revision_id: `revisions/${result.revision_id}`,
      });
      expect((await revisionsOf("e1"))[0]!.data.status).toBe("approved");
      expect(clear).toHaveBeenCalledWith("nitro:handlers");
    });

    it("writes nothing when the relation already says this", async () => {
      await sync();
      expect(await update(ADMIN, { edge_id: "e1", name: stored.name })).toEqual(
        {
          edge_id: "e1",
          revision_id: null,
          applied: false,
          unchanged: true,
          duplicate: false,
        },
      );
      expect(await rows("revisions")).toEqual([]);
    });

    it("takes a win back without recording a defeat", async () => {
      table("edges").e1 = {
        source: "jan",
        target: "gmina",
        type: "election",
        elected: true,
        published: true,
        revision_id: "revisions/old",
      };
      await sync();
      await update(ADMIN, { edge_id: "e1", elected: false });
      expect(await edge("e1")).not.toHaveProperty("elected");
    });

    it("404s on a missing relation and 409s on a removed one", async () => {
      table("edges").gone = { ...stored, deleted: true };
      await sync();
      expect(
        await statusOf(update(ADMIN, { edge_id: "nope", name: "x" })),
      ).toBe(404);
      expect(
        await statusOf(update(ADMIN, { edge_id: "gone", name: "x" })),
      ).toBe(409);
    });
  });

  describe("POST /api/edges/publish", () => {
    beforeEach(() => {
      Object.assign(table("edges"), {
        live: {
          source: "person-1",
          target: "place-1",
          type: "employed",
          published: false,
        },
        blocked: {
          source: "person-1",
          target: "draft",
          type: "employed",
          published: false,
        },
        removed: {
          source: "person-1",
          target: "place-1",
          type: "owns",
          published: false,
          deleted: true,
        },
      });
      Object.assign(table("revisions"), {
        r1: {
          node_id: "live",
          collection: "edges",
          status: "pending",
          update_user: "pipeline",
          update_time: "2026-01-01T00:00:00.000Z",
          data: { source: "person-1", target: "place-1", type: "employed" },
        },
      });
    });
    type Published = {
      published: boolean;
      edge_ids: string[];
      approved: string[];
    };
    const publish = (as: string | undefined, body: unknown) =>
      post<Published>(publishPost, as, body);

    it("is an admin's only", async () => {
      await sync();
      const body = { edge_ids: ["live"], published: true };
      expect(await statusOf(publish(undefined, body))).toBe(401);
      expect(await statusOf(publish(READER, body))).toBe(403);
    });

    it("publishes, settling the revision it was written by, audited, in one commit", async () => {
      await sync();
      const result = await publish(ADMIN, {
        edge_ids: ["live", "live"],
        published: true,
      });
      expect(result).toEqual({
        published: true,
        edge_ids: ["live"],
        approved: ["r1"],
      });
      expect(await edge("live")).toMatchObject({
        published: true,
        revision_id: "revisions/r1",
      });
      const [r1] = await rows("revisions");
      expect(r1!.data).toMatchObject({
        status: "approved",
        review_user: "admin-uid",
      });
      expect((await audits()).map((a) => a.action).sort()).toEqual([
        "approve",
        "publish",
      ]);
      expect(clear).toHaveBeenCalledWith("nitro:handlers");
    });

    it("refuses the whole request for a draft end, a removed relation or a missing id", async () => {
      await sync();
      const refused = async (ids: string[]) => {
        try {
          await publish(ADMIN, { edge_ids: ids, published: true });
          return "";
        } catch (error) {
          const e = error as { statusCode: number; message: string };
          return `${e.statusCode} ${e.message}`;
        }
      };
      expect(await refused(["live", "blocked"])).toMatch(/^400 .*Szkic Osoby/);
      expect(await refused(["removed"])).toMatch(/^400 .*removed/);
      expect(await refused(["live", "ghost"])).toBe(
        "404 Nie ma powiązań o id: ghost",
      );
      expect((await edge("live"))!.published).toBe(false);
      expect(await audits()).toEqual([]);
    });

    it("hides without asking about the pages, leaving the proposal alone", async () => {
      await sync();
      const result = await publish(ADMIN, {
        edge_ids: ["blocked", "live"],
        published: false,
      });
      expect(result).toEqual({
        published: false,
        edge_ids: ["blocked", "live"],
        approved: [],
      });
      expect((await edge("blocked"))!.published).toBe(false);
      expect((await rows("revisions"))[0]!.data.status).toBe("pending");
      expect(
        (await audits()).map((a) => `${a.action} ${a.target_id}`).sort(),
      ).toEqual(["unpublish blocked", "unpublish live"]);
    });

    it("refuses more than one batch, or none", async () => {
      await sync();
      expect(
        await statusOf(
          publish(ADMIN, {
            edge_ids: Array.from({ length: 101 }, (_, i) => `e${i}`),
            published: true,
          }),
        ),
      ).toBe(400);
      expect(
        await statusOf(publish(ADMIN, { edge_ids: [], published: true })),
      ).toBe(400);
    });
  });

  describe("POST /api/edges/<id>/references", () => {
    beforeEach(() => {
      Object.assign(table("nodes"), {
        "article-1": { type: "article", name: "A", published: true },
        "article-2": { type: "article", name: "B", published: true },
      });
      table("edges").e1 = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        published: true,
        references: ["article-1"],
        stats: { votes: 1 },
        revision_id: "revisions/old",
      };
    });
    const change = (as: string | undefined, body: unknown, id = "e1") =>
      post<{ id: string; references: string[] }>(referencesPost, as, body, {
        id,
      });

    it("merges against what is stored, keeps it live, and replays safely", async () => {
      await sync();
      expect(await statusOf(change(undefined, { add: ["article-2"] }))).toBe(
        401,
      );
      expect(await change(READER, { add: ["article-2"] })).toEqual({
        id: "e1",
        references: ["article-1", "article-2"],
      });
      expect(await change(READER, { add: ["article-2"] })).toEqual({
        id: "e1",
        references: ["article-1", "article-2"],
      });
      expect(await change(READER, { remove: ["article-1"] })).toEqual({
        id: "e1",
        references: ["article-2"],
      });
      expect(await edge("e1")).toMatchObject({
        published: true,
        stats: { votes: 1 },
        references: ["article-2"],
        revision_id: "revisions/old",
      });
    });

    it("refuses a source that is not an article, a missing relation, an empty ask", async () => {
      await sync();
      expect(await statusOf(change(READER, { add: ["place-1"] }))).toBe(422);
      expect(await statusOf(change(READER, { add: ["ghost"] }))).toBe(422);
      expect(
        await statusOf(change(READER, { add: ["article-2"] }, "nope")),
      ).toBe(404);
      expect(await statusOf(change(READER, {}))).toBe(400);
      expect((await edge("e1"))!.references).toEqual(["article-1"]);
    });
  });

  describe("GET /api/edges/pending and /api/edges/unpublished", () => {
    beforeEach(() => {
      Object.assign(table("edges"), {
        a: {
          source: "person-1",
          target: "place-1",
          type: "employed",
          published: false,
          revision_id: null,
        },
        b: {
          source: "person-1",
          target: "draft",
          type: "employed",
          published: false,
        },
        c: {
          source: "person-1",
          target: "place-1",
          type: "owns",
          published: false,
          deleted: true,
        },
        d: {
          source: "person-1",
          target: "region-1",
          type: "election",
          published: false,
          name: "radny",
        },
        e: {
          source: "person-1",
          target: "place-1",
          type: "member",
          published: true,
        },
      });
      table("revisions").ra = {
        node_id: "a",
        collection: "edges",
        status: "pending",
      };
    });

    it("lists the never-reviewed relations with names and revisions to a signed-in reader", async () => {
      await sync();
      expect(await statusOf(callAs(pendingGet, undefined))).toBe(401);
      const answer = await callAs<Record<string, Record<string, unknown>>>(
        pendingGet,
        READER,
      );
      expect(Object.keys(answer)).toEqual(["a"]);
      const event: TestEvent = {
        headers: { authorization: READER },
        context: {},
      };
      await (pendingGet as unknown as (e: TestEvent) => Promise<unknown>)(
        event,
      );
      expect(event.context["header:Cache-Control"]).toMatch(/no-store/);
      expect(answer.a).toMatchObject({
        id: "a",
        source_name: "Jan Kowalski",
        target_name: "Spółka Wodna",
        revisions: [expect.objectContaining({ id: "ra", node_id: "a" })],
      });
    });

    it("lists the unpublished relations ready to go live, a page at a time, to an admin", async () => {
      await sync();
      const list = (as: string | undefined, query: Record<string, string>) =>
        callAs<{
          edges: { id: string; name: string | null }[];
          nextCursor: string | null;
          scanned: number;
          truncated: boolean;
        }>(unpublishedGet, as, { query });
      expect(await statusOf(list(READER, {}))).toBe(403);
      expect(await list(ADMIN, {})).toEqual({
        edges: [
          expect.objectContaining({ id: "a", name: null }),
          expect.objectContaining({ id: "d", name: "radny" }),
        ],
        nextCursor: null,
        scanned: 4,
        truncated: false,
      });
      const first = await list(ADMIN, { limit: "1" });
      expect(first.edges.map((e) => e.id)).toEqual(["a"]);
      expect(first.nextCursor).toBe("a");
      const rest = await list(ADMIN, { limit: "1", cursor: "a" });
      expect(rest.edges.map((e) => e.id)).toEqual(["d"]);
      expect(await statusOf(list(ADMIN, { limit: "101" }))).toBe(400);
    });
  });

  describe("POST /api/topics/<id>/approve", () => {
    beforeEach(() => {
      Object.assign(table("nodes"), {
        topic: { type: "topic", name: "Afera", published: false },
        "article-1": { type: "article", name: "A", published: true },
      });
      Object.assign(table("revisions"), {
        old: {
          node_id: "topic",
          collection: "nodes",
          status: "pending",
          update_user: "pipeline",
          update_time: "2026-01-01T00:00:00.000Z",
          data: { type: "topic", name: "Afera stara" },
        },
        newer: {
          node_id: "topic",
          collection: "nodes",
          status: "rejected",
          update_user: "pipeline",
          update_time: "2026-03-01T00:00:00.000Z",
          data: { type: "topic", name: "Odrzucona" },
        },
        mid: {
          node_id: "topic",
          collection: "nodes",
          status: "pending",
          update_user: "pipeline",
          update_time: "2026-02-01T00:00:00.000Z",
          data: { type: "topic", name: "Afera" },
        },
        tagRev: {
          node_id: "tag",
          collection: "edges",
          status: "pending",
          update_user: "pipeline",
          update_time: "2026-02-01T00:00:00.000Z",
          data: { source: "article-1", target: "topic", type: "tagged" },
        },
      });
      Object.assign(table("edges"), {
        tag: {
          source: "article-1",
          target: "topic",
          type: "tagged",
          published: false,
        },
        other: {
          source: "article-1",
          target: "place-1",
          type: "tagged",
          published: false,
        },
      });
    });
    const approve = (as: string | undefined, edgeIds?: string[]) =>
      post<{ topicId: string; published: boolean; tags: number }>(
        topicApprove,
        as,
        { edgeIds },
        { id: "topic" },
      );

    it("puts the topic up as its newest unrejected revision, then its own tags", async () => {
      await sync();
      expect(await statusOf(approve(READER, ["tag"]))).toBe(403);
      expect(await approve(ADMIN, ["tag", "other", "ghost"])).toEqual({
        topicId: "topic",
        published: true,
        tags: 1,
      });
      const topic = (
        await sql<Row[]>`SELECT data FROM nodes WHERE id = 'topic'`
      )[0]!.data;
      expect(topic).toMatchObject({
        name: "Afera",
        published: true,
        revision_id: "revisions/mid",
      });
      expect(await edge("tag")).toMatchObject({
        published: true,
        revision_id: "revisions/tagRev",
      });
      expect((await edge("other"))!.published).toBe(false);
      expect((await audits()).map((a) => `${a.action} ${a.target_id}`)).toEqual(
        expect.arrayContaining([
          "approve topic",
          "publish topic",
          "approve tag",
          "publish tag",
        ]),
      );
    });

    it("refuses a topic with nothing to approve, and a node that is no topic", async () => {
      await sync();
      await sql`DELETE FROM revisions WHERE data ->> 'node_id' = 'topic'`;
      expect(await statusOf(approve(ADMIN))).toBe(422);
      expect(
        await statusOf(post(topicApprove, ADMIN, {}, { id: "person-1" })),
      ).toBe(404);
    });
  });

  describe("an article's relations", () => {
    beforeEach(() => {
      Object.assign(table("nodes"), {
        "article-1": {
          type: "article",
          name: "A",
          sourceURL: "https://www.example.pl/a",
          published: true,
        },
        topic: { type: "topic", name: "Afera", published: true },
      });
      Object.assign(table("edges"), {
        // The pipeline's way round.
        m1: {
          source: "person-1",
          target: "article-1",
          type: "mentions",
          published: true,
        },
        m2: {
          source: "article-1",
          target: "person-1",
          type: "mentions",
          published: false,
          deleted: false,
        },
      });
    });
    type State = { edgeId: string; nodeId: string; published: boolean };

    it("adds a mention as a draft and leaves one already there", async () => {
      await sync();
      const answer = await post<{ mentions: State[] }>(
        mentionsPost,
        READER,
        { add: ["place-1", "person-1"] },
        { id: "article-1" },
      );
      const added = (await rows("edges")).filter(
        (e) => e.data.target === "place-1",
      );
      expect(added).toHaveLength(1);
      expect(added[0]!.data).toMatchObject({
        source: "article-1",
        type: "mentions",
        published: false,
      });
      expect(answer.mentions).toEqual(
        expect.arrayContaining([
          { edgeId: "m1", nodeId: "person-1", published: true },
          { edgeId: added[0]!.id, nodeId: "place-1", published: false },
        ]),
      );
    });

    it("removes every edge saying a mention, either way round", async () => {
      await sync();
      await post(
        mentionsPost,
        READER,
        { remove: ["person-1"] },
        { id: "article-1" },
      );
      expect((await edge("m1"))!.deleted).toBe(true);
      expect((await edge("m2"))!.deleted).toBe(true);
      expect((await edge("m1"))!.published).toBe(false);
    });

    it("refuses what is not a person or place, what is not an article, an empty ask", async () => {
      await sync();
      expect(
        await statusOf(
          post(mentionsPost, READER, { add: ["topic"] }, { id: "article-1" }),
        ),
      ).toBe(422);
      expect(
        await statusOf(
          post(mentionsPost, READER, { add: ["place-1"] }, { id: "place-1" }),
        ),
      ).toBe(404);
      expect(
        await statusOf(post(mentionsPost, READER, {}, { id: "article-1" })),
      ).toBe(400);
      expect(
        await statusOf(
          post(
            mentionsPost,
            undefined,
            { add: ["place-1"] },
            { id: "article-1" },
          ),
        ),
      ).toBe(401);
    });

    it("tags an article into a topic once, and only into a topic", async () => {
      await sync();
      await post(topicsPost, READER, { add: ["topic"] }, { id: "article-1" });
      await post(topicsPost, READER, { add: ["topic"] }, { id: "article-1" });
      const tags = (await rows("edges")).filter(
        (e) => e.data.type === "tagged",
      );
      expect(tags).toHaveLength(1);
      expect(
        await statusOf(
          post(topicsPost, READER, { add: ["person-1"] }, { id: "article-1" }),
        ),
      ).toBe(422);
    });

    it("ingests an article once however its url is spelled, with its mentions", async () => {
      await sync();
      const ingest = (body: unknown) =>
        post<{ nodeId: string; created: boolean; mentions: string[] }>(
          articleIngest,
          READER,
          body,
        );
      const fresh = await ingest({
        url: "https://zet.pl/nowy",
        name: "Nowy",
        publishedDate: "2026-02-03",
        mentions: ["person-1", "place-1", "topic"],
      });
      expect(fresh).toMatchObject({
        created: true,
        mentions: ["person-1", "place-1"],
      });
      const node = (
        await sql<Row[]>`SELECT data FROM nodes WHERE id = ${fresh.nodeId}`
      )[0]!.data;
      expect(node).toMatchObject({
        type: "article",
        sourceURL: "https://zet.pl/nowy",
        publishedDate: "2026-02-03T00:00:00.000Z",
        published: true,
        revision_id: expect.stringMatching(/^revisions\//),
      });
      expect(
        await ingest({
          url: "https://zet.pl/nowy",
          name: "Nowy",
          mentions: ["person-1"],
        }),
      ).toMatchObject({ nodeId: fresh.nodeId, created: false, mentions: [] });
      expect(await ingest({ url: "example.pl/a/", name: "A" })).toMatchObject({
        nodeId: "article-1",
        created: false,
      });
      expect(await statusOf(ingest({ url: "nie adres", name: "x" }))).toBe(400);
      expect(
        await statusOf(
          post(articleIngest, undefined, { url: "https://a.pl", name: "x" }),
        ),
      ).toBe(401);
    });
  });
});
