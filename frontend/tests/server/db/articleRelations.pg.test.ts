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
import topicApprove from "~~/server/api/topics/[id]/approve.post";
import mentionsPost from "~~/server/api/articles/[id]/mentions.post";
import topicsPost from "~~/server/api/articles/[id]/topics.post";
import articleIngest from "~~/server/api/ingest/article.post";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** An article's mentions and tags, the article ingest and a topic's tags on
 * approval, on Postgres: the cases `edges.pg.test.ts` does not take one by
 * one.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/articleRelations.pg.test.ts
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

const ADMIN = "admin-uid,admin";
const READER = "reader-uid";

const post = <T>(
  handler: unknown,
  as: string | undefined,
  body: unknown,
  params?: Record<string, string>,
) => callAs<T>(handler, as, { body, params });

const ofType = async (type: string) =>
  (await rows("edges")).filter((e) => e.data.type === type);

describe.runIf(PG_TEST_DATABASE_URL)(
  "an article's relations on Postgres",
  () => {
    beforeAll(async () => {
      sql = await openTestDatabase("article_relations");
    }, 120_000);
    afterAll(async () => {
      await closeTestDatabase(sql);
    });
    beforeEach(() => {
      store.clear();
      Object.assign(table("nodes"), {
        "article-1": { type: "article", name: "Artykuł", published: true },
        "person-1": { type: "person", name: "Anna Nowak", published: true },
        "place-1": { type: "place", name: "Spółka", published: true },
        "region-1": { type: "region", name: "Mazowieckie", published: true },
        "topic-a": { type: "topic", name: "Powodzianie KRR", published: true },
      });
    });

    describe("POST /api/ingest/article", () => {
      const ingest = (body: unknown) =>
        post<{ nodeId: string; created: boolean; mentions: string[] }>(
          articleIngest,
          READER,
          body,
        );

      it("creates the article and, in the same commit, says it names the person", async () => {
        await sync();
        const answer = await ingest({
          url: "https://example.pl/a",
          name: "Tytuł",
          mentions: ["person-1"],
        });
        expect(answer).toMatchObject({ created: true, mentions: ["person-1"] });
        expect(
          (await rows("nodes")).filter((n) => n.data.type === "article"),
        ).toHaveLength(2);
        const mentions = await ofType("mentions");
        expect(mentions).toHaveLength(1);
        expect(mentions[0]!.data).toMatchObject({
          source: answer.nodeId,
          target: "person-1",
          type: "mentions",
          published: false,
        });
      });

      it("ignores a node kind `mentions` is not declared for", async () => {
        await sync();
        const answer = await ingest({
          url: "https://example.pl/a",
          name: "T",
          mentions: ["region-1"],
        });
        expect(answer).toMatchObject({ created: true, mentions: [] });
        expect(await ofType("mentions")).toEqual([]);
      });

      it("is idempotent - promoting the same note twice adds nothing", async () => {
        await sync();
        const body = {
          url: "https://example.pl/a",
          name: "Tytuł",
          mentions: ["person-1"],
        };
        const first = await ingest(body);
        const before = {
          nodes: await rows("nodes"),
          edges: await rows("edges"),
          revisions: await rows("revisions"),
        };
        const second = await ingest(body);
        expect(second).toMatchObject({
          nodeId: first.nodeId,
          created: false,
          mentions: [],
        });
        expect({
          nodes: await rows("nodes"),
          edges: await rows("edges"),
          revisions: await rows("revisions"),
        }).toEqual(before);
      });

      it("stores a url pasted without a scheme as an absolute address", async () => {
        await sync();
        const answer = await ingest({ url: "example.pl/a", name: "T" });
        const [row] = await sql<Row[]>`
        SELECT id, data FROM nodes WHERE id = ${answer.nodeId}`;
        expect(row!.data.sourceURL).toBe("https://example.pl/a");
      });
    });

    describe("POST /api/articles/[id]/mentions", () => {
      it("does not write a second edge for a mention the pipeline already wrote", async () => {
        table("edges").existing = {
          source: "person-1",
          target: "article-1",
          type: "mentions",
          published: true,
        };
        await sync();
        await post(
          mentionsPost,
          READER,
          { add: ["person-1"] },
          { id: "article-1" },
        );
        expect((await ofType("mentions")).map((e) => e.id)).toEqual([
          "existing",
        ]);
      });

      it("refuses an id that is neither", async () => {
        await sync();
        expect(
          await statusOf(
            post(
              mentionsPost,
              READER,
              { add: ["person-1", "topic-a"] },
              { id: "article-1" },
            ),
          ),
        ).toBe(422);
        expect(await rows("edges")).toEqual([]);
        expect(await rows("revisions")).toEqual([]);
      });
    });

    describe("POST /api/articles/[id]/topics", () => {
      const tag = (as: string | undefined, body: unknown, id = "article-1") =>
        post(topicsPost, as, body, { id });

      it("writes a tag as a draft, so only signed in readers see it", async () => {
        await sync();
        await tag(READER, { add: ["topic-a"] });
        const [edge] = await ofType("tagged");
        expect(edge!.data).toMatchObject({
          source: "article-1",
          target: "topic-a",
          type: "tagged",
          published: false,
        });
      });

      it("does not write a second edge for a tag already there", async () => {
        table("edges").existing = {
          source: "article-1",
          target: "topic-a",
          type: "tagged",
          published: true,
        };
        await sync();
        await tag(READER, { add: ["topic-a"] });
        expect((await ofType("tagged")).map((e) => e.id)).toEqual(["existing"]);
      });

      it("refuses an id that is not a topic", async () => {
        await sync();
        expect(
          await statusOf(tag(READER, { add: ["topic-a", "person-1"] })),
        ).toBe(422);
        // Nothing may be written when part of the request is bad.
        expect(await rows("edges")).toEqual([]);
        expect(await rows("revisions")).toEqual([]);
      });

      it("refuses to tag something that is not an article", async () => {
        await sync();
        expect(
          await statusOf(tag(READER, { add: ["topic-a"] }, "person-1")),
        ).toBe(404);
        expect(await rows("edges")).toEqual([]);
      });

      it("marks a removed tag deleted", async () => {
        table("edges")["tag-1"] = {
          source: "article-1",
          target: "topic-a",
          type: "tagged",
          published: true,
        };
        await sync();
        await tag(READER, { remove: ["topic-a"] });
        expect((await ofType("tagged"))[0]).toMatchObject({
          id: "tag-1",
          data: { deleted: true },
        });
      });

      it("removes a tag whose edge was stored with `deleted: false`", async () => {
        table("edges")["tag-1"] = {
          source: "article-1",
          target: "topic-a",
          type: "tagged",
          published: true,
          deleted: false,
        };
        await sync();
        await tag(READER, { remove: ["topic-a"] });
        expect((await ofType("tagged"))[0]!.data.deleted).toBe(true);
      });

      it("rejects a request that changes nothing", async () => {
        await sync();
        expect(await statusOf(tag(READER, {}))).toBe(400);
      });
    });

    describe("api/topics/[id]/approve, the tags", () => {
      const edgeTag = {
        source: "article-1",
        target: "topic-1",
        type: "tagged",
      };
      beforeEach(() => {
        // Already approved and live, so only the tags are this call's business.
        table("nodes")["topic-1"] = {
          type: "topic",
          name: "Afera",
          published: true,
          revision_id: "revisions/topic-approved",
        };
        table("edges").t1 = { ...edgeTag, published: false };
        table("revisions").written = {
          node_id: "t1",
          collection: "edges",
          status: "pending",
          update_user: "pipeline",
          update_time: "2026-06-01T00:00:00.000Z",
          data: edgeTag,
        };
      });
      const approve = () =>
        post<{ published: boolean; tags: number }>(
          topicApprove,
          ADMIN,
          { edgeIds: ["t1"] },
          { id: "topic-1" },
        );
      const revision = async (id: string) =>
        (await sql<Row[]>`SELECT id, data FROM revisions WHERE id = ${id}`)[0]
          ?.data;

      it("puts a tag up as the revision it holds", async () => {
        await sync();
        expect(await approve()).toMatchObject({ published: true, tags: 1 });
        expect(await revision("written")).toMatchObject({
          status: "approved",
          review_user: "admin-uid",
        });
        expect((await rows("edges"))[0]!.data).toMatchObject({
          published: true,
          revision_id: "revisions/written",
        });
      });

      it("leaves a newer proposal to change the tag pending", async () => {
        table("revisions").proposal_t1_x = {
          node_id: "t1",
          collection: "edges",
          status: "pending",
          update_user: "reader-uid",
          update_time: "2026-09-01T00:00:00.000Z",
          data: { ...edgeTag, content: "Wspomniany w kontekście przetargu" },
        };
        await sync();
        await approve();
        const t1 = (await rows("edges"))[0]!.data;
        expect(t1).toMatchObject({
          published: true,
          revision_id: "revisions/written",
        });
        expect(t1).not.toHaveProperty("content");
        expect((await revision("proposal_t1_x"))!.status).toBe("pending");
      });

      it("puts a tag up on its own document when it holds none of its revisions", async () => {
        table("revisions").written!.data = { ...edgeTag, content: "inny opis" };
        await sync();
        expect(await approve()).toMatchObject({ tags: 1 });
        const t1 = (await rows("edges"))[0]!.data;
        expect(t1.published).toBe(true);
        expect(t1).not.toHaveProperty("revision_id");
        expect((await revision("written"))!.status).toBe("pending");
      });
    });
  },
);
