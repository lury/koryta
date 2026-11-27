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
import publishPost from "~~/server/api/nodes/publish.post";
import mergePost from "~~/server/api/nodes/merge.post";
import splitPost from "~~/server/api/nodes/split.post";
import { afterHandPublicationPg } from "~~/server/db/declarationHolds";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** Publication, merge and split on Postgres: what editorial.pg.test.ts does
 * not pin - each field of the audit rows, the relations either way round, the
 * revisions written on the way, what a dry run and a refusal leave behind.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/nodeWrites.pg.test.ts
 */

const cleared: string[] = [];

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  type Event = { body?: unknown; context: Record<string, unknown> };
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.defineCachedFunction = (fn: unknown) => fn;
  g.readValidatedBody = async (event: Event, parse: (b: unknown) => unknown) =>
    parse(event.body);
  g.useRuntimeConfig = () => ({ public: { siteUrl: "https://koryta.test" } });
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    createError: (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts),
    defineEventHandler: (fn: unknown) => fn,
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
  { uid: string; email?: string; emailVerified?: boolean }
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

const ADMIN = "admin-uid,admin";

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
const ids = async (name: string) => (await rows(name)).map((r) => r.id);
const isIso = (value: unknown) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

describe.runIf(PG_TEST_DATABASE_URL)("node writes on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("node_writes");
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

  describe("POST /api/nodes/publish", () => {
    type Published = {
      id: string;
      published: boolean;
      hiddenEdges: string[];
      approvedRevisionId: string | null;
    };
    const publish = async (published: boolean, as = ADMIN) => {
      await store.sync(sql);
      return callAs<Published>(publishPost, as, {
        body: { node_id: "node-1", published },
      });
    };
    const approved = { type: "person", name: "X", revision_id: "revisions/r" };
    const revision = (name: string, fields: Record<string, unknown> = {}) => ({
      node_id: "node-1",
      collection: "nodes",
      data: { type: "person", name },
      update_time: "2026-07-09T10:00:00.000Z",
      update_user: "author-uid",
      update_automatic: false,
      ...fields,
    });

    it("drops the cached pages when hiding a page too, and dates it on the way down", async () => {
      table("nodes")["node-1"] = { ...approved, published: true };
      await publish(false);
      expect(cleared).toContain("nitro:handlers");
      const node = await stored("nodes", "node-1");
      expect(node?.published).toBe(false);
      expect(isIso(node?.content_changed_at)).toBe(true);
    });

    it("leaves the hold alone when nothing changed, and on a company", async () => {
      table("nodes")["node-1"] = { ...approved, published: true };
      await publish(true);
      table("nodes")["node-1"] = { ...approved, type: "place" };
      await publish(true);
      expect(afterHandPublicationPg).not.toHaveBeenCalled();
    });

    it("files who published it, when, and who hid it, in the same transaction as the change", async () => {
      table("nodes")["node-1"] = approved;
      await publish(true);
      const [entry] = await audit();
      expect(entry).toMatchObject({
        action: "publish",
        collection: "nodes",
        target_id: "node-1",
        user: "admin-uid",
      });
      expect(isIso(entry!.at)).toBe(true);
      expect(isIso((await stored("nodes", "node-1"))?.content_changed_at)).toBe(
        true,
      );

      await publish(false);
      expect(await audit()).toEqual([
        expect.objectContaining({ action: "unpublish", user: "admin-uid" }),
      ]);
    });

    it("refuses when every revision the page has is unusable, writing nothing", async () => {
      table("nodes")["node-1"] = { type: "person", name: "X" };
      table("revisions")["rev-rejected"] = revision("X", {
        status: "rejected",
      });
      expect(await statusOf(publish(true))).toBe(400);
      expect((await stored("nodes", "node-1"))?.published).toBeUndefined();
      expect(await audit()).toEqual([]);
    });

    it("approves the newest revision of a page with none approved, in the reviewer's name, and tells its author", async () => {
      accounts.set("author-uid", {
        uid: "author-uid",
        email: "a@example.test",
        emailVerified: true,
      });
      table("nodes")["node-1"] = { type: "person", name: "X" };
      table("revisions")["rev-old"] = revision("Stara wersja");
      table("revisions")["rev-new"] = revision("Nowa wersja", {
        update_time: "2026-07-09T12:00:00.000Z",
      });
      const answer = await publish(true);
      expect(answer).toMatchObject({
        published: true,
        approvedRevisionId: "rev-new",
      });
      expect(await stored("nodes", "node-1")).toMatchObject({
        name: "Nowa wersja",
        published: true,
      });
      expect(await stored("revisions", "rev-new")).toMatchObject({
        status: "approved",
        review_user: "admin-uid",
      });
      expect((await stored("revisions", "rev-old"))?.status).toBeUndefined();
      const mail = await rows("mail");
      expect(mail.map((m) => m.id)).toEqual(["revisionApproved_rev-new"]);
      expect(mail[0]!.data).toMatchObject({
        to: ["a@example.test"],
        kind: "revisionApproved",
        uid: "author-uid",
      });
    });

    it("leaves an approved page's revision alone, and approves nothing when hiding", async () => {
      table("nodes")["node-1"] = approved;
      table("revisions")["rev-newer"] = revision("Nowsza", {
        update_time: "2026-07-09T12:00:00.000Z",
      });
      expect((await publish(true)).approvedRevisionId).toBeNull();
      expect(await stored("nodes", "node-1")).toMatchObject({
        name: "X",
        revision_id: "revisions/r",
      });
      expect((await stored("revisions", "rev-newer"))?.status).toBeUndefined();

      table("nodes")["node-1"] = { type: "person", name: "X", published: true };
      expect((await publish(false)).approvedRevisionId).toBeNull();
      expect((await stored("revisions", "rev-newer"))?.status).toBeUndefined();
      expect(await rows("mail")).toEqual([]);
    });

    it("takes the page's published relations down either way round, each filed, and leaves hidden ones alone", async () => {
      table("nodes")["node-1"] = approved;
      table("edges")["e-out"] = {
        type: "employed",
        source: "node-1",
        target: "node-2",
        published: true,
      };
      table("edges")["e-in"] = {
        type: "employed",
        source: "node-3",
        target: "node-1",
        published: true,
      };
      table("edges")["e-hidden"] = {
        type: "employed",
        source: "node-1",
        target: "node-2",
      };
      table("edges")["e-false"] = {
        type: "employed",
        source: "node-1",
        target: "node-2",
        published: false,
      };
      const answer = await publish(false);
      expect(answer.published).toBe(false);
      expect([...answer.hiddenEdges].sort()).toEqual(["e-in", "e-out"]);
      expect((await stored("edges", "e-out"))?.published).toBe(false);
      expect((await stored("edges", "e-in"))?.published).toBe(false);
      expect(await stored("edges", "e-hidden")).not.toHaveProperty("published");
      const edgeEntries = (await audit()).filter(
        (e) => e.collection === "edges",
      );
      expect(edgeEntries.map((e) => e.target_id).sort()).toEqual([
        "e-in",
        "e-out",
      ]);
      for (const entry of edgeEntries) {
        expect(entry).toMatchObject({ action: "unpublish", user: "admin-uid" });
      }
    });

    it("does not touch relations when a page goes live", async () => {
      table("nodes")["node-1"] = approved;
      table("edges")["e-1"] = {
        type: "employed",
        source: "node-1",
        target: "node-2",
      };
      expect((await publish(true)).hiddenEdges).toEqual([]);
      expect(await stored("edges", "e-1")).not.toHaveProperty("published");
      expect((await audit()).map((e) => e.collection)).toEqual(["nodes"]);
    });
  });

  describe("POST /api/nodes/merge", () => {
    type Merged = {
      plan: {
        duplicate_id: string;
        survivor_id: string;
        duplicate_name?: string;
        survivor_name?: string;
        counts: Record<string, number>;
        edges: Record<string, unknown>[];
      };
      applied: boolean;
    };
    const reason = "Jedna osoba, dwie strony";
    const merge = async (fields: Record<string, unknown> = {}) => {
      await store.sync(sql);
      return callAs<Merged>(mergePost, ADMIN, {
        body: { duplicate_id: "dup", survivor_id: "surv", reason, ...fields },
      });
    };
    beforeEach(() => {
      table("nodes").dup = {
        type: "person",
        name: "Andrzej Golimont",
        rejestrIo: "383093",
        published: true,
      };
      table("nodes").surv = {
        type: "person",
        name: "Andrzej Marcin Golimont",
        rejestrIo: "383093",
        published: true,
      };
    });

    it("re-points the duplicate's relations either way round at the page that stays", async () => {
      table("edges")["e-out"] = {
        type: "employed",
        source: "dup",
        target: "firma",
        name: "Prezes",
        start_date: "2020-01-01",
      };
      table("edges")["e-in"] = {
        type: "mentions",
        source: "artykul",
        target: "dup",
      };
      const answer = await merge();
      expect(answer.applied).toBe(true);
      expect(answer.plan.counts).toMatchObject({ moved: 2 });
      expect((await stored("edges", "e-out"))?.source).toBe("surv");
      expect(await stored("edges", "e-in")).toMatchObject({
        source: "artykul",
        target: "surv",
      });
    });

    it("names both pages in the plan and files the merge with the reason and what it moved", async () => {
      table("edges")["e-out"] = {
        type: "employed",
        source: "dup",
        target: "firma",
      };
      const answer = await merge();
      expect(answer.plan).toMatchObject({
        duplicate_id: "dup",
        survivor_id: "surv",
        duplicate_name: "Andrzej Golimont",
        survivor_name: "Andrzej Marcin Golimont",
      });
      expect(await audit()).toEqual([
        expect.objectContaining({
          action: "merge",
          collection: "nodes",
          target_id: "dup",
          user: "admin-uid",
          reason,
          merge: expect.objectContaining({
            into: "surv",
            moved: ["e-out"],
            collapsed: [],
          }),
        }),
      ]);
    });

    it("removes a spell the survivor already states with an approved revision, the survivor's copy untouched", async () => {
      const spell = {
        type: "employed",
        target: "firma",
        name: "Prezes",
        start_date: "2020-01-01",
      };
      table("edges")["e-dup"] = { ...spell, source: "dup" };
      table("edges")["e-surv"] = { ...spell, source: "surv" };
      const answer = await merge();
      expect(answer.plan.counts).toMatchObject({ collapsed: 1, moved: 0 });
      expect(await stored("edges", "e-dup")).toMatchObject({
        deleted: true,
        delete_reason: expect.stringContaining("e-surv"),
      });
      expect(
        (await rows("revisions"))
          .map((r) => r.data)
          .filter((r) => r.node_id === "e-dup"),
      ).toEqual([
        expect.objectContaining({
          collection: "edges",
          status: "approved",
          review_user: "admin-uid",
        }),
      ]);
      expect(await stored("edges", "e-surv")).toEqual({
        ...spell,
        source: "surv",
      });
    });

    it("keeps a candidacy the survivor appears to state already, moved and reported for review", async () => {
      const candidacy = {
        type: "election",
        target: "powiat",
        position: "Samorząd",
        start_date: "2024",
        party: "PiS",
      };
      table("edges")["e-dup"] = { ...candidacy, source: "dup" };
      table("edges")["e-surv"] = { ...candidacy, source: "surv" };
      const answer = await merge();
      expect(answer.plan.counts).toMatchObject({ review: 1, collapsed: 0 });
      expect(answer.plan.edges).toMatchObject([
        { edge_id: "e-dup", disposition: "review", duplicate_of: "e-surv" },
      ]);
      expect(await stored("edges", "e-dup")).toMatchObject({
        source: "surv",
      });
      expect(await stored("edges", "e-dup")).not.toHaveProperty("deleted");
    });

    it("writes nothing at all for a dry run, and clears no cache", async () => {
      table("edges")["e-out"] = {
        type: "employed",
        source: "dup",
        target: "firma",
      };
      const answer = await merge({ dry_run: true });
      expect(answer.applied).toBe(false);
      expect(answer.plan.edges).toMatchObject([{ disposition: "moved" }]);
      expect((await stored("edges", "e-out"))?.source).toBe("dup");
      expect(await stored("nodes", "dup")).not.toHaveProperty("merged_into");
      expect(await ids("revisions")).toEqual([]);
      expect(await audit()).toEqual([]);
      expect(cleared).toEqual([]);
    });

    it("lands on the page a reader would reach when the survivor was itself merged away", async () => {
      table("nodes").surv = {
        type: "person",
        name: "Andrzej Marcin Golimont",
        deleted: true,
        merged_into: "final",
      };
      table("nodes").final = { type: "person", name: "Andrzej M. Golimont" };
      table("edges")["e-out"] = {
        type: "employed",
        source: "dup",
        target: "firma",
      };
      const answer = await merge();
      expect(answer.plan.survivor_id).toBe("final");
      expect((await stored("edges", "e-out"))?.source).toBe("final");
      expect((await stored("nodes", "dup"))?.merged_into).toBe("final");
    });
  });

  describe("POST /api/nodes/split", () => {
    type Split = {
      into_id?: string;
      created_into: boolean;
      marked: boolean;
      applied: boolean;
      edges: Record<string, unknown>[];
      counts: Record<string, number>;
    };
    const reason = "Dwie osoby o tym samym imieniu i nazwisku";
    const split = async (fields: Record<string, unknown> = {}) => {
      await store.sync(sql);
      return callAs<Split>(splitPost, ADMIN, {
        body: {
          node_id: "dwoje",
          reason,
          edge_ids: ["e-1972"],
          into_person: { name: "Michał Nowak (ur. 1972)" },
          ...fields,
        },
      });
    };
    const e1961 = {
      type: "employed",
      source: "dwoje",
      target: "szpital",
      name: "Dyrektor",
      start_date: "2015-01-01",
    };
    const e1972 = {
      type: "employed",
      source: "dwoje",
      target: "gmina",
      name: "Radny",
      start_date: "2018-01-01",
    };
    beforeEach(() => {
      table("nodes").dwoje = {
        type: "person",
        name: "Michał Nowak",
        published: true,
      };
      table("edges")["e-1961"] = e1961;
      table("edges")["e-1972"] = e1972;
    });

    it("marks who said it is two people and when, filed as a split, touching nothing else", async () => {
      const answer = await split({
        reason: "Powód",
        mark_only: true,
        edge_ids: undefined,
        into_person: undefined,
      });
      expect(answer).toMatchObject({ marked: true, applied: true });
      const mark = (await stored("nodes", "dwoje"))?.needs_split as {
        at: string;
      };
      expect(mark).toEqual({
        reason: "Powód",
        at: expect.any(String),
        user: "admin-uid",
      });
      expect(isIso(mark.at)).toBe(true);
      expect(await audit()).toEqual([
        expect.objectContaining({
          action: "split",
          collection: "nodes",
          target_id: "dwoje",
          user: "admin-uid",
          reason: "Powód",
        }),
      ]);
      expect(await ids("nodes")).toEqual(["dwoje"]);
      expect(await stored("edges", "e-1972")).toEqual(e1972);
      expect(await ids("revisions")).toEqual([]);
    });

    it("creates the second person approved in the admin's name, moves only what was named, and files where it went", async () => {
      const answer = await split();
      expect(answer.created_into).toBe(true);
      expect(answer.counts).toMatchObject({ moved: 1 });
      const into = answer.into_id!;
      const created = (await rows("revisions")).filter(
        (r) => r.data.node_id === into,
      );
      expect(created.map((r) => r.data)).toEqual([
        expect.objectContaining({
          collection: "nodes",
          status: "approved",
          review_user: "admin-uid",
        }),
      ]);
      expect((await stored("edges", "e-1972"))?.source).toBe(into);
      expect(await stored("edges", "e-1961")).toEqual(e1961);
      expect(await audit()).toEqual([
        expect.objectContaining({
          action: "split",
          collection: "nodes",
          target_id: "dwoje",
          user: "admin-uid",
          reason,
          merge: { into, moved: ["e-1972"], collapsed: [] },
        }),
      ]);
    });

    it("moves onto a page made by hand without inventing one", async () => {
      table("nodes").druga = { type: "person", name: "Michał Nowak" };
      const answer = await split({ into_person: undefined, into_id: "druga" });
      expect(answer).toMatchObject({ into_id: "druga", created_into: false });
      expect((await stored("edges", "e-1972"))?.source).toBe("druga");
      expect(await ids("nodes")).toEqual(["druga", "dwoje"]);
    });

    it("leaves a relation the destination already states where it is", async () => {
      table("nodes").druga = { type: "person", name: "Michał Nowak" };
      table("edges")["e-druga"] = { ...e1972, source: "druga" };
      const answer = await split({ into_person: undefined, into_id: "druga" });
      expect(answer.counts).toMatchObject({ collapsed: 1, moved: 0 });
      expect(await stored("edges", "e-1972")).toEqual(e1972);
      expect(await stored("edges", "e-druga")).toEqual({
        ...e1972,
        source: "druga",
      });
    });

    it("writes nothing at all for a dry run, and clears no cache", async () => {
      const answer = await split({ dry_run: true });
      expect(answer).toMatchObject({ applied: false, created_into: true });
      expect(answer.edges).toMatchObject([
        { edge_id: "e-1972", disposition: "moved" },
      ]);
      expect(await ids("nodes")).toEqual(["dwoje"]);
      expect(await stored("edges", "e-1972")).toEqual(e1972);
      expect(await ids("revisions")).toEqual([]);
      expect(await audit()).toEqual([]);
      expect(cleared).toEqual([]);
    });

    it("refuses another page's relation, nowhere to put them and a merged-away page, writing nothing", async () => {
      table("edges")["e-obcy"] = {
        type: "employed",
        source: "ktos-inny",
        target: "gmina",
      };
      expect(await statusOf(split({ edge_ids: ["e-obcy"] }))).toBe(400);
      expect(await statusOf(split({ into_person: undefined }))).toBe(400);
      table("nodes").dwoje = {
        type: "person",
        name: "Michał Nowak",
        merged_into: "surv",
      };
      expect(await statusOf(split())).toBe(400);
      expect(await stored("edges", "e-obcy")).toMatchObject({
        source: "ktos-inny",
      });
      expect(await ids("nodes")).toEqual(["dwoje"]);
      expect(await audit()).toEqual([]);
    });
  });
});
