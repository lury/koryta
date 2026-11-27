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
import queueGet, {
  AUTHOR_SCAN_CAP,
  type RevisionQueue,
} from "~~/server/api/revisions/queue.get";
import mineGet, {
  MINE_SCAN_CAP,
  type MyProposals,
} from "~~/server/api/revisions/mine.get";
import nodeHistoryGet, {
  type NodeRevisionHistory,
} from "~~/server/api/revisions/node.get";
import relationsGet, {
  MAX_RELATIONS,
  type NodeRelationHistory,
} from "~~/server/api/revisions/relations.get";
import pendingEdgesGet, {
  type PendingEdgeRevision,
} from "~~/server/api/revisions/pendingEdges.get";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** The revision reads on Postgres - the review queue, a contributor's own
 * proposals, an entry's history, its relations and the pending edge
 * proposals - case by case, beside the broader ones in editorial.pg.test.ts.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/revisionReads.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  type Event = { query?: Record<string, string> };
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.defineCachedFunction = (fn: unknown) => fn;
  g.useRuntimeConfig = () => ({ public: { siteUrl: "https://koryta.test" } });
  g.getQuery = (event: Event) => event.query ?? {};
  g.getValidatedQuery = async (event: Event, parse: (q: unknown) => unknown) =>
    parse(event.query ?? {});
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

/** Firebase Auth's accounts, by uid, and who asked for them. */
const { accounts, getUsers } = vi.hoisted(() => {
  const accounts = new Map<
    string,
    {
      uid: string;
      email?: string;
      displayName?: string;
      photoURL?: string | null;
    }
  >();
  const getUsers = vi.fn(async (ids: { uid: string }[]) => ({
    users: ids.flatMap(({ uid }) => accounts.get(uid) ?? []),
  }));
  return { accounts, getUsers };
});
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUsers }),
}));

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

const ADMIN = "admin-uid,admin";
const VOLUNTEER = "volunteer-uid";

type Data = Record<string, unknown>;
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

/** A human proposal against `node-1` by `volunteer-uid`. An override of
 * `undefined` leaves the field out, which is how the flagless revisions are
 * stored. */
function addRevision(id: string, overrides: Data = {}) {
  table("revisions")[id] = {
    node_id: "node-1",
    collection: "nodes",
    data: { name: "Anna Nowak", type: "person", content: "Nowy opis." },
    status: "pending",
    update_time: "2026-08-10T09:00:00.000Z",
    update_user: "volunteer-uid",
    update_automatic: false,
    ...overrides,
  };
}

/** Points `nodeId` at an approved revision holding `data`, filed long before
 * any proposal. */
function approveOnto(nodeId: string, revisionId: string, data: Data) {
  table("revisions")[revisionId] = {
    node_id: nodeId,
    collection: "nodes",
    data,
    status: "approved",
    update_time: "2026-01-01T00:00:00.000Z",
    review_time: "2026-01-01T00:00:00.000Z",
    update_user: "admin-uid",
    update_automatic: false,
  };
  table("nodes")[nodeId] = {
    ...table("nodes")[nodeId],
    revision_id: `revisions/${revisionId}`,
  };
}

/** `n` revisions a minute apart from 2026-01-01. */
function addMany(n: number) {
  for (let i = 0; i < n; i++) {
    addRevision(`rev-${String(i).padStart(4, "0")}`, {
      update_time: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    });
  }
}

/** Calls `handler` as `as` and hands back the answer with the headers set. */
async function read<T>(
  handler: unknown,
  as: string | undefined,
  query: Record<string, string> = {},
): Promise<T & { headers: Record<string, unknown> }> {
  await store.sync(sql);
  const event = {
    headers: as ? { authorization: as } : {},
    context: {} as Record<string, unknown>,
    query,
  };
  const answer = await (handler as (e: TestEvent) => Promise<T>)(event);
  return { ...answer, headers: event.context };
}

describe.runIf(PG_TEST_DATABASE_URL)("revision reads on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("revq_reads");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    accounts.clear();
    getUsers.mockClear();
    table("nodes")["node-1"] = {
      name: "Anna Nowak",
      type: "person",
      content: "Stary opis.",
      published: true,
    };
  });

  describe("GET /api/revisions/queue", () => {
    const queue = (query: Record<string, string> = {}, as = ADMIN) =>
      read<RevisionQueue>(queueGet, as, query);

    it("holds 25 pending human proposals a page by default", async () => {
      addMany(26);
      const answer = await queue();
      expect(answer.revisions).toHaveLength(25);
      expect(answer.revisions[0]!.id).toBe("rev-0025");
      expect(answer.total).toBe(26);
    });

    it("pages one person's exclusion exactly, the count over the same clauses", async () => {
      addRevision("theirs-1", { update_time: "2026-08-01T09:00:00.000Z" });
      addRevision("mine-1", {
        update_user: "admin-uid",
        update_time: "2026-08-02T09:00:00.000Z",
      });
      addRevision("theirs-2", { update_time: "2026-08-03T09:00:00.000Z" });
      addRevision("mine-2", {
        update_user: "admin-uid",
        update_time: "2026-08-04T09:00:00.000Z",
      });
      addRevision("theirs-3", {
        update_user: "other-uid",
        update_time: "2026-08-05T09:00:00.000Z",
      });
      const first = await queue({ excludeAuthor: "admin-uid", limit: "2" });
      expect(ids(first.revisions)).toEqual(["theirs-3", "theirs-2"]);
      expect(first.total).toBe(3);
      const second = await queue({
        excludeAuthor: "admin-uid",
        limit: "2",
        page: "2",
      });
      expect(ids(second.revisions)).toEqual(["theirs-1"]);
      expect(second.total).toBe(3);

      const none = await queue({
        author: "admin-uid",
        excludeAuthor: "admin-uid",
        status: "all",
      });
      expect(none.revisions).toEqual([]);
      expect(none.total).toBe(0);

      const hers = await queue({
        author: "volunteer-uid",
        excludeAuthor: "admin-uid",
      });
      expect(ids(hers.revisions)).toEqual(["theirs-2", "theirs-1"]);
    });

    describe("one person's history", () => {
      it("reads everything they filed, flag or no flag, but not the pipeline's", async () => {
        addRevision("rev-flagless", {
          update_automatic: undefined,
          update_time: "2026-07-01T09:00:00.000Z",
        });
        addRevision("rev-flagged", {
          update_time: "2026-08-01T09:00:00.000Z",
        });
        addRevision("rev-pipeline", {
          update_automatic: true,
          update_time: "2026-08-02T09:00:00.000Z",
        });
        addRevision("rev-somebody-else", {
          update_user: "other-uid",
          update_time: "2026-08-03T09:00:00.000Z",
        });
        const all = await queue({ author: "volunteer-uid", status: "all" });
        expect(ids(all.revisions)).toEqual(["rev-flagged", "rev-flagless"]);
        expect(all.flagOnly).toBe(false);
      });

      it("keeps a revision with neither flag nor status in the pending view", async () => {
        addRevision("rev-flagless", {
          update_automatic: undefined,
          status: undefined,
        });
        const answer = await queue({ author: "volunteer-uid" });
        expect(ids(answer.revisions)).toEqual(["rev-flagless"]);
        expect(answer.revisions[0]!.status).toBe("pending");
      });

      it("filters the status over the whole scan, with the reason on the row", async () => {
        addRevision("rev-pending", { update_time: "2026-08-01T09:00:00.000Z" });
        addRevision("rev-rejected", {
          status: "rejected",
          reject_reason: "Brak źródła.",
          update_time: "2026-08-02T09:00:00.000Z",
        });
        const answer = await queue({
          author: "volunteer-uid",
          status: "rejected",
        });
        expect(ids(answer.revisions)).toEqual(["rev-rejected"]);
        expect(answer.total).toBe(1);
        expect(answer.revisions[0]!.rejectReason).toBe("Brak źródła.");
      });

      it("says the answer is a lower bound once the scan hits its cap, and not before", async () => {
        addMany(AUTHOR_SCAN_CAP - 1);
        expect(
          (await queue({ author: "volunteer-uid", limit: "1" })).truncated,
        ).toBe(false);
        addRevision("rev-last", { update_time: "2026-12-01T00:00:00.000Z" });
        expect(
          (await queue({ author: "volunteer-uid", limit: "1" })).truncated,
        ).toBe(true);
      });
    });

    it("answers a decided permalinked proposal beside the page, with its state", async () => {
      addRevision("rev-pending");
      addRevision("rev-decided", {
        status: "rejected",
        reject_reason: "Nie ma na to źródła.",
        update_time: "2026-08-09T09:00:00.000Z",
      });
      const answer = await queue({ revision: "rev-decided" });
      expect(ids(answer.revisions)).toEqual(["rev-pending"]);
      expect(answer.pinned).toMatchObject({
        id: "rev-decided",
        status: "rejected",
      });
    });

    describe("what a row says about its target", () => {
      it("links a node revision to the page, diffed against the approved snapshot", async () => {
        approveOnto("node-1", "rev-approved", {
          name: "Anna Nowak",
          type: "person",
          content: "Stary opis.",
        });
        addRevision("rev-1");
        const row = (await queue()).revisions.find((r) => r.id === "rev-1")!;
        expect(row).toMatchObject({
          targetExists: true,
          targetCollection: "nodes",
          targetName: "Anna Nowak",
          targetType: "person",
          targetPath: "/osoba/anna-nowak-node-1",
          published: true,
          kind: "edit",
        });
        expect(row.changes).toEqual([
          {
            field: "content",
            label: "opis",
            from: "Stary opis.",
            to: "Nowy opis.",
          },
        ]);
      });

      it("reads every field as new while nothing has been approved", async () => {
        addRevision("rev-1");
        const [row] = (await queue()).revisions;
        expect(row!.kind).toBe("create");
        expect(row!.changes.map((c) => c.field).sort()).toEqual([
          "content",
          "name",
        ]);
        expect(row!.changes.every((c) => c.from === null)).toBe(true);
      });

      it("says so, rather than linking, when the target is gone", async () => {
        addRevision("rev-1", { node_id: "node-gone" });
        const [row] = (await queue()).revisions;
        expect(row).toMatchObject({
          targetExists: false,
          targetPath: null,
          published: false,
        });
      });

      it("names a relation after its two ends and links the person's page", async () => {
        addRevision("rev-1", {
          node_id: "edge-1",
          collection: "edges",
          data: {
            source: "node-1",
            target: "node-2",
            type: "employed",
            start_date: "2019-03-01",
          },
        });
        table("edges")["edge-1"] = {
          source: "node-1",
          target: "node-2",
          type: "employed",
          start_date: "2018-01-01",
          published: true,
        };
        table("nodes")["node-2"] = { name: "Orlen", type: "place" };
        const [row] = (await queue()).revisions;
        expect(row).toMatchObject({
          targetCollection: "edges",
          targetExists: true,
          targetName: "Anna Nowak → Orlen",
          targetPath: "/osoba/anna-nowak-node-1",
        });
        expect(row!.changes).toEqual([
          {
            field: "start_date",
            label: "data od",
            from: null,
            to: "2019-03-01",
          },
        ]);
      });

      it("shows the first six changes and counts the rest", async () => {
        addRevision("rev-1", {
          data: {
            name: "Anna Kowalska",
            type: "person",
            content: "Nowy opis.",
            birthDate: "1970-01-01",
            wikipedia: "https://pl.wikipedia.org/wiki/Anna",
            rejestrIo: "https://rejestr.io/1",
            ktomaco: "https://ktomaco.pl/1",
            parties: ["PiS"],
          },
        });
        const [row] = (await queue()).revisions;
        expect(row!.changeCount).toBe(7);
        expect(row!.changes).toHaveLength(6);
      });
    });

    describe("whether approving would write over something newer", () => {
      it("marks a proposal the target has moved past", async () => {
        addRevision("rev-1", { update_time: "2026-08-01T09:00:00.000Z" });
        addRevision("rev-2", {
          status: "approved",
          update_time: "2026-08-05T09:00:00.000Z",
        });
        table("nodes")["node-1"]!.revision_id = "rev-2";
        const answer = await queue();
        expect(ids(answer.revisions)).toEqual(["rev-1"]);
        expect(answer.revisions[0]).toMatchObject({
          stale: true,
          status: "pending",
        });
      });

      it("leaves a proposal newer than the approved version alone", async () => {
        addRevision("rev-1", { update_time: "2026-08-05T09:00:00.000Z" });
        addRevision("rev-0", {
          status: "approved",
          update_time: "2026-07-01T09:00:00.000Z",
        });
        table("nodes")["node-1"]!.revision_id = "rev-0";
        expect((await queue()).revisions[0]!.stale).toBe(false);
      });

      it("calls the revision a node serves approved, never stale against itself", async () => {
        addRevision("rev-1", { update_time: "2026-08-05T09:00:00.000Z" });
        table("nodes")["node-1"]!.revision_id = "nodes/node-1/revisions/rev-1";
        const [row] = (await queue({ status: "all" })).revisions;
        expect(row).toMatchObject({
          stale: false,
          status: "approved",
          statusDerived: true,
        });
      });

      it("calls an approved version the target left behind superseded", async () => {
        addRevision("rev-1", {
          status: "approved",
          update_time: "2026-08-01T09:00:00.000Z",
        });
        table("nodes")["node-1"]!.revision_id = "rev-2";
        const [row] = (await queue({ status: "approved" })).revisions;
        expect(row).toMatchObject({
          status: "superseded",
          statusDerived: true,
        });
      });
    });

    describe("who filed it", () => {
      it("resolves the author for the reviewer", async () => {
        addRevision("rev-1");
        accounts.set("volunteer-uid", {
          uid: "volunteer-uid",
          displayName: "Anna Nowak",
          email: "anna@example.com",
          photoURL: null,
        });
        const [row] = (await queue()).revisions;
        expect(row!.updateUser).toBe("volunteer-uid");
        expect(row!.author).toEqual({
          displayName: "Anna Nowak",
          email: "anna@example.com",
          photoURL: null,
        });
      });

      it("keeps the row when the uid no longer resolves", async () => {
        addRevision("rev-1");
        const answer = await queue();
        expect(ids(answer.revisions)).toEqual(["rev-1"]);
        expect(answer.revisions[0]!.author).toBeNull();
      });
    });

    describe("what a proposal is about", () => {
      function addRelation(
        id: string,
        ends: { source: string; target: string; type?: string },
        overrides: Data = {},
      ) {
        addRevision(id, {
          node_id: `edge-${id}`,
          collection: "edges",
          data: { type: ends.type ?? "employed", ...ends },
          ...overrides,
        });
        table("edges")[`edge-${id}`] = { ...ends, published: false };
      }
      beforeEach(() => {
        table("nodes")["person-1"] = {
          name: "Anna Nowak",
          type: "person",
          published: true,
        };
        table("nodes")["place-1"] = {
          name: "Wodociągi",
          type: "place",
          published: true,
        };
        table("nodes")["article-1"] = {
          name: "Artykuł o radzie",
          type: "article",
          published: true,
        };
        table("nodes")["region-1"] = {
          name: "Gmina Przykładowo",
          type: "region",
          published: false,
        };
      });

      it("is the entry itself for a node revision", async () => {
        addRevision("rev-1");
        const [row] = (await queue()).revisions;
        expect(row!.subject).toEqual({
          id: "node-1",
          name: "Anna Nowak",
          type: "person",
          path: "/osoba/anna-nowak-node-1",
          published: true,
        });
      });

      it("is the person at either end of a relation", async () => {
        addRelation("employed", { source: "person-1", target: "place-1" });
        addRelation(
          "mention",
          { source: "article-1", target: "person-1", type: "mentions" },
          { update_time: "2026-08-09T09:00:00.000Z" },
        );
        const answer = await queue();
        expect(answer.revisions.map((r) => r.subject.id)).toEqual([
          "person-1",
          "person-1",
        ]);
        expect(answer.revisions[0]!.subject).toMatchObject({
          name: "Anna Nowak",
          type: "person",
          published: true,
        });
      });

      it("is the source of a relation between two entries that are not people", async () => {
        addRelation("seat", {
          source: "region-1",
          target: "place-1",
          type: "seat",
        });
        const [row] = (await queue()).revisions;
        expect(row!.subject).toMatchObject({
          id: "region-1",
          published: false,
        });
      });

      it("is the relation itself, never live, when neither end can be read", async () => {
        addRelation("orphan", { source: "gone-1", target: "gone-2" });
        const [row] = (await queue()).revisions;
        expect(row!.subject).toMatchObject({
          id: "edge-orphan",
          type: null,
          published: false,
        });
      });
    });

    describe("by the entry a proposal is about", () => {
      beforeEach(() => {
        table("nodes").live = {
          name: "Barbara Opublikowana",
          type: "person",
          published: true,
        };
        table("nodes").draft = {
          name: "Cezary Szkicowy",
          type: "person",
          published: false,
        };
        table("nodes")["place-1"] = { name: "Wodociągi", type: "place" };
        addRevision("live-old", {
          node_id: "live",
          update_time: "2026-08-01T09:00:00.000Z",
        });
        addRevision("draft-new", {
          node_id: "draft",
          update_time: "2026-08-05T09:00:00.000Z",
        });
        addRevision("live-relation", {
          node_id: "edge-1",
          collection: "edges",
          data: { type: "employed", source: "live", target: "place-1" },
          update_time: "2026-08-04T09:00:00.000Z",
        });
        addRevision("draft-old", {
          node_id: "draft",
          update_time: "2026-07-30T09:00:00.000Z",
        });
      });

      it("lists only proposals about a live page, counted, and says the flagless are out", async () => {
        const answer = await queue({ published: "true" });
        expect(ids(answer.revisions)).toEqual(["live-relation", "live-old"]);
        expect(answer.total).toBe(2);
        expect(answer.flagOnly).toBe(true);
        expect(ids((await queue({ published: "false" })).revisions)).toEqual([
          "draft-new",
          "draft-old",
        ]);
      });

      it("groups the proposals by entry, newest entry first, and pages through entries", async () => {
        const answer = await queue({ group: "subject" });
        expect(answer.revisions).toEqual([]);
        expect(answer.total).toBe(4);
        expect(answer.groupTotal).toBe(2);
        expect(
          answer.groups!.map((g) => [g.subject.id, g.count, ids(g.proposals)]),
        ).toEqual([
          ["draft", 2, ["draft-new", "draft-old"]],
          ["live", 2, ["live-relation", "live-old"]],
        ]);
        expect(answer.groups![1]!.subject).toMatchObject({
          name: "Barbara Opublikowana",
          published: true,
        });

        const second = await queue({ group: "subject", limit: "1", page: "2" });
        expect(second.groups!.map((g) => g.subject.id)).toEqual(["live"]);
        expect(second.groupTotal).toBe(2);

        const live = await queue({ group: "subject", published: "true" });
        expect(live.groups!.map((g) => g.subject.id)).toEqual(["live"]);
        expect(live.total).toBe(2);
      });

      it("shows a decision on the very next read", async () => {
        expect((await queue({ published: "true" })).total).toBe(2);
        table("revisions")["live-old"]!.status = "rejected";
        const answer = await queue({ published: "true" });
        expect(answer.total).toBe(1);
        expect(ids(answer.revisions)).toEqual(["live-relation"]);
      });

      it("filters and groups one author's history the same way", async () => {
        const answer = await queue({
          author: "volunteer-uid",
          group: "subject",
          published: "true",
        });
        expect(answer.groups!.map((g) => g.subject.id)).toEqual(["live"]);
        expect(ids(answer.groups![0]!.proposals)).toEqual([
          "live-relation",
          "live-old",
        ]);
      });

      it("leaves one person, and the revisions naming nobody, out of a grouped queue", async () => {
        addRevision("mine-live", {
          node_id: "live",
          update_user: "admin-uid",
          update_time: "2026-08-06T09:00:00.000Z",
        });
        addRevision("nobodys", {
          node_id: "draft",
          update_user: undefined,
          update_time: "2026-08-07T09:00:00.000Z",
        });
        const others = await queue({
          group: "subject",
          excludeAuthor: "admin-uid",
        });
        expect(others.total).toBe(4);
        expect(others.groups!.map((g) => [g.subject.id, g.count])).toEqual([
          ["draft", 2],
          ["live", 2],
        ]);
        expect((await queue({ group: "subject" })).total).toBe(6);
      });

      it("answers a permalink inside one of the groups as already there", async () => {
        const answer = await queue({ group: "subject", revision: "live-old" });
        expect(answer.pinned).toBeNull();
      });
    });
  });

  describe("GET /api/revisions/mine", () => {
    const mine = (query: Record<string, string> = {}, as = VOLUNTEER) =>
      read<MyProposals>(mineGet, as, query);

    it("reads the uid off the token, whatever the query names, and is never cached", async () => {
      addRevision("rev-mine");
      addRevision("rev-theirs", { update_user: "other-uid" });
      const answer = await mine({
        author: "other-uid",
        update_user: "other-uid",
      });
      expect(ids(answer.revisions)).toEqual(["rev-mine"]);
      expect(answer.headers["header:Cache-Control"]).toBe("private, no-store");
    });

    describe("the summary chips", () => {
      beforeEach(() => {
        addRevision("rev-pending-1", {
          update_time: "2026-08-05T09:00:00.000Z",
        });
        addRevision("rev-pending-2", {
          update_time: "2026-08-04T09:00:00.000Z",
        });
        addRevision("rev-approved", {
          node_id: "node-approved",
          status: "approved",
          update_time: "2026-08-03T09:00:00.000Z",
        });
        addRevision("rev-superseded", {
          node_id: "node-superseded",
          status: "approved",
          update_time: "2026-08-02T09:00:00.000Z",
        });
        addRevision("rev-rejected", {
          status: "rejected",
          reject_reason: "Brak źródła dla tej zmiany.",
          review_time: "2026-08-06T09:00:00.000Z",
          update_time: "2026-08-01T09:00:00.000Z",
        });
        table("nodes")["node-approved"] = {
          name: "Jan Kowalski",
          type: "person",
          published: true,
          revision_id: "rev-approved",
        };
        table("nodes")["node-superseded"] = {
          name: "Maria Wiśniewska",
          type: "person",
          published: true,
          revision_id: "rev-newer",
        };
      });

      it("counts everything scanned, before the filter and the page", async () => {
        const answer = await mine({ status: "pending", limit: "1" });
        expect(answer.counts).toEqual({
          pending: 2,
          approved: 1,
          superseded: 1,
          rejected: 1,
        });
        expect(answer.total).toBe(2);
        expect(ids(answer.revisions)).toEqual(["rev-pending-1"]);
        const second = await mine({ status: "pending", limit: "1", page: "2" });
        expect(second.counts.pending).toBe(2);
        expect(ids(second.revisions)).toEqual(["rev-pending-2"]);
      });

      it("tells a version the entry moved past from a live one, and files both under approved", async () => {
        const all = await mine({ status: "all" });
        const byId = new Map(all.revisions.map((row) => [row.id, row]));
        expect(byId.get("rev-approved")!.status).toBe("approved");
        expect(byId.get("rev-superseded")!.status).toBe("superseded");
        const approved = await mine({ status: "approved" });
        expect(ids(approved.revisions)).toEqual([
          "rev-approved",
          "rev-superseded",
        ]);
        expect(approved.total).toBe(2);
      });

      it("carries the rejection reason and its time on the row", async () => {
        const [row] = (await mine({ status: "rejected" })).revisions;
        expect(row).toMatchObject({
          rejectReason: "Brak źródła dla tej zmiany.",
          reviewTime: "2026-08-06T09:00:00.000Z",
        });
      });
    });

    it("never resolves who filed or reviewed it", async () => {
      addRevision("rev-mine", { review_user: "admin-uid" });
      accounts.set("volunteer-uid", {
        uid: "volunteer-uid",
        displayName: "Anna",
      });
      const [row] = (await mine()).revisions;
      expect(row!.author).toBeNull();
      expect(getUsers).not.toHaveBeenCalled();
    });

    it("says the answer is a lower bound once the scan hits its cap, and not before", async () => {
      addMany(MINE_SCAN_CAP - 1);
      expect((await mine({ limit: "1" })).truncated).toBe(false);
      addRevision("rev-last", { update_time: "2026-12-01T00:00:00.000Z" });
      expect((await mine({ limit: "1" })).truncated).toBe(true);
    });

    it("describes the change against what the entry serves, and where it points", async () => {
      approveOnto("node-1", "rev-approved", {
        name: "Anna Nowak",
        type: "person",
        content: "Stary opis.",
      });
      table("revisions")["rev-approved"]!.update_automatic = true;
      addRevision("rev-mine");
      const row = (await mine()).revisions.find((r) => r.id === "rev-mine")!;
      expect(row.targetPath).toBe("/osoba/anna-nowak-node-1");
      expect(row.targetExists).toBe(true);
      expect(row.changes).toEqual([
        {
          field: "content",
          label: "opis",
          from: "Stary opis.",
          to: "Nowy opis.",
        },
      ]);
    });

    it("keeps a proposal whose entry has since been deleted, named after itself", async () => {
      addRevision("rev-mine", { node_id: "node-gone" });
      const [row] = (await mine()).revisions;
      expect(row).toMatchObject({
        targetExists: false,
        targetPath: null,
        targetName: "Anna Nowak",
      });
    });

    it("narrows to one entry under either spelling, and to nothing for an untouched one", async () => {
      addRevision("rev-old", {
        node_id: undefined,
        nodeId: "node-1",
        update_time: "2026-07-01T09:00:00.000Z",
      });
      addRevision("rev-elsewhere", { node_id: "node-2" });
      table("nodes")["node-2"] = { name: "Inna Firma", type: "place" };
      const here = await mine({ nodeId: "node-1" });
      expect(ids(here.revisions)).toEqual(["rev-old"]);
      expect(here.total).toBe(1);
      expect(here.counts.pending).toBe(1);
      const untouched = await mine({ nodeId: "node-3" });
      expect(untouched.revisions).toEqual([]);
      expect(untouched.total).toBe(0);
    });
  });

  describe("GET /api/revisions/node", () => {
    const history = (query: Record<string, string> = { nodeId: "node-1" }) =>
      read<NodeRevisionHistory>(nodeHistoryGet, ADMIN, query);

    it("is refused with no token or no entry, and never cached", async () => {
      await store.sync(sql);
      expect(
        await statusOf(
          callAs(nodeHistoryGet, undefined, { query: { nodeId: "node-1" } }),
        ),
      ).toBe(401);
      expect(await statusOf(callAs(nodeHistoryGet, ADMIN, { query: {} }))).toBe(
        400,
      );
      expect((await history()).headers["header:Cache-Control"]).toBe(
        "private, no-store",
      );
    });

    it("reads both spellings once each, newest first, the undated last", async () => {
      addRevision("rev-underscore", {
        update_time: "2026-08-03T09:00:00.000Z",
      });
      addRevision("rev-camel", {
        node_id: undefined,
        nodeId: "node-1",
        update_time: "2026-08-02T09:00:00.000Z",
      });
      addRevision("rev-both", {
        nodeId: "node-1",
        update_time: "2026-08-01T09:00:00.000Z",
      });
      addRevision("rev-undated", { update_time: undefined });
      addRevision("rev-elsewhere", { node_id: "node-2" });
      expect(ids((await history()).revisions)).toEqual([
        "rev-underscore",
        "rev-camel",
        "rev-both",
        "rev-undated",
      ]);
    });

    it("names the author and the reviewer to an admin only", async () => {
      accounts.set("volunteer-uid", {
        uid: "volunteer-uid",
        displayName: "Anna Nowak",
        email: "anna@example.com",
        photoURL: null,
      });
      addRevision("rev-1", {
        status: "rejected",
        reject_reason: "Brak źródła.",
        review_user: "admin-uid",
        review_time: "2026-08-11T09:00:00.000Z",
      });
      const [row] = (await history()).revisions;
      expect(row).toMatchObject({
        updateUser: "volunteer-uid",
        author: {
          displayName: "Anna Nowak",
          email: "anna@example.com",
          photoURL: null,
        },
        reviewUser: "admin-uid",
        reviewTime: "2026-08-11T09:00:00.000Z",
        rejectReason: "Brak źródła.",
      });

      getUsers.mockClear();
      const [plain] = (
        await read<NodeRevisionHistory>(nodeHistoryGet, VOLUNTEER, {
          nodeId: "node-1",
        })
      ).revisions;
      expect(getUsers).not.toHaveBeenCalled();
      expect(plain).toMatchObject({
        updateUser: "volunteer-uid",
        author: null,
        reviewUser: null,
      });
    });

    it("lists every changed field, not the queue's first six", async () => {
      addRevision("rev-1", {
        data: {
          name: "Anna Kowalska",
          type: "person",
          content: "Nowy opis.",
          birthDate: "1970-01-01",
          wikipedia: "https://pl.wikipedia.org/wiki/Anna",
          rejestrIo: "https://rejestr.io/1",
          ktomaco: "https://ktomaco.pl/1",
          parties: ["PiS"],
        },
      });
      const [row] = (await history()).revisions;
      expect(row!.changeCount).toBe(7);
      expect(row!.changes).toHaveLength(7);
    });

    it("calls an overtaken approval superseded and the served one approved", async () => {
      addRevision("rev-old", {
        status: "approved",
        update_time: "2026-07-01T09:00:00.000Z",
      });
      addRevision("rev-live", {
        status: "approved",
        update_time: "2026-08-01T09:00:00.000Z",
      });
      addRevision("rev-waiting", { update_time: "2026-09-01T09:00:00.000Z" });
      table("nodes")["node-1"]!.revision_id = "revisions/rev-live";
      const answer = await history();
      expect(
        Object.fromEntries(answer.revisions.map((r) => [r.id, r.status])),
      ).toEqual({
        "rev-waiting": "pending",
        "rev-live": "approved",
        "rev-old": "superseded",
      });
      expect(answer).toMatchObject({
        approvedRevisionId: "rev-live",
        published: true,
        exists: true,
      });
    });

    it("answers an entry never created with its revisions, and one with none with an empty list", async () => {
      addRevision("rev-1", { node_id: "node-gone" });
      const gone = await history({ nodeId: "node-gone" });
      expect(ids(gone.revisions)).toEqual(["rev-1"]);
      expect(gone).toMatchObject({
        exists: false,
        published: false,
        approvedRevisionId: null,
      });
      const empty = await history();
      expect(empty.revisions).toEqual([]);
      expect(empty.exists).toBe(true);
    });
  });

  describe("GET /api/revisions/pendingEdges", () => {
    const storedEdge = {
      source: "person-1",
      target: "teryt1465",
      type: "election",
      start_date: "2024-01-01",
    };
    beforeEach(() => {
      table("nodes")["person-1"] = { name: "Jan Kowalski", type: "person" };
      table("nodes").teryt1465 = { name: "Powiat kaliski", type: "region" };
      table("edges")["edge-1"] = { ...storedEdge };
      table("revisions")["proposal-1"] = {
        node_id: "edge-1",
        collection: "edges",
        data: {
          ...storedEdge,
          committee: "Komitet Wyborczy Wyborców Wspólny Kalisz",
        },
        status: "pending",
        update_time: "2026-08-03T11:00:00.000Z",
        update_user: "test-admin",
        update_automatic: true,
      };
    });
    const pending = () =>
      read<{ revisions: PendingEdgeRevision[]; total: number }>(
        pendingEdgesGet,
        ADMIN,
      );

    it("says what a proposal changes about the edge, not what the edge is", async () => {
      const answer = await pending();
      expect(answer.total).toBe(1);
      const [item] = answer.revisions;
      expect(item!.changes).toEqual([
        {
          field: "committee",
          from: null,
          to: "Komitet Wyborczy Wyborców Wspólny Kalisz",
        },
      ]);
      expect(item).toMatchObject({
        published: false,
        automatic: true,
        source: { name: "Jan Kowalski" },
        target: { name: "Powiat kaliski" },
      });
    });

    it("lists the edges' pending proposals alone, not the nodes'", async () => {
      addRevision("node-proposal", { update_time: "2026-08-04T00:00:00.000Z" });
      const answer = await pending();
      expect(ids(answer.revisions)).toEqual(["proposal-1"]);
      expect(answer.total).toBe(1);
    });

    it("answers an empty page with nothing", async () => {
      table("revisions")["proposal-1"]!.status = "approved";
      expect(await pending()).toMatchObject({ revisions: [], total: 0 });
    });
  });

  describe("GET /api/revisions/relations", () => {
    const PERSON = { name: "Anna Nowak", type: "person", published: true };
    function addEdge(id: string, edge: Data) {
      table("edges")[id] = {
        source: "anna",
        type: "election",
        name: "kandydatura",
        published: true,
        ...edge,
      };
    }
    function addEdgeRevision(id: string, revision: Data) {
      table("revisions")[id] = {
        collection: "edges",
        update_automatic: true,
        update_user: "pipeline-people-import",
        ...revision,
      };
    }
    beforeEach(() => {
      table("nodes").anna = { ...PERSON };
      table("nodes").teryt0261 = {
        name: "Jelenia Góra",
        type: "region",
        published: true,
      };
      table("nodes").teryt02 = {
        name: "dolnośląskie",
        type: "region",
        published: true,
      };
      table("nodes").firma = { name: "KARR", type: "place", published: false };
    });
    const relations = () =>
      read<NodeRelationHistory>(relationsGet, ADMIN, { nodeId: "anna" });

    it("answers a page with no relations with an empty list, never cached", async () => {
      const { headers, ...answer } = await relations();
      expect(answer).toEqual({
        relations: [],
        total: 0,
        drafts: 0,
        withProposals: 0,
        proposals: 0,
        nodePublished: true,
      });
      expect(headers["header:Cache-Control"]).toBe("private, no-store");
    });

    it("finds the relations at both ends, with each one's revisions", async () => {
      addEdge("bare-2018", {
        target: "teryt0261",
        start_date: "2018-01-01",
        revision_id: "revisions/bare-2018-created",
      });
      addEdgeRevision("bare-2018-created", {
        node_id: "bare-2018",
        update_time: "2026-03-26T01:45:46.000Z",
        data: {
          source: "anna",
          target: "teryt0261",
          type: "election",
          name: "kandydatura",
          start_date: "2018-01-01",
        },
      });
      addEdgeRevision("bare-2018-mayor", {
        node_id: "bare-2018",
        status: "pending",
        update_time: "2026-10-16T14:56:58.000Z",
        data: {
          source: "anna",
          target: "teryt0261",
          type: "election",
          name: "kandydatura",
          start_date: "2018-01-01",
          position: "Prezydent",
          committee: "KWW Zadbajmy o Miasto",
        },
      });
      table("nodes").artykul = {
        name: "PKW",
        type: "article",
        published: true,
      };
      table("edges").mention = {
        source: "artykul",
        target: "anna",
        type: "mentions",
        published: true,
      };
      const answer = await relations();
      const bare = answer.relations.find((r) => r.id === "bare-2018")!;
      expect(bare).toMatchObject({
        direction: "outgoing",
        other: { id: "teryt0261", name: "Jelenia Góra", type: "region" },
        state: "proposals",
        waiting: 1,
        approvedRevisionId: "bare-2018-created",
      });
      expect(bare.revisions.map((r) => [r.id, r.status])).toEqual([
        ["bare-2018-mayor", "pending"],
        ["bare-2018-created", "approved"],
      ]);
      expect(bare.revisions[0]!.changes.map((c) => c.field).sort()).toEqual([
        "committee",
        "position",
      ]);
      expect(answer.relations.find((r) => r.id === "mention")).toMatchObject({
        direction: "incoming",
        other: { id: "artykul", name: "PKW" },
        state: "settled",
      });
    });

    it("puts what waits first: proposals, then drafts, then the rest", async () => {
      addEdge("settled", { target: "teryt0261", start_date: "2006-01-01" });
      addEdge("draft", {
        target: "teryt0261",
        start_date: "2024-01-01",
        position: "Rada miasta",
        published: false,
      });
      addEdge("removed", {
        target: "teryt0261",
        start_date: "2002-01-01",
        deleted: true,
        published: false,
      });
      addEdge("proposed", { target: "teryt0261", start_date: "2010-01-01" });
      addEdgeRevision("proposal", {
        node_id: "proposed",
        status: "pending",
        update_time: "2026-10-10T12:09:02.000Z",
        data: {
          source: "anna",
          target: "teryt0261",
          type: "election",
          start_date: "2010-01-01",
          position: "Rada miasta",
        },
      });
      const answer = await relations();
      expect(answer.relations.map((r) => [r.id, r.state])).toEqual([
        ["proposed", "proposals"],
        ["draft", "draft"],
        ["settled", "settled"],
        ["removed", "removed"],
      ]);
      expect(answer).toMatchObject({
        total: 4,
        drafts: 1,
        withProposals: 1,
        proposals: 1,
        nodePublished: true,
      });
    });

    it("says which candidacy was in a by-election", async () => {
      addEdge("by", {
        target: "teryt0261",
        start_date: "2016-01-01",
        by_election: true,
      });
      addEdge("general", { target: "teryt0261", start_date: "2018-01-01" });
      const answer = await relations();
      expect(
        Object.fromEntries(answer.relations.map((r) => [r.id, r.byElection])),
      ).toEqual({ by: true, general: false });
    });

    it("counts only revisions stored as pending as waiting", async () => {
      addEdge("old", { target: "teryt0261", start_date: "2006-01-01" });
      addEdgeRevision("legacy", {
        node_id: "old",
        update_time: "2026-03-26T01:45:46.000Z",
        data: {
          source: "anna",
          target: "teryt0261",
          type: "election",
          start_date: "2006-01-01",
        },
      });
      const [relation] = (await relations()).relations;
      expect(relation!.revisions[0]).toMatchObject({
        status: "pending",
        statusDerived: true,
      });
      expect(relation).toMatchObject({ waiting: 0, state: "settled" });
    });

    it("says a draft cannot go live while either page is a draft", async () => {
      addEdge("job", {
        target: "firma",
        type: "employed",
        name: "Zarząd",
        published: false,
      });
      addEdge("seat", {
        target: "teryt02",
        start_date: "2023-01-01",
        position: "Sejm",
        published: false,
      });
      let answer = await relations();
      expect(
        Object.fromEntries(answer.relations.map((r) => [r.id, r.publishable])),
      ).toEqual({ job: false, seat: true });
      table("nodes").anna = { ...PERSON, published: false };
      answer = await relations();
      expect(answer.nodePublished).toBe(false);
      expect(answer.relations.every((r) => !r.publishable)).toBe(true);
    });

    it(`describes at most ${MAX_RELATIONS}, the drafts first, and says how many there are`, async () => {
      for (let i = 0; i < MAX_RELATIONS + 5; i++) {
        addEdge(`edge-${i}`, {
          target: "teryt0261",
          start_date: `2000-01-${String((i % 28) + 1).padStart(2, "0")}`,
        });
      }
      addEdge("late-draft", {
        target: "teryt0261",
        start_date: "1990-01-01",
        published: false,
      });
      const answer = await relations();
      expect(answer.relations).toHaveLength(MAX_RELATIONS);
      expect(answer.total).toBe(MAX_RELATIONS + 6);
      expect(answer.relations.some((r) => r.id === "late-draft")).toBe(true);
    });
  });
});
