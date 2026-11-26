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
import createPost from "~~/server/api/revisions/create.post";
import approvePost from "~~/server/api/revisions/approve.post";
import rejectPost from "~~/server/api/revisions/reject.post";
import revisionGet from "~~/server/api/revisions/[id].get";
import byNodeGet from "~~/server/api/revisions/byNode.get";
import nodeHistoryGet from "~~/server/api/revisions/node.get";
import mineGet from "~~/server/api/revisions/mine.get";
import queueGet from "~~/server/api/revisions/queue.get";
import relationsGet from "~~/server/api/revisions/relations.get";
import pendingEdgesGet from "~~/server/api/revisions/pendingEdges.get";
import publishPost from "~~/server/api/nodes/publish.post";
import mergePost from "~~/server/api/nodes/merge.post";
import splitPost from "~~/server/api/nodes/split.post";
import pendingGet from "~~/server/api/nodes/pending.get";
import nodeRevisionsGet, {
  REVISIONS_PAGE_LIMIT,
} from "~~/server/api/nodes/revisions.get";
import { afterHandPublicationPg } from "~~/server/db/declarationHolds";
import { proposalId } from "~~/server/utils/revisions";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** The editorial writes and reads on Postgres - revisions, the queue,
 * publication, merge and split - with who may do what.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/editorial.pg.test.ts
 */

const cleared: string[] = [];

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
  g.defineCachedFunction = (fn: unknown) => fn;
  g.getRouterParam = (event: Event, name: string) => event.params?.[name];
  g.getQuery = (event: Event) => event.query ?? {};
  g.getValidatedQuery = async (event: Event, parse: (q: unknown) => unknown) =>
    parse(event.query ?? {});
  g.readBody = async (event: Event) => event.body;
  g.readValidatedBody = async (event: Event, parse: (b: unknown) => unknown) =>
    parse(event.body);
  g.setResponseHeader = (event: Event, name: string, value: string) => {
    event.context[`header:${name}`] = value;
  };
  g.useRuntimeConfig = () => ({ public: { siteUrl: "https://koryta.test" } });
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    createError: (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts),
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: TestEvent,
      parse: (q: unknown) => unknown,
    ) => parse(event.query ?? {}),
    setResponseHeader: (event: TestEvent, name: string, value: string) => {
      event.context[`header:${name}`] = value;
    },
  };
});

function userOf(event: TestEvent) {
  const header = event.headers.authorization;
  if (!header) throw Object.assign(new Error("401"), { statusCode: 401 });
  const [uid, ...claims] = header.split(",");
  return { uid, ...Object.fromEntries(claims.map((c) => [c, true])) } as {
    uid: string;
    admin?: boolean;
  };
}
vi.mock("~~/server/utils/auth", () => ({
  getUser: async (event: TestEvent) => userOf(event),
  requireAdmin: async (event: TestEvent) => {
    const user = userOf(event);
    if (user.admin !== true)
      throw Object.assign(new Error("403"), { statusCode: 403 });
    return user;
  },
}));

/** Firebase Auth's accounts, by uid. */
const accounts = new Map<
  string,
  { uid: string; email?: string; emailVerified?: boolean; displayName?: string }
>();
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUsers: async (ids: { uid: string }[]) => ({
      users: ids.flatMap(({ uid }) => accounts.get(uid) ?? []),
    }),
    getUser: async (uid: string) => {
      const account = accounts.get(uid);
      if (!account) throw new Error(`no account ${uid}`);
      return account;
    },
  }),
}));
vi.mock("~~/server/db/declarationHolds", () => ({
  afterHandPublicationPg: vi.fn(async () => {}),
}));

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

const ADMIN = "admin-1,admin";
const READER = "reader-1";

/** The document `id` of `table` as stored now. */
async function stored(name: string, id: string) {
  const [row] = await sql<{ data: Record<string, unknown> }[]>`
    SELECT data FROM ${sql(name)} WHERE id = ${id}`;
  return row?.data;
}
async function rows(name: string) {
  return sql<{ id: string; data: Record<string, unknown> }[]>`
    SELECT id, data FROM ${sql(name)} ORDER BY id`;
}
const audit = async () => (await rows("audit")).map((r) => r.data);

const person = (fields: Record<string, unknown> = {}) => ({
  type: "person",
  name: "Jan Kowalski",
  published: false,
  ...fields,
});
const place = (fields: Record<string, unknown> = {}) => ({
  type: "place",
  name: "Spółka SA",
  published: true,
  ...fields,
});
const revision = (
  nodeId: string,
  data: Record<string, unknown>,
  fields: Record<string, unknown> = {},
) => ({
  node_id: nodeId,
  collection: "nodes",
  data,
  update_time: "2026-10-01T10:00:00.000Z",
  update_user: "author-1",
  update_automatic: false,
  status: "pending",
  ...fields,
});

describe.runIf(PG_TEST_DATABASE_URL)("editorial writes on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("editorial");
    (globalThis as Record<string, unknown>).useStorage = () => ({
      clear: async (base: string) => {
        cleared.push(base);
      },
    });
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    accounts.clear();
    cleared.length = 0;
    vi.mocked(afterHandPublicationPg).mockClear();
  });

  describe("POST /api/revisions/create", () => {
    const create = async (as: string | undefined, body: unknown) => {
      await store.sync(sql);
      return callAs<{ id: string; node_id: string; duplicate: boolean }>(
        createPost,
        as,
        { body },
      );
    };

    it("files a pending proposal under an id derived from what it says, and leaves the page", async () => {
      table("nodes").kowalski = person({ content: "Stary." });
      const answer = await create(READER, {
        node_id: "kowalski",
        name: "Jan Kowalski",
        content: "Nowy.",
      });
      expect(answer.duplicate).toBe(false);
      expect(answer.id).toBe(
        proposalId(`kowalski_reader-1`, {
          type: "person",
          name: "Jan Kowalski",
          content: "Nowy.",
        }),
      );
      expect(await stored("revisions", answer.id)).toMatchObject({
        node_id: "kowalski",
        collection: "nodes",
        data: { type: "person", name: "Jan Kowalski", content: "Nowy." },
        update_user: "reader-1",
        update_automatic: false,
        status: "pending",
      });
      expect((await stored("nodes", "kowalski"))?.content).toBe("Stary.");
      // The trigger effect, in the write's transaction.
      expect((await stored("nodes", "kowalski"))?.revisions).toMatchObject({
        has_unapproved: true,
      });
    });

    it("hands back the waiting proposal instead of filing it again", async () => {
      table("nodes").kowalski = person();
      const body = { node_id: "kowalski", name: "Jan Kowalski", content: "x" };
      const first = await create(READER, body);
      const again = await callAs<{ id: string; duplicate: boolean }>(
        createPost,
        READER,
        { body },
      );
      expect(again).toEqual({
        id: first.id,
        node_id: "kowalski",
        duplicate: true,
      });
      expect(await rows("revisions")).toHaveLength(1);
    });

    it("lets a rejected proposal be made again, without overwriting it", async () => {
      table("nodes").kowalski = person();
      const data = { type: "person", name: "Jan Kowalski", content: "x" };
      const id = proposalId("kowalski_reader-1", data);
      table("revisions")[id] = revision("kowalski", data, {
        status: "rejected",
        reject_reason: "nie",
        update_user: "reader-1",
      });
      const answer = await create(READER, {
        node_id: "kowalski",
        name: "Jan Kowalski",
        content: "x",
      });
      expect(answer.id).not.toBe(id);
      expect((await stored("revisions", id))?.status).toBe("rejected");
    });

    it("turns down a proposal that says what the entry already says", async () => {
      table("nodes").kowalski = person({ content: "Ten sam." });
      expect(
        await statusOf(
          create(READER, {
            node_id: "kowalski",
            name: "Jan Kowalski",
            content: "Ten sam.",
          }),
        ),
      ).toBe(400);
      expect(await rows("revisions")).toHaveLength(0);
    });

    it("pins what a person answered about a company, and keeps what it was not given", async () => {
      table("nodes").spolka = place({ krsNumber: "0000123456" });
      const answer = await create(READER, {
        node_id: "spolka",
        name: "Spółka Nowa SA",
        isPublic: true,
        categories: [],
      });
      expect((await stored("revisions", answer.id))?.data).toMatchObject({
        name: "Spółka Nowa SA",
        nameSource: "manual",
        isPublic: true,
        isPublicSource: "manual",
        categories: [],
        categoriesSource: "manual",
        krsNumber: "0000123456",
      });
    });

    it("creates a draft page for a new entry, with the stats that make it findable", async () => {
      const answer = await create(READER, {
        type: "place",
        name: "Nowa Spółka",
      });
      expect(await stored("nodes", answer.node_id)).toMatchObject({
        type: "place",
        name: "Nowa Spółka",
        published: false,
        stats: { nodeGroupSize: 0, isApproved: false },
      });
      expect(answer.id).toMatch(/^[A-Za-z0-9]{20}$/);
      expect(answer.node_id).toMatch(/^[A-Za-z0-9]{20}$/);
    });

    it("falls back to a person for a type nobody may propose", async () => {
      const answer = await create(READER, { type: "region", name: "Ktoś" });
      expect((await stored("nodes", answer.node_id))?.type).toBe("person");
    });

    it("keeps a removal and insists on its reason", async () => {
      table("nodes").kowalski = person();
      expect(
        await statusOf(create(READER, { node_id: "kowalski", deleted: true })),
      ).toBe(400);
      const answer = await create(READER, {
        node_id: "kowalski",
        deleted: true,
        delete_reason: "Duplikat",
      });
      expect((await stored("revisions", answer.id))?.data).toMatchObject({
        deleted: true,
        delete_reason: "Duplikat",
      });
    });

    it("is refused to a caller with no token", async () => {
      expect(await statusOf(create(undefined, { name: "x" }))).toBe(401);
    });
  });

  describe("POST /api/revisions/approve", () => {
    const approve = async (as: string | undefined, body: unknown) => {
      await store.sync(sql);
      return callAs<{
        revision_id: string;
        id: string;
        collection: string;
        published: boolean;
      }>(approvePost, as, { body });
    };

    beforeEach(() => {
      table("nodes").kowalski = person({
        votes: { interesting: { total: 3 } },
      });
      table("revisions").r1 = revision("kowalski", {
        type: "person",
        name: "Jan Kowalski",
        content: "Zatwierdzony.",
      });
    });

    it("writes the snapshot onto the node, points it there, carries what the node owns", async () => {
      const answer = await approve(ADMIN, { revision_id: "r1" });
      expect(answer).toEqual({
        revision_id: "r1",
        id: "kowalski",
        collection: "nodes",
        published: false,
      });
      expect(await stored("nodes", "kowalski")).toMatchObject({
        content: "Zatwierdzony.",
        revision_id: "revisions/r1",
        published: false,
        votes: { interesting: { total: 3 } },
      });
      expect(await stored("revisions", "r1")).toMatchObject({
        status: "approved",
        review_user: "admin-1",
      });
      expect(await audit()).toEqual([
        expect.objectContaining({
          action: "approve",
          collection: "nodes",
          target_id: "kowalski",
          revision_id: "r1",
          user: "admin-1",
        }),
      ]);
      expect(cleared).toContain("nitro:handlers");
    });

    it("publishes in the same step when asked, files the publication, closes the hold", async () => {
      const answer = await approve(ADMIN, { revision_id: "r1", publish: true });
      expect(answer.published).toBe(true);
      expect((await audit()).map((e) => e.action).sort()).toEqual([
        "approve",
        "publish",
      ]);
      expect(afterHandPublicationPg).toHaveBeenCalledWith(
        "kowalski",
        "admin-1",
        true,
      );
    });

    it("files no publication and closes no hold for a page already live", async () => {
      table("nodes").kowalski = person({ published: true });
      await approve(ADMIN, { revision_id: "r1", publish: true });
      expect((await audit()).map((e) => e.action)).toEqual(["approve"]);
      expect(afterHandPublicationPg).not.toHaveBeenCalled();
    });

    it("approves a removal as a removal, even when asked to publish", async () => {
      table("revisions").r1 = revision("kowalski", {
        type: "person",
        name: "Jan Kowalski",
        deleted: true,
        delete_reason: "x",
      });
      const answer = await approve(ADMIN, { revision_id: "r1", publish: true });
      expect(answer.published).toBe(false);
      expect((await audit()).map((e) => e.action)).toEqual(["approve"]);
    });

    it("drops a rejection reason left by an earlier verdict", async () => {
      table("revisions").r1 = revision(
        "kowalski",
        { type: "person", name: "Jan Kowalski" },
        { status: "rejected", reject_reason: "nie" },
      );
      await approve(ADMIN, { revision_id: "r1" });
      expect(await stored("revisions", "r1")).not.toHaveProperty(
        "reject_reason",
      );
    });

    it("tells the author, once, and only through a verified address", async () => {
      accounts.set("author-1", {
        uid: "author-1",
        email: "a@example.test",
        emailVerified: true,
      });
      await approve(ADMIN, { revision_id: "r1" });
      await callAs(approvePost, ADMIN, { body: { revision_id: "r1" } });
      const mail = await rows("mail");
      expect(mail).toHaveLength(1);
      expect(mail[0]!.id).toBe("revisionApproved_r1");
      expect(mail[0]!.data).toMatchObject({
        to: ["a@example.test"],
        kind: "revisionApproved",
        uid: "author-1",
      });
    });

    it("writes to nobody unverified, opted out or about their own approval", async () => {
      accounts.set("author-1", {
        uid: "author-1",
        email: "a@example.test",
        emailVerified: false,
      });
      await approve(ADMIN, { revision_id: "r1" });
      expect(await rows("mail")).toHaveLength(0);
      accounts.set("author-1", {
        uid: "author-1",
        email: "a@example.test",
        emailVerified: true,
      });
      table("users")["author-1"] = {
        notifications: { revisionApproved: false },
      };
      await approve(ADMIN, { revision_id: "r1" });
      expect(await rows("mail")).toHaveLength(0);
      table("users")["author-1"] = {};
      table("revisions").r1 = revision(
        "kowalski",
        { type: "person", name: "Jan Kowalski" },
        { update_user: "admin-1" },
      );
      await approve(ADMIN, { revision_id: "r1" });
      expect(await rows("mail")).toHaveLength(0);
    });

    it("applies an edge revision to the edges collection", async () => {
      table("edges").e1 = { type: "employed", source: "kowalski", target: "s" };
      table("revisions").re = revision(
        "e1",
        { type: "employed", source: "kowalski", target: "s", name: "Prezes" },
        { collection: "edges" },
      );
      const answer = await approve(ADMIN, { revision_id: "re" });
      expect(answer.collection).toBe("edges");
      expect(await stored("edges", "e1")).toMatchObject({
        name: "Prezes",
        revision_id: "revisions/re",
      });
    });

    it("refuses to publish a relation whose page is a draft, naming it", async () => {
      table("nodes").s = place({ name: "Spółka" });
      table("edges").e1 = { type: "employed", source: "kowalski", target: "s" };
      table("revisions").re = revision(
        "e1",
        { type: "employed", source: "kowalski", target: "s" },
        { collection: "edges" },
      );
      const refused = approve(ADMIN, { revision_id: "re", publish: true });
      await expect(refused).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("Jan Kowalski"),
      });
      expect((await stored("edges", "e1"))?.published).toBeUndefined();
      expect(await audit()).toEqual([]);
    });

    it("publishes a relation whose two pages are live", async () => {
      table("nodes").kowalski = person({ published: true });
      table("nodes").s = place();
      table("edges").e1 = { type: "employed", source: "kowalski", target: "s" };
      table("revisions").re = revision(
        "e1",
        { type: "employed", source: "kowalski", target: "s" },
        { collection: "edges" },
      );
      expect(
        (await approve(ADMIN, { revision_id: "re", publish: true })).published,
      ).toBe(true);
    });

    it("refuses a revision that does not exist, one without data, and anybody not an admin", async () => {
      expect(await statusOf(approve(ADMIN, { revision_id: "nope" }))).toBe(404);
      table("revisions").empty = { node_id: "kowalski", update_user: "x" };
      expect(await statusOf(approve(ADMIN, { revision_id: "empty" }))).toBe(
        422,
      );
      expect(await statusOf(approve(READER, { revision_id: "r1" }))).toBe(403);
      expect(await statusOf(approve(undefined, { revision_id: "r1" }))).toBe(
        401,
      );
      expect((await stored("revisions", "r1"))?.status).toBe("pending");
    });
  });

  describe("POST /api/revisions/reject", () => {
    const reject = async (as: string | undefined, body: unknown) => {
      await store.sync(sql);
      return callAs(rejectPost, as, { body });
    };
    beforeEach(() => {
      table("nodes").kowalski = person({ revision_id: "revisions/served" });
      table("revisions").r1 = revision("kowalski", { name: "x" });
      table("revisions").served = revision("kowalski", { name: "y" });
    });

    it("marks it rejected with the reason, audits it and tells the author", async () => {
      accounts.set("author-1", {
        uid: "author-1",
        email: "a@example.test",
        emailVerified: true,
      });
      expect(
        await reject(ADMIN, { revision_id: "r1", reason: "Brak źródła" }),
      ).toEqual({ revision_id: "r1", status: "rejected" });
      expect(await stored("revisions", "r1")).toMatchObject({
        status: "rejected",
        reject_reason: "Brak źródła",
        review_user: "admin-1",
      });
      expect(await audit()).toEqual([
        expect.objectContaining({
          action: "reject",
          target_id: "kowalski",
          revision_id: "r1",
          reason: "Brak źródła",
        }),
      ]);
      const [mail] = await rows("mail");
      expect(mail!.id).toMatch(/^revisionRejected_r1_/);
      expect(mail!.data.message).toBeDefined();
    });

    it("refuses the revision the page serves, an empty reason, a missing one and non-admins", async () => {
      expect(
        await statusOf(reject(ADMIN, { revision_id: "served", reason: "x" })),
      ).toBe(409);
      expect(
        await statusOf(reject(ADMIN, { revision_id: "r1", reason: " " })),
      ).toBe(400);
      expect(
        await statusOf(reject(ADMIN, { revision_id: "nope", reason: "x" })),
      ).toBe(404);
      expect(
        await statusOf(reject(READER, { revision_id: "r1", reason: "x" })),
      ).toBe(403);
      expect(await audit()).toEqual([]);
      expect(await rows("mail")).toHaveLength(0);
    });
  });

  describe("the revision reads", () => {
    beforeEach(() => {
      table("nodes").kowalski = person({
        published: true,
        revision_id: "revisions/old",
      });
      table("revisions").old = revision(
        "kowalski",
        { type: "person", name: "Jan Kowalski" },
        { status: "approved", update_time: "2026-09-01T00:00:00.000Z" },
      );
      table("revisions").newer = revision(
        "kowalski",
        { type: "person", name: "Jan Kowalski", content: "Opis" },
        { update_time: "2026-10-02T00:00:00.000Z" },
      );
      table("revisions").camel = {
        nodeId: "kowalski",
        data: { type: "person", name: "Jan K." },
        update_time: "2026-08-01T00:00:00.000Z",
        update_user: "author-2",
      };
    });

    it("GET /api/revisions/[id] answers a signed-in reader with the document, 404 otherwise", async () => {
      await store.sync(sql);
      const one = (as: string | undefined, id: string) =>
        callAs(revisionGet, as, { params: { id } });
      expect(await one(READER, "newer")).toMatchObject({ status: "pending" });
      expect(await statusOf(one(READER, "nope"))).toBe(404);
      expect(await statusOf(one(undefined, "newer"))).toBe(401);
    });

    it("GET /api/revisions/byNode reads both spellings, the node's pointer and state", async () => {
      await store.sync(sql);
      const answer = await callAs<{
        revisions: { id: string }[];
        approvedRevisionId?: string;
        published: boolean;
        exists: boolean;
      }>(byNodeGet, READER, { query: { nodeId: "kowalski" } });
      expect(answer.revisions.map((r) => r.id)).toEqual([
        "newer",
        "old",
        "camel",
      ]);
      expect(answer).toMatchObject({
        approvedRevisionId: "old",
        published: true,
        exists: true,
      });
      // No page, a blank one, several, or a path: refused before a query.
      for (const query of [
        {},
        { nodeId: "" },
        { nodeId: ["kowalski", "nowak"] },
        { nodeId: "nodes/kowalski" },
      ]) {
        expect(
          await statusOf(callAs(byNodeGet, READER, { query } as never)),
        ).toBe(400);
      }
      expect(
        await statusOf(
          callAs(byNodeGet, undefined, { query: { nodeId: "x" } }),
        ),
      ).toBe(401);
    });

    it("GET /api/revisions/node describes the history newest first, names authors to an admin only", async () => {
      accounts.set("author-1", { uid: "author-1", displayName: "Anna" });
      await store.sync(sql);
      const history = (as: string) =>
        callAs<{
          revisions: {
            id: string;
            status: string;
            author: unknown;
            kind: string;
          }[];
          approvedRevisionId: string | null;
          exists: boolean;
        }>(nodeHistoryGet, as, { query: { nodeId: "kowalski" } });
      const admin = await history(ADMIN);
      expect(admin.revisions.map((r) => r.id)).toEqual([
        "newer",
        "old",
        "camel",
      ]);
      expect(admin.revisions[0]).toMatchObject({
        status: "pending",
        kind: "edit",
        author: { displayName: "Anna" },
      });
      expect(admin.revisions[1]!.status).toBe("approved");
      expect(admin.approvedRevisionId).toBe("old");
      expect((await history(READER)).revisions[0]!.author).toBeNull();
      const missing = await callAs<{ exists: boolean; revisions: unknown[] }>(
        nodeHistoryGet,
        READER,
        { query: { nodeId: "nobody" } },
      );
      expect(missing).toMatchObject({ exists: false, revisions: [] });
    });

    it("GET /api/revisions/mine reads the caller's own proposals, flagless ones too, never the reviewer", async () => {
      table("revisions").mine1 = revision(
        "kowalski",
        { type: "person", name: "Jan Kowalski", content: "Moje" },
        {
          update_user: "reader-1",
          status: "rejected",
          reject_reason: "nie",
          review_user: "admin-1",
        },
      );
      table("revisions").mine2 = {
        node_id: "spolka",
        data: { type: "place", name: "S" },
        update_time: "2026-10-03T00:00:00.000Z",
        update_user: "reader-1",
      };
      table("revisions").pipeline = revision(
        "kowalski",
        { name: "auto" },
        { update_user: "reader-1", update_automatic: true },
      );
      await store.sync(sql);
      const mine = (query: Record<string, string> = {}) =>
        callAs<{
          revisions: {
            id: string;
            reviewUser: unknown;
            rejectReason: unknown;
          }[];
          total: number;
          counts: Record<string, number>;
          truncated: boolean;
        }>(mineGet, READER, { query });
      const all = await mine();
      expect(all.revisions.map((r) => r.id)).toEqual(["mine2", "mine1"]);
      expect(all.counts).toMatchObject({ pending: 1, rejected: 1 });
      expect(all.truncated).toBe(false);
      expect(all.revisions[1]).toMatchObject({
        reviewUser: null,
        rejectReason: "nie",
      });
      expect((await mine({ nodeId: "kowalski" })).revisions).toHaveLength(1);
      const page2 = await mine({ limit: "1", page: "2" });
      expect(page2.revisions.map((r) => r.id)).toEqual(["mine1"]);
      expect(page2.counts).toEqual(all.counts);
      expect(await statusOf(callAs(mineGet, undefined, {}))).toBe(401);
    });
  });

  describe("GET /api/revisions/queue", () => {
    type Queue = {
      revisions: { id: string; subject: { id: string } }[];
      groups?: { subject: { id: string }; count: number }[];
      total: number;
      truncated: boolean;
      pinned: { id: string } | null;
      flagOnly: boolean;
    };
    const queue = async (query: Record<string, string> = {}, as = ADMIN) => {
      await store.sync(sql);
      return callAs<Queue>(queueGet, as, { query });
    };
    beforeEach(() => {
      table("nodes").live = person({ name: "Żywy", published: true });
      table("nodes").draft = person({ name: "Szkic" });
      table("nodes").s = place({ published: false });
      table("edges").e1 = { type: "employed", source: "s", target: "live" };
      table("revisions").a = revision(
        "live",
        { name: "Żywy 2" },
        { update_time: "2026-10-05T00:00:00.000Z", update_user: "u1" },
      );
      table("revisions").b = revision(
        "draft",
        { name: "Szkic 2" },
        { update_time: "2026-10-04T00:00:00.000Z", update_user: "u2" },
      );
      table("revisions").c = revision(
        "e1",
        { type: "employed", name: "Prezes" },
        {
          collection: "edges",
          update_time: "2026-10-03T00:00:00.000Z",
          update_user: "u1",
        },
      );
      table("revisions").auto = revision(
        "draft",
        { name: "auto" },
        { update_time: "2026-10-06T00:00:00.000Z", update_automatic: true },
      );
      table("revisions").flagless = {
        node_id: "live",
        data: { name: "stare" },
        update_time: "2026-01-01T00:00:00.000Z",
        update_user: "u1",
      };
      table("revisions").done = revision(
        "live",
        { name: "x" },
        { status: "approved", update_time: "2026-10-07T00:00:00.000Z" },
      );
    });

    it("lists the pending human proposals newest first, with a count, and says the flagless are out", async () => {
      const answer = await queue();
      expect(answer.revisions.map((r) => r.id)).toEqual(["a", "b", "c"]);
      expect(answer).toMatchObject({
        total: 3,
        truncated: false,
        flagOnly: true,
      });
      const page = await queue({ limit: "1", page: "2" });
      expect(page.revisions.map((r) => r.id)).toEqual(["b"]);
      expect(page.total).toBe(3);
    });

    it("widens to the pipeline and every state on request", async () => {
      const answer = await queue({ automatic: "all", status: "all" });
      expect(answer.revisions.map((r) => r.id)).toEqual([
        "done",
        "auto",
        "a",
        "b",
        "c",
        "flagless",
      ]);
      expect(answer.flagOnly).toBe(false);
    });

    it("leaves one author out in the statement, and one author's whole history in", async () => {
      const others = await queue({ excludeAuthor: "u1" });
      expect(others.revisions.map((r) => r.id)).toEqual(["b"]);
      expect(others.total).toBe(1);
      const own = await queue({ author: "u1" });
      expect(own.revisions.map((r) => r.id)).toEqual(["a", "c", "flagless"]);
    });

    it("says what a proposal is about: the entry, or the person at either end", async () => {
      const answer = await queue();
      expect(answer.revisions.map((r) => r.subject.id)).toEqual([
        "live",
        "draft",
        "live",
      ]);
    });

    it("filters by whether the entry is live, and groups by entry", async () => {
      expect(
        (await queue({ published: "true" })).revisions.map((r) => r.id),
      ).toEqual(["a", "c"]);
      expect(
        (await queue({ published: "false" })).revisions.map((r) => r.id),
      ).toEqual(["b"]);
      const grouped = await queue({ group: "subject" });
      expect(grouped.groups!.map((g) => [g.subject.id, g.count])).toEqual([
        ["live", 2],
        ["draft", 1],
      ]);
      expect(grouped.total).toBe(3);
    });

    it("answers a permalinked proposal beside the page, null when on it or missing", async () => {
      expect((await queue({ revision: "done" })).pinned?.id).toBe("done");
      expect((await queue({ revision: "a" })).pinned).toBeNull();
      expect((await queue({ revision: "nope" })).pinned).toBeNull();
    });

    it("is an admin's only, and never cached", async () => {
      expect(await statusOf(queue({}, READER))).toBe(403);
      expect(await statusOf(callAs(queueGet, undefined, { query: {} }))).toBe(
        401,
      );
      const event = {
        headers: { authorization: ADMIN },
        context: {},
        query: {},
      } as TestEvent;
      await (queueGet as unknown as (e: TestEvent) => Promise<unknown>)(event);
      expect(event.context["header:Cache-Control"]).toBe("private, no-store");
    });
  });

  describe("GET /api/revisions/relations and pendingEdges", () => {
    beforeEach(() => {
      table("nodes").kowalski = person({ published: true });
      table("nodes").s = place({ name: "Spółka" });
      table("nodes").d = place({ name: "Szkic", published: false });
      table("edges").live = {
        type: "employed",
        source: "kowalski",
        target: "s",
        published: true,
        name: "Prezes",
      };
      table("edges").draft = {
        type: "election",
        source: "kowalski",
        target: "d",
        by_election: true,
      };
      table("edges").gone = {
        type: "employed",
        source: "s",
        target: "kowalski",
        deleted: true,
      };
      table("revisions").p1 = revision(
        "live",
        { name: "Członek" },
        { collection: "edges", update_time: "2026-10-02T00:00:00.000Z" },
      );
      table("revisions").legacy = {
        node_id: "draft",
        collection: "edges",
        data: { type: "election" },
        update_time: "2026-01-01T00:00:00.000Z",
        update_user: "u",
      };
    });

    it("lists a page's relations worst first, with their revisions and what waits", async () => {
      await store.sync(sql);
      const answer = await callAs<{
        relations: {
          id: string;
          state: string;
          waiting: number;
          byElection: boolean;
          publishable: boolean;
          revisions: { id: string }[];
        }[];
        total: number;
        drafts: number;
        withProposals: number;
        proposals: number;
        nodePublished: boolean;
      }>(relationsGet, ADMIN, { query: { nodeId: "kowalski" } });
      expect(answer.relations.map((r) => [r.id, r.state])).toEqual([
        ["live", "proposals"],
        ["draft", "draft"],
        ["gone", "removed"],
      ]);
      expect(answer.relations[0]!.revisions.map((r) => r.id)).toEqual(["p1"]);
      // Stored without a status, so nobody waits on it.
      expect(answer.relations[1]).toMatchObject({
        waiting: 0,
        byElection: true,
        publishable: false,
      });
      expect(answer).toMatchObject({
        total: 3,
        drafts: 1,
        withProposals: 1,
        proposals: 1,
        nodePublished: true,
      });
      expect(
        await statusOf(
          callAs(relationsGet, READER, { query: { nodeId: "kowalski" } }),
        ),
      ).toBe(403);
    });

    it("lists the pending edge proposals with what they change, an admin's only", async () => {
      table("revisions").orphan = revision(
        "deleted-edge",
        { name: "x" },
        { collection: "edges", update_time: "2026-10-03T00:00:00.000Z" },
      );
      await store.sync(sql);
      const answer = await callAs<{
        revisions: {
          id: string;
          published: boolean;
          changes: unknown[];
          source: { name: string | null };
        }[];
        total: number;
      }>(pendingEdgesGet, ADMIN, { query: {} });
      expect(answer.total).toBe(2);
      expect(answer.revisions).toEqual([
        expect.objectContaining({
          id: "p1",
          edgeId: "live",
          published: true,
          changes: [{ field: "name", from: "Prezes", to: "Członek" }],
          source: { id: "kowalski", name: "Jan Kowalski", type: "person" },
        }),
      ]);
      expect(
        await statusOf(callAs(pendingEdgesGet, READER, { query: {} })),
      ).toBe(403);
    });
  });

  describe("POST /api/nodes/publish", () => {
    const publish = async (as: string | undefined, body: unknown) => {
      await store.sync(sql);
      return callAs<{
        id: string;
        published: boolean;
        hiddenEdges: string[];
        approvedRevisionId: string | null;
      }>(publishPost, as, { body });
    };
    beforeEach(() => {
      table("nodes").kowalski = person({ revision_id: "revisions/r0" });
      table("nodes").s = place();
      table("edges").up = {
        type: "employed",
        source: "kowalski",
        target: "s",
        published: true,
      };
      table("edges").down = {
        type: "employed",
        source: "s",
        target: "kowalski",
        published: false,
      };
    });

    it("publishes, dates the page, audits it and closes a person's hold", async () => {
      const answer = await publish(ADMIN, {
        node_id: "kowalski",
        published: true,
      });
      expect(answer).toEqual({
        id: "kowalski",
        published: true,
        hiddenEdges: [],
        approvedRevisionId: null,
      });
      const node = await stored("nodes", "kowalski");
      expect(node?.published).toBe(true);
      expect(typeof node?.content_changed_at).toBe("string");
      expect(await audit()).toEqual([
        expect.objectContaining({ action: "publish", target_id: "kowalski" }),
      ]);
      expect(afterHandPublicationPg).toHaveBeenCalledWith(
        "kowalski",
        "admin-1",
        true,
      );
      expect(cleared).toContain("nitro:handlers");
    });

    it("hides the page's live relations with it, each audited", async () => {
      table("nodes").kowalski = person({
        published: true,
        revision_id: "revisions/r0",
      });
      const answer = await publish(ADMIN, {
        node_id: "kowalski",
        published: false,
      });
      expect(answer.hiddenEdges).toEqual(["up"]);
      expect((await stored("edges", "up"))?.published).toBe(false);
      expect(
        (await audit()).map((e) => `${e.action} ${e.target_id}`).sort(),
      ).toEqual(["unpublish kowalski", "unpublish up"]);
      expect(afterHandPublicationPg).toHaveBeenCalledWith(
        "kowalski",
        "admin-1",
        false,
      );
    });

    it("approves the newest usable revision of a page with none approved, in the same transaction", async () => {
      table("nodes").kowalski = person();
      table("revisions").older = revision(
        "kowalski",
        { type: "person", name: "Stary" },
        { update_time: "2026-09-01T00:00:00.000Z" },
      );
      table("revisions").newest = revision(
        "kowalski",
        { type: "person", name: "Nowy" },
        { update_time: "2026-10-01T00:00:00.000Z" },
      );
      table("revisions").rejected = revision(
        "kowalski",
        { type: "person", name: "Odrzucony" },
        { update_time: "2026-11-01T00:00:00.000Z", status: "rejected" },
      );
      const answer = await publish(ADMIN, {
        node_id: "kowalski",
        published: true,
      });
      expect(answer.approvedRevisionId).toBe("newest");
      expect(await stored("nodes", "kowalski")).toMatchObject({
        name: "Nowy",
        revision_id: "revisions/newest",
        published: true,
      });
    });

    it("refuses a page with nothing to approve, a missing page and non-admins, writing nothing", async () => {
      table("nodes").kowalski = person();
      expect(
        await statusOf(
          publish(ADMIN, { node_id: "kowalski", published: true }),
        ),
      ).toBe(400);
      expect(
        await statusOf(publish(ADMIN, { node_id: "nope", published: false })),
      ).toBe(404);
      expect(
        await statusOf(
          publish(READER, { node_id: "kowalski", published: true }),
        ),
      ).toBe(403);
      expect((await stored("nodes", "kowalski"))?.published).toBe(false);
      expect(await audit()).toEqual([]);
    });
  });

  describe("POST /api/nodes/merge", () => {
    const merge = async (as: string | undefined, body: unknown) => {
      await store.sync(sql);
      return callAs<{
        plan: { counts: Record<string, number>; edges: unknown[] };
        applied: boolean;
      }>(mergePost, as, { body });
    };
    beforeEach(() => {
      table("nodes").dup = person({ name: "Jan Kowalski", parties: ["PiS"] });
      table("nodes").surv = person({ name: "Jan Marek Kowalski" });
      table("nodes").s = place();
      table("nodes").t = place({ name: "Inna" });
      table("edges").moving = {
        type: "employed",
        source: "dup",
        target: "s",
        name: "Prezes",
      };
      table("edges").same = {
        type: "employed",
        source: "dup",
        target: "t",
        name: "Członek",
        start_date: "2020-01-01",
      };
      table("edges").held = {
        type: "employed",
        source: "surv",
        target: "t",
        name: "Członek",
        start_date: "2020-01-01",
      };
      table("votes").dup_reader = {
        nodeId: "dup",
        userUid: "reader-1",
        categoryVotes: { interesting: 2 },
      };
    });
    const body = {
      duplicate_id: "dup",
      survivor_id: "surv",
      reason: "Ta sama osoba",
    };

    it("writes nothing for a dry run", async () => {
      const answer = await merge(ADMIN, { ...body, dry_run: true });
      expect(answer.applied).toBe(false);
      expect(answer.plan.counts).toMatchObject({ moved: 1, collapsed: 1 });
      expect((await stored("edges", "moving"))?.source).toBe("dup");
      expect(await audit()).toEqual([]);
    });

    it("moves, collapses, carries what the duplicate knew, re-files votes, puts it to rest", async () => {
      const answer = await merge(ADMIN, body);
      expect(answer.applied).toBe(true);
      expect((await stored("edges", "moving"))?.source).toBe("surv");
      expect(await stored("edges", "same")).toMatchObject({
        deleted: true,
        published: false,
        delete_reason: expect.stringContaining("held"),
      });
      expect((await stored("nodes", "surv"))?.parties).toEqual(["PiS"]);
      expect(await stored("votes", "dup_reader")).toBeUndefined();
      expect(await stored("votes", "surv_reader-1")).toMatchObject({
        nodeId: "surv",
        userUid: "reader-1",
      });
      expect(await stored("nodes", "dup")).toMatchObject({
        deleted: true,
        merged_into: "surv",
        published: false,
        delete_reason: "Ta sama osoba",
      });
      expect(await audit()).toEqual([
        expect.objectContaining({
          action: "merge",
          target_id: "dup",
          merge: expect.objectContaining({
            into: "surv",
            moved: ["moving"],
            collapsed: ["same"],
          }),
        }),
      ]);
      expect(cleared).toContain("nitro:handlers");
    });

    it("lands on the page a reader reaches when the survivor was merged away", async () => {
      table("nodes").old = person({ merged_into: "surv", deleted: true });
      await merge(ADMIN, { ...body, survivor_id: "old" });
      expect((await stored("nodes", "dup"))?.merged_into).toBe("surv");
    });

    it("refuses itself, a missing page, a company, an already merged page and non-admins", async () => {
      const refused = async (fields: Record<string, unknown>, as = ADMIN) =>
        statusOf(merge(as, { ...body, ...fields }));
      expect(await refused({ survivor_id: "dup" })).toBe(400);
      expect(await refused({ duplicate_id: "nope" })).toBe(400);
      expect(await refused({ survivor_id: "s" })).toBe(400);
      table("nodes").dup = person({ merged_into: "t" });
      expect(await refused({})).toBe(400);
      expect(await refused({}, READER)).toBe(403);
      expect(await audit()).toEqual([]);
    });
  });

  describe("POST /api/nodes/split", () => {
    const split = async (as: string | undefined, body: unknown) => {
      await store.sync(sql);
      return callAs<{
        into_id?: string;
        created_into: boolean;
        marked: boolean;
        applied: boolean;
        counts: Record<string, number>;
      }>(splitPost, as, { body });
    };
    beforeEach(() => {
      table("nodes").two = person({
        needs_split: { reason: "x", at: "2026-01-01T00:00:00.000Z", user: "a" },
      });
      table("nodes").other = person({ name: "Drugi" });
      table("nodes").s = place();
      table("edges").mine = { type: "employed", source: "two", target: "s" };
      table("edges").theirs = { type: "owns", source: "s", target: "two" };
    });

    it("marks a page, audits it, and writes nothing on a dry run", async () => {
      table("nodes").two = person();
      const dry = await split(ADMIN, {
        node_id: "two",
        reason: "Dwie osoby",
        mark_only: true,
        dry_run: true,
      });
      expect(dry).toMatchObject({ marked: true, applied: false });
      expect((await stored("nodes", "two"))?.needs_split).toBeUndefined();
      await split(ADMIN, {
        node_id: "two",
        reason: "Dwie osoby",
        mark_only: true,
      });
      expect((await stored("nodes", "two"))?.needs_split).toMatchObject({
        reason: "Dwie osoby",
        user: "admin-1",
      });
      expect(await audit()).toEqual([
        expect.objectContaining({ action: "split", reason: "Dwie osoby" }),
      ]);
    });

    it("creates the second person as an approved draft and moves only what was named", async () => {
      const answer = await split(ADMIN, {
        node_id: "two",
        reason: "Dwie",
        edge_ids: ["theirs"],
        into_person: { name: "Jan Kowalski (2)" },
      });
      expect(answer).toMatchObject({ created_into: true, applied: true });
      const into = await stored("nodes", answer.into_id!);
      expect(into).toMatchObject({
        type: "person",
        name: "Jan Kowalski (2)",
        published: false,
      });
      expect(into?.revision_id).toMatch(/^revisions\//);
      expect((await stored("edges", "theirs"))?.target).toBe(answer.into_id);
      expect((await stored("edges", "mine"))?.source).toBe("two");
      expect(await stored("nodes", "two")).not.toHaveProperty("needs_split");
      expect(cleared).toContain("nitro:handlers");
    });

    it("moves onto a page made by hand, and refuses what it cannot do", async () => {
      expect(
        (
          await split(ADMIN, {
            node_id: "two",
            reason: "x",
            edge_ids: ["mine"],
            into_id: "other",
          })
        ).into_id,
      ).toBe("other");
      expect((await stored("edges", "mine"))?.source).toBe("other");
      const refused = async (fields: Record<string, unknown>, as = ADMIN) =>
        statusOf(split(as, { node_id: "two", reason: "x", ...fields }));
      expect(await refused({ edge_ids: ["elsewhere"], into_id: "other" })).toBe(
        400,
      );
      expect(await refused({ into_id: "two" })).toBe(400);
      expect(await refused({ into_id: "nope" })).toBe(404);
      expect(await refused({})).toBe(400);
      expect(
        await refused({ into_id: "other", into_person: { name: "x" } }),
      ).toBe(400);
      expect(await refused({ node_id: "nope", mark_only: true })).toBe(404);
      expect(await refused({ mark_only: true }, READER)).toBe(403);
    });
  });

  describe("GET /api/nodes/pending and /api/nodes/revisions", () => {
    beforeEach(() => {
      table("nodes").waiting = person({
        revision_id: null,
        revisions: {
          latest_id: "w1",
          latest_time: "2026-10-01T00:00:00.000Z",
          total: 1,
          has_unapproved: true,
        },
      });
      table("nodes").settled = place({
        revision_id: "revisions/s1",
        revisions: {
          latest_id: "s1",
          latest_time: "2026-09-01T00:00:00.000Z",
          total: 1,
          has_unapproved: false,
        },
      });
      table("revisions").w1 = revision("waiting", { name: "x" });
    });

    it("lists the pages with a null pointer, each with its revisions, to a signed-in reader", async () => {
      await store.sync(sql);
      const answer = await callAs<
        Record<string, { revisions: { id: string }[] }>
      >(pendingGet, READER);
      expect(Object.keys(answer)).toEqual(["waiting"]);
      expect(answer.waiting!.revisions.map((r) => r.id)).toEqual(["w1"]);
      expect(await statusOf(callAs(pendingGet, undefined))).toBe(401);
    });

    it("pages the nodes by revision state and type, sorted by any field", async () => {
      await store.sync(sql);
      const list = (query: Record<string, string>) =>
        callAs<{
          nodes: Record<string, { visibility: boolean }>;
          total: number;
        }>(nodeRevisionsGet, READER, { query });
      expect(await list({ status: "unapproved" })).toMatchObject({
        nodes: { waiting: { visibility: false } },
        total: 1,
      });
      expect(Object.keys((await list({ type: "place" })).nodes)).toEqual([
        "settled",
      ]);
      expect(
        Object.keys(
          (await list({ sortBy: "revisions.latest_time", sortDesc: "true" }))
            .nodes,
        ),
      ).toEqual(["waiting", "settled"]);
      expect((await list({ limit: "1", page: "2" })).total).toBe(2);
      expect(
        await statusOf(callAs(nodeRevisionsGet, undefined, { query: {} })),
      ).toBe(401);
    });

    it("lists a page at most, however many are asked for", async () => {
      for (let i = 0; i < REVISIONS_PAGE_LIMIT + 2; i++) {
        table("nodes")[`revised${i}`] = {
          type: "person",
          name: `Revised ${i}`,
          revisions: {
            has_unapproved: true,
            latest_time: "2026-01-01T00:00:00Z",
          },
        };
      }
      await store.sync(sql);
      for (const query of [
        { status: "unapproved" },
        { status: "unapproved", limit: "1000" },
      ]) {
        const page = await callAs<{ nodes: object; total: number }>(
          nodeRevisionsGet,
          READER,
          { query },
        );
        expect(Object.keys(page.nodes)).toHaveLength(REVISIONS_PAGE_LIMIT);
        expect(page.total).toBeGreaterThan(REVISIONS_PAGE_LIMIT);
      }
    });

    it("serves nodeGroupSize and searchLine from node_derived over the stored stats", async () => {
      table("nodes").waiting = {
        ...table("nodes").waiting,
        stats: { queueTier: 1 },
      };
      await store.sync(sql);
      await sql`INSERT INTO node_derived (id, node_group_size, search_line)
        VALUES ('waiting', 7, '{"all": {"what": "Spółka"}}')`;
      const pending = await callAs<Record<string, { stats: unknown }>>(
        pendingGet,
        READER,
      );
      const listed = await callAs<{
        nodes: Record<string, { stats: unknown }>;
      }>(nodeRevisionsGet, READER, { query: { status: "unapproved" } });
      const want = {
        queueTier: 1,
        nodeGroupSize: 7,
        searchLine: { all: { what: "Spółka" } },
      };
      expect(pending.waiting!.stats).toEqual(want);
      expect(listed.nodes.waiting!.stats).toEqual(want);
    });
  });
});
