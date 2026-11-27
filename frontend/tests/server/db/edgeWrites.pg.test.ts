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
import publishPost from "~~/server/api/edges/publish.post";
import updatePost from "~~/server/api/edges/update.post";
import referencesPost from "~~/server/api/edges/[id]/references.post";
import pendingGet from "~~/server/api/edges/pending.get";
import unpublishedGet from "~~/server/api/edges/unpublished.get";
import { withoutInternalFields } from "~~/server/utils/revisions";
import { revisionChanges } from "~~/shared/revisionChanges";
import { edgeKey, edgesOfPairsPg } from "~~/server/db/ingestWrites";
import { edgesFromPg } from "~~/server/db/personIngest";
import { edgeMatches, sameEdges } from "~~/server/utils/edges";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** The edge writes case by case, as the Firestore-mock tests of
 * api/edges/* asked them, on Postgres. `edges.pg.test.ts` holds the broad
 * strokes; this file the cases those leave out.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/edgeWrites.pg.test.ts
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
/** Calls into the edge queue reads, to tell a refusal that read nothing. */
const queueReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("~~/server/db/edgeQueues", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~~/server/db/edgeQueues")>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [
      name,
      typeof value === "function"
        ? (...args: unknown[]) => {
            queueReads.count += 1;
            return (value as (...a: unknown[]) => unknown)(...args);
          }
        : value,
    ]),
  );
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

function userOf(event: TestEvent) {
  const header = event.headers.authorization;
  if (!header) throw Object.assign(new Error("401"), { statusCode: 401 });
  const [uid, ...claims] = header.split(",");
  return { uid, ...Object.fromEntries(claims.map((c) => [c, true])) } as {
    uid: string;
    admin?: boolean;
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
const fact = async (id: string) =>
  (await sql<Row[]>`SELECT data FROM extractions WHERE id = ${id}`)[0]!.data;

const ADMIN = "admin-uid,admin";
const READER = "reader-uid";

const post = <T>(
  handler: unknown,
  as: string | undefined,
  body: unknown,
  params?: Record<string, string>,
) => callAs<T>(handler, as, { body, params });

type Created = { id: string; created: boolean; deleted?: boolean };

describe.runIf(PG_TEST_DATABASE_URL)("edge writes on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("edge_writes");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    clear.mockClear();
    Object.assign(table("nodes"), {
      "person-1": { type: "person", name: "Jan Kowalski", published: true },
      "person-9": { type: "person", name: "Ktoś Inny", published: true },
      "place-1": { type: "place", name: "Spółka Wodna", published: true },
      "region-1": { type: "region", name: "Gmina", published: true },
    });
  });

  describe("POST /api/edges/create", () => {
    it("tells two employment spells apart by their start date", async () => {
      await sync();
      const body = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        name: "prezes",
        start_date: "2015-01-01",
      };
      const first = await post<Created>(createPost, READER, body);
      const second = await post<Created>(createPost, READER, {
        ...body,
        start_date: "2022-01-01",
      });
      expect(second.id).not.toBe(first.id);
      expect(second.created).toBe(true);
      expect(await rows("edges")).toHaveLength(2);
    });

    describe("made from an extracted fact", () => {
      const promotion = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        name: "prezes",
        extraction: "fact-1",
      };
      beforeEach(() => {
        table("extractions")["fact-1"] = {
          fact_type: "employment",
          personNodeId: "person-1",
          articleUrl: "https://example.com/a",
        };
      });

      it("tells it too when the relation was already there", async () => {
        await sync();
        const { extraction: _, ...plain } = promotion;
        const first = await post<Created>(createPost, READER, plain);
        expect(await fact("fact-1")).not.toHaveProperty("promotedEdgeIds");
        const second = await post<Created>(createPost, READER, promotion);
        expect(second).toEqual({ id: first.id, created: false });
        expect(await rows("edges")).toHaveLength(1);
        expect((await fact("fact-1")).promotedEdgeIds).toEqual([first.id]);
      });

      it("refuses a fact about somebody else, and writes nothing", async () => {
        table("extractions")["fact-1"]!.personNodeId = "person-9";
        await sync();
        expect(await statusOf(post(createPost, READER, promotion))).toBe(400);
        expect(await rows("edges")).toEqual([]);
        expect(await fact("fact-1")).not.toHaveProperty("promotedEdgeIds");
      });

      it("refuses a relation of another kind than the fact becomes", async () => {
        await sync();
        expect(
          await statusOf(
            post(createPost, READER, {
              ...promotion,
              type: "connection",
              target: "person-9",
            }),
          ),
        ).toBe(400);
        expect(await rows("edges")).toEqual([]);
        expect(await fact("fact-1")).not.toHaveProperty("promotedEdgeIds");
      });

      it("refuses a far end that is not in the graph, or not of the kind asked for", async () => {
        await sync();
        for (const target of ["does-not-exist", "person-9"]) {
          expect(
            await statusOf(post(createPost, READER, { ...promotion, target })),
          ).toBe(400);
        }
        expect(await rows("edges")).toEqual([]);
        expect(await fact("fact-1")).not.toHaveProperty("promotedEdgeIds");
      });

      it("touches no fact when none is named", async () => {
        await sync();
        const before = await fact("fact-1");
        const result = await post<Created>(createPost, READER, {
          ...promotion,
          extraction: undefined,
        });
        expect(result.created).toBe(true);
        expect(await edge(result.id)).toMatchObject({ published: false });
        expect(await fact("fact-1")).toEqual(before);
      });
    });
  });

  describe("POST /api/edges/delete", () => {
    const reason = "Błędnie scalona osoba";
    beforeEach(() => {
      table("edges").e1 = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        published: true,
        stats: { count: 3 },
        revision_id: "revisions/old",
      };
    });
    const remove = (body: unknown = { edge_id: "e1", reason }) =>
      post<{ edge_id: string; deleted: true; revision_id: string | null }>(
        deletePost,
        ADMIN,
        body,
      );

    it("marks the relation deleted and takes it off the site", async () => {
      await sync();
      const result = await remove();
      expect(result).toMatchObject({ edge_id: "e1", deleted: true });
      expect(await edge("e1")).toMatchObject({
        source: "person-1",
        target: "place-1",
        deleted: true,
        delete_reason: reason,
        published: false,
      });
    });

    it("records who removed it and why, as an approved revision", async () => {
      await sync();
      const result = await remove();
      expect(await revisionsOf("e1")).toEqual([
        {
          id: result.revision_id,
          data: expect.objectContaining({
            node_id: "e1",
            collection: "edges",
            status: "approved",
            update_user: "admin-uid",
            review_user: "admin-uid",
            data: expect.objectContaining({
              deleted: true,
              delete_reason: reason,
            }),
          }),
        },
      ]);
      expect((await edge("e1"))!.revision_id).toBe(
        `revisions/${result.revision_id}`,
      );
    });

    it("files the removal in the audit log", async () => {
      await sync();
      await remove();
      expect(await audits()).toEqual([
        expect.objectContaining({
          action: "delete",
          collection: "edges",
          target_id: "e1",
          user: "admin-uid",
          reason,
        }),
      ]);
    });

    it("keeps the counters the document owns", async () => {
      await sync();
      await remove();
      expect(await edge("e1")).toMatchObject({ stats: { count: 3 } });
    });

    it("does not let a stored `deleted: false` undo the removal", async () => {
      table("edges").e1 = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        deleted: false,
      };
      await sync();
      await remove();
      expect(await edge("e1")).toMatchObject({ deleted: true });
    });

    it("takes the relation off every fact that was promoted into it", async () => {
      Object.assign(table("extractions"), {
        f1: { fact_type: "employment", promotedEdgeIds: ["e1", "e2"] },
        f2: { fact_type: "employment", promotedEdgeIds: ["e1"] },
        f3: { fact_type: "employment", promotedEdgeIds: ["e2"] },
      });
      await sync();
      await remove();
      expect((await fact("f1")).promotedEdgeIds).toEqual(["e2"]);
      expect((await fact("f2")).promotedEdgeIds).toEqual([]);
      expect((await fact("f3")).promotedEdgeIds).toEqual(["e2"]);
    });

    it("clears the handler cache so the page stops drawing it", async () => {
      await sync();
      await remove();
      expect(clear).toHaveBeenCalledWith("nitro:handlers");
    });

    it("is idempotent on a relation that is already gone", async () => {
      table("edges").e1 = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        deleted: true,
      };
      await sync();
      expect(await remove()).toEqual({
        edge_id: "e1",
        deleted: true,
        revision_id: null,
      });
      expect(await rows("revisions")).toEqual([]);
      expect(await audits()).toEqual([]);
    });

    it("refuses an id that names no relation", async () => {
      await sync();
      expect(await statusOf(remove({ edge_id: "nope", reason }))).toBe(404);
    });

    it("refuses a removal with no reason", async () => {
      await sync();
      expect(await statusOf(remove({ edge_id: "e1", reason: "  " }))).toBe(400);
      expect((await edge("e1"))!.deleted).toBeUndefined();
    });
  });

  describe("POST /api/edges/publish", () => {
    /** What e1 stores, and so what a revision it holds states. */
    const written = {
      source: "person-1",
      target: "place-1",
      type: "connection",
    };
    const revision = (
      update_time: string,
      fields: Record<string, unknown> = {},
    ) => ({
      node_id: "e1",
      collection: "edges",
      status: "pending",
      update_user: "pipeline",
      update_time,
      data: written,
      ...fields,
    });
    beforeEach(() => {
      table("edges").e1 = { ...written, published: false };
    });
    type Published = {
      published: boolean;
      edge_ids: string[];
      approved: string[];
    };
    const publish = (edge_ids: string[] = ["e1"], published = true) =>
      post<Published>(publishPost, ADMIN, { edge_ids, published });
    const status = async (id: string) =>
      (await sql<Row[]>`SELECT data FROM revisions WHERE id = ${id}`)[0]!.data
        .status;

    it("publishes a relation whose pages are both live", async () => {
      await sync();
      expect(await publish()).toMatchObject({
        published: true,
        edge_ids: ["e1"],
      });
      expect((await edge("e1"))!.published).toBe(true);
    });

    it("approves the newest revision when several are waiting", async () => {
      Object.assign(table("revisions"), {
        old: revision("2025-01-01T00:00:00.000Z"),
        new: revision("2026-06-01T00:00:00.000Z"),
      });
      await sync();
      expect(await publish()).toMatchObject({ approved: ["new"] });
      expect(await status("old")).toBe("pending");
      expect((await edge("e1"))!.revision_id).toBe("revisions/new");
    });

    it("points the relation at its newest revision even when that one is already approved", async () => {
      table("revisions")["rev-1"] = revision("2026-01-01T00:00:00.000Z", {
        status: "approved",
      });
      await sync();
      expect(await publish()).toMatchObject({ approved: ["rev-1"] });
      expect(await edge("e1")).toMatchObject({
        published: true,
        revision_id: "revisions/rev-1",
      });
    });

    it("points it at a revision carrying no status at all", async () => {
      const { status: _, ...legacy } = revision("2026-01-01T00:00:00.000Z");
      table("revisions").legacy = legacy;
      await sync();
      expect(await publish()).toMatchObject({ approved: ["legacy"] });
    });

    it("passes over a rejected revision for the newest one nobody refused", async () => {
      Object.assign(table("revisions"), {
        refused: revision("2026-06-01T00:00:00.000Z", { status: "rejected" }),
        older: revision("2025-01-01T00:00:00.000Z"),
      });
      await sync();
      expect(await publish()).toMatchObject({ approved: ["older"] });
      expect(await status("refused")).toBe("rejected");
    });

    describe("a proposal the relation does not hold", () => {
      const candidacy = {
        source: "person-1",
        target: "region-1",
        type: "election",
        name: "kandydatura",
        position: "Samorząd",
        start_date: "2024-01-01",
      };
      beforeEach(() => {
        table("edges").e1 = { ...candidacy, published: false };
        Object.assign(table("revisions"), {
          written: revision("2026-06-01T00:00:00.000Z", { data: candidacy }),
          proposal_e1_committee: revision("2026-09-01T00:00:00.000Z", {
            update_automatic: true,
            data: { ...candidacy, committee: "KWW Nasza Gmina" },
          }),
        });
      });

      it("stays pending, and the relation goes up as the revision it holds", async () => {
        await sync();
        expect(await publish()).toMatchObject({ approved: ["written"] });
        expect(await edge("e1")).toEqual({
          ...candidacy,
          published: true,
          revision_id: "revisions/written",
        });
        expect(await status("proposal_e1_committee")).toBe("pending");
      });

      it("stays pending when it is the only revision there is", async () => {
        delete table("revisions").written;
        await sync();
        expect(await publish()).toMatchObject({
          published: true,
          approved: [],
        });
        expect(await edge("e1")).toEqual({ ...candidacy, published: true });
        expect(await status("proposal_e1_committee")).toBe("pending");
        expect((await audits()).map((a) => a.action)).toEqual(["publish"]);
      });

      it("stays pending when it would change a field the relation already has", async () => {
        table("revisions").proposal_e1_committee!.data = {
          ...candidacy,
          start_date: "2014-01-01",
        };
        await sync();
        expect(await publish()).toMatchObject({ approved: ["written"] });
        expect(await status("proposal_e1_committee")).toBe("pending");
      });

      it("stays pending when it would take a field away", async () => {
        table("edges").e1 = { ...candidacy, elected: true, published: false };
        table("revisions").written!.data = { ...candidacy, elected: true };
        table("revisions").proposal_e1_committee!.data = candidacy;
        await sync();
        expect(await publish()).toMatchObject({ approved: ["written"] });
        expect(await status("proposal_e1_committee")).toBe("pending");
      });
    });

    it("publishes on the document alone when every revision was rejected", async () => {
      table("revisions").refused = revision("2026-06-01T00:00:00.000Z", {
        status: "rejected",
        data: {},
      });
      await sync();
      expect(await publish()).toMatchObject({ published: true, approved: [] });
      expect(await edge("e1")).toEqual({ ...written, published: true });
    });

    it("leaves a relation that already has an approved revision alone", async () => {
      table("edges").e1 = { ...written, revision_id: "revisions/done" };
      table("revisions")["rev-1"] = revision("2026-01-01T00:00:00.000Z", {
        data: {},
      });
      await sync();
      expect(await publish()).toMatchObject({ approved: [] });
      expect(await edge("e1")).toEqual({
        ...written,
        revision_id: "revisions/done",
        published: true,
      });
      expect(await status("rev-1")).toBe("pending");
    });

    it("publishes a relation that predates the revision machinery", async () => {
      await sync();
      expect(await publish()).toMatchObject({ published: true, approved: [] });
      expect(await edge("e1")).toEqual({ ...written, published: true });
    });

    it("refuses the whole request when one relation's other page is a draft", async () => {
      table("nodes").c = {
        type: "person",
        name: "Jan Szkic",
        published: false,
      };
      table("edges").e2 = {
        source: "person-1",
        target: "c",
        type: "connection",
      };
      await sync();
      expect(await statusOf(publish(["e1", "e2"]))).toBe(400);
      expect((await edge("e1"))!.published).toBe(false);
      expect(await audits()).toEqual([]);
    });

    it("names the page that is holding a relation back", async () => {
      table("nodes").c = {
        type: "person",
        name: "Jan Szkic",
        published: false,
      };
      table("edges").e1 = { ...written, target: "c" };
      await sync();
      await expect(publish()).rejects.toMatchObject({
        message: expect.stringContaining("Jan Szkic"),
      });
    });

    it("refuses a relation pointing at a page that was never created", async () => {
      table("edges").e1 = { ...written, target: "ghost" };
      await sync();
      expect(await statusOf(publish())).toBe(400);
      expect((await edge("e1"))!.published).toBeUndefined();
    });

    it("refuses to publish a relation somebody deleted", async () => {
      table("edges").e1 = { ...written, deleted: true };
      await sync();
      expect(await statusOf(publish())).toBe(400);
      expect((await edge("e1"))!.published).toBeUndefined();
    });

    it("names the ids it could not find", async () => {
      await sync();
      await expect(publish(["e1", "missing"])).rejects.toMatchObject({
        statusCode: 404,
        message: expect.stringContaining("missing"),
      });
      expect((await edge("e1"))!.published).toBe(false);
    });

    it("hides a relation without asking anything about its pages", async () => {
      table("nodes").c = {
        type: "person",
        name: "Jan Szkic",
        published: false,
      };
      table("edges").e1 = {
        source: "c",
        target: "ghost",
        type: "connection",
        published: true,
      };
      await sync();
      expect(await publish(["e1"], false)).toMatchObject({
        published: false,
        approved: [],
      });
      expect((await edge("e1"))!.published).toBe(false);
    });

    it("leaves the proposal alone when hiding", async () => {
      table("edges").e1 = { ...written, published: true };
      table("revisions")["rev-1"] = revision("2026-01-01T00:00:00.000Z", {
        data: {},
      });
      await sync();
      await publish(["e1"], false);
      expect(await status("rev-1")).toBe("pending");
      expect(await edge("e1")).not.toHaveProperty("revision_id");
    });

    it("files the decision against the edges collection", async () => {
      await sync();
      await publish();
      expect(await audits()).toContainEqual(
        expect.objectContaining({
          action: "publish",
          collection: "edges",
          target_id: "e1",
          user: "admin-uid",
        }),
      );
    });

    it("files hiding a relation as its own action", async () => {
      table("edges").e1 = { ...written, published: true };
      await sync();
      await publish(["e1"], false);
      expect(await audits()).toContainEqual(
        expect.objectContaining({ action: "unpublish", collection: "edges" }),
      );
    });

    it("files the approval it made on the way, alongside the publication", async () => {
      table("revisions")["rev-1"] = revision("2026-01-01T00:00:00.000Z");
      await sync();
      await publish();
      const actions = (await audits()).map((a) => a.action);
      expect(actions).toContain("approve");
      expect(actions).toContain("publish");
    });

    it("asks about each relation once, however many times it was listed", async () => {
      await sync();
      expect(await publish(["e1", "e1", "e1"])).toMatchObject({
        edge_ids: ["e1"],
      });
      expect(
        (await audits()).filter((a) => a.action === "publish"),
      ).toHaveLength(1);
    });

    it("is refused to everyone but an admin", async () => {
      await sync();
      expect(
        await statusOf(
          post(publishPost, READER, { edge_ids: ["e1"], published: true }),
        ),
      ).toBe(403);
      expect((await edge("e1"))!.published).toBe(false);
    });
  });

  describe("POST /api/edges/<id>/references", () => {
    beforeEach(() => {
      Object.assign(table("nodes"), {
        "article-1": { type: "article", name: "Pierwszy", published: true },
        "article-2": { type: "article", name: "Drugi", published: true },
        "article-3": { type: "article", name: "Trzeci", published: true },
      });
      table("edges")["edge-1"] = {
        source: "person-1",
        target: "place-1",
        type: "employed",
        name: "prezes",
        references: ["article-1"],
        published: true,
        stats: { votes: { interesting: 3 } },
      };
    });
    const change = (body: unknown) =>
      post<{ id: string; references: string[] }>(referencesPost, READER, body, {
        id: "edge-1",
      });

    it("keeps a claim's existing sources when adding another", async () => {
      await sync();
      const result = await change({ add: ["article-2"] });
      expect(result.references.sort()).toEqual(["article-1", "article-2"]);
      expect((await edge("edge-1"))!.references).toEqual([
        "article-1",
        "article-2",
      ]);
    });

    it("merges against what is stored, not against what the caller last saw", async () => {
      table("edges")["edge-1"]!.references = ["article-1", "article-3"];
      await sync();
      const result = await change({ add: ["article-2"] });
      expect(result.references.sort()).toEqual([
        "article-1",
        "article-2",
        "article-3",
      ]);
    });

    it("detaches only the source named", async () => {
      table("edges")["edge-1"]!.references = ["article-1", "article-2"];
      await sync();
      expect((await change({ remove: ["article-1"] })).references).toEqual([
        "article-2",
      ]);
    });

    it("is safe to replay", async () => {
      await sync();
      await change({ add: ["article-2"] });
      const second = await change({ add: ["article-2"] });
      expect(second.references.sort()).toEqual(["article-1", "article-2"]);
    });

    it("leaves the relation published and its counters intact", async () => {
      await sync();
      await change({ add: ["article-2"] });
      expect(await edge("edge-1")).toMatchObject({
        published: true,
        stats: { votes: { interesting: 3 } },
      });
    });

    it("refuses a source that is not an article", async () => {
      await sync();
      expect(await statusOf(change({ add: ["person-1"] }))).toBe(422);
      expect((await edge("edge-1"))!.references).toEqual(["article-1"]);
      expect(await rows("revisions")).toEqual([]);
    });

    it("refuses a relation that is not there", async () => {
      delete table("edges")["edge-1"];
      await sync();
      expect(await statusOf(change({ add: ["article-2"] }))).toBe(404);
    });

    it("rejects a request that changes nothing", async () => {
      await sync();
      expect(await statusOf(change({}))).toBe(400);
    });
  });

  describe("GET /api/edges/unpublished", () => {
    const edgeId = (i: number) => `e${String(i).padStart(4, "0")}`;
    beforeEach(() => {
      Object.assign(table("nodes"), {
        live1: { type: "person", name: "Anna Nowak", published: true },
        live2: { type: "place", name: "Orlen", published: true },
        draft: { type: "person", name: "Jan Szkic", published: false },
      });
    });
    /** `count` unpublished edges from live1 to `target`, e0001 onwards. */
    const many = (count: number, target: string) => sql`
      INSERT INTO edges (id, data)
      SELECT 'e' || lpad(i::text, 4, '0'),
        jsonb_build_object('source', 'live1', 'target', ${target}::text,
          'type', 'connection', 'published', false)
      FROM generate_series(1, ${count}::int) AS i`;
    type Page = {
      edges: {
        id: string;
        sourceName: string | null;
        targetName: string | null;
      }[];
      nextCursor: string | null;
      scanned: number;
      truncated: boolean;
    };
    const list = (query: Record<string, string | number> = {}) =>
      callAs<Page>(unpublishedGet, ADMIN, {
        query: Object.fromEntries(
          Object.entries(query).map(([k, v]) => [k, String(v)]),
        ),
      });

    it("lists a relation whose pages are both live", async () => {
      table("edges")[edgeId(1)] = {
        source: "live1",
        target: "live2",
        type: "connection",
        published: false,
      };
      await sync();
      const result = await list();
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toMatchObject({
        id: edgeId(1),
        sourceName: "Anna Nowak",
        targetName: "Orlen",
      });
    });

    it("leaves out a relation still waiting on a draft page", async () => {
      table("edges")[edgeId(1)] = {
        source: "live1",
        target: "draft",
        type: "connection",
        published: false,
      };
      await sync();
      expect((await list()).edges).toEqual([]);
    });

    it("leaves out a relation pointing at a page that was never created", async () => {
      table("edges")[edgeId(1)] = {
        source: "live1",
        target: "ghost",
        type: "connection",
        published: false,
      };
      await sync();
      expect((await list()).edges).toEqual([]);
    });

    it("skips deleted relations and ones missing an end", async () => {
      Object.assign(table("edges"), {
        [edgeId(1)]: {
          source: "live1",
          target: "live2",
          type: "connection",
          published: false,
          deleted: true,
        },
        [edgeId(2)]: { source: "live1", type: "connection", published: false },
        [edgeId(3)]: { target: "live2", type: "connection", published: false },
      });
      await sync();
      expect((await list()).edges).toEqual([]);
    });

    it("keeps scanning until the page is full, rather than stopping at the first batch", async () => {
      await sync();
      await many(400, "draft");
      await sql`UPDATE edges SET data = data || '{"target": "live2"}'
        WHERE id = ${edgeId(350)}`;
      const result = await list({ limit: 1 });
      expect(result.edges.map((e) => e.id)).toEqual([edgeId(350)]);
      // More than one batch of 300 was read.
      expect(result.scanned).toBeGreaterThan(300);
    });

    it("counts what it read, not what it returned", async () => {
      await sync();
      await many(11, "draft");
      await sql`UPDATE edges SET data = data || '{"target": "live2"}'
        WHERE id = ${edgeId(11)}`;
      const result = await list();
      expect(result.edges).toHaveLength(1);
      expect(result.scanned).toBe(11);
    });

    it("says there is nothing more once the collection runs out", async () => {
      await sync();
      await many(1, "live2");
      const result = await list();
      expect(result.nextCursor).toBeNull();
      expect(result.truncated).toBe(false);
    });

    it("resumes from the last relation it looked at, not the last it read", async () => {
      await sync();
      await many(400, "live2");
      const result = await list({ limit: 2 });
      expect(result.edges.map((e) => e.id)).toEqual([edgeId(1), edgeId(2)]);
      expect(result.nextCursor).toBe(edgeId(2));
    });

    it("returns every eligible relation across two pages, losing none", async () => {
      await sync();
      await many(5, "live2");
      const first = await list({ limit: 2 });
      const second = await list({ limit: 2, cursor: first.nextCursor! });
      const third = await list({ limit: 2, cursor: second.nextCursor! });
      expect(
        [...first.edges, ...second.edges, ...third.edges].map((e) => e.id),
      ).toEqual([1, 2, 3, 4, 5].map(edgeId));
    });

    it("picks up where the cursor left off", async () => {
      await sync();
      await many(5, "live2");
      const result = await list({ limit: 2, cursor: edgeId(3) });
      expect(result.edges.map((e) => e.id)).toEqual([edgeId(4), edgeId(5)]);
    });

    it("stops on its own budget and says so", async () => {
      await sync();
      await many(4000, "draft");
      const result = await list();
      expect(result.edges).toEqual([]);
      expect(result.scanned).toBe(3000);
      expect(result.truncated).toBe(true);
      expect(result.nextCursor).not.toBeNull();
    });

    it("asks only for relations that are not published", async () => {
      Object.assign(table("edges"), {
        [edgeId(1)]: {
          source: "live1",
          target: "live2",
          type: "connection",
          published: false,
        },
        [edgeId(2)]: {
          source: "live1",
          target: "live2",
          type: "connection",
          published: true,
        },
        // Firestore's `== false` never matched a missing field.
        [edgeId(3)]: { source: "live1", target: "live2", type: "connection" },
      });
      await sync();
      const result = await list();
      expect(result.edges.map((e) => e.id)).toEqual([edgeId(1)]);
      expect(result.scanned).toBe(1);
    });

    it("defaults to a page of 25 and refuses to serve more than 100", async () => {
      await sync();
      await many(200, "live2");
      expect((await list()).edges).toHaveLength(25);
      expect((await list({ limit: 100 })).edges).toHaveLength(100);
      expect(await statusOf(list({ limit: 101 }))).toBe(400);
    });

    it("is refused to everyone but an admin", async () => {
      await sync();
      expect(
        await statusOf(callAs(unpublishedGet, READER, { query: {} })),
      ).toBe(403);
    });
  });

  describe("GET /api/edges/pending", () => {
    const call = async (as: string | undefined) => {
      const event: TestEvent = {
        headers: as ? { authorization: as } : {},
        context: {},
      };
      const status = await statusOf(
        (pendingGet as unknown as (e: TestEvent) => Promise<unknown>)(event),
      );
      return { status, cacheControl: event.context["header:Cache-Control"] };
    };

    it("refuses a logged out caller before reading anything", async () => {
      await sync();
      queueReads.count = 0;
      expect(await call(undefined)).toEqual({
        status: 401,
        cacheControl: undefined,
      });
      expect(queueReads.count).toBe(0);
    });

    it("answers a signed in reader, and lets nothing keep the answer", async () => {
      await sync();
      queueReads.count = 0;
      const answer = await call(READER);
      expect(answer.status).toBe(200);
      expect(answer.cacheControl).toMatch(/no-store/);
      expect(queueReads.count).toBeGreaterThan(0);
    });
  });

  describe("POST /api/edges/update", () => {
    const job = {
      source: "jan",
      target: "orlen",
      type: "employed",
      name: "czlonek rady nadzorczej",
      start_date: "2019-01-01",
      published: true,
      revision_id: "revisions/old",
    };
    beforeEach(() => {
      table("edges").e1 = { ...job };
    });
    type Updated = {
      edge_id: string;
      revision_id: string | null;
      applied: boolean;
      unchanged: boolean;
      duplicate: boolean;
    };
    const update = (as: string, body: unknown) =>
      post<Updated>(updatePost, as, body);

    it("refuses to move either end of the relation", async () => {
      await sync();
      await update(ADMIN, {
        edge_id: "e1",
        name: "prezes zarządu",
        source: "anna",
        target: "pkp",
        type: "election",
      });
      expect(await edge("e1")).toMatchObject({
        name: "prezes zarządu",
        source: "jan",
        target: "orlen",
        type: "employed",
      });
    });

    it("rejects a date that is not a date", async () => {
      await sync();
      expect(
        await statusOf(
          update(READER, { edge_id: "e1", start_date: "styczeń 2019" }),
        ),
      ).toBe(400);
      expect(await rows("revisions")).toEqual([]);
    });

    describe("the outcome of a candidacy", () => {
      const candidacy = {
        source: "jan",
        target: "krakow",
        type: "election",
        name: "kandydatura",
        position: "Senat",
        start_date: "2023-01-01",
        published: true,
        revision_id: "revisions/old",
      };
      beforeEach(() => {
        table("edges").e1 = { ...candidacy };
      });

      it("records a win", async () => {
        await sync();
        await update(ADMIN, { edge_id: "e1", elected: true });
        expect(await edge("e1")).toMatchObject({ elected: true });
      });

      it("shows the reviewer a contributor taking a win back", async () => {
        table("edges").e1 = { ...candidacy, elected: true };
        await sync();
        await update(READER, { edge_id: "e1", elected: false });
        const [revision] = await revisionsOf("e1");
        const proposed = revision!.data.data as Record<string, unknown>;
        expect(proposed).not.toHaveProperty("elected");
        const stored = await edge("e1");
        expect(stored!.elected).toBe(true);
        expect(
          revisionChanges(proposed, withoutInternalFields(stored!)),
        ).toEqual([
          { field: "elected", label: "wybrany", from: "tak", to: null },
        ]);
      });

      it("writes nothing for a box left unticked on a candidacy nobody marked", async () => {
        await sync();
        expect(
          await update(ADMIN, { edge_id: "e1", elected: false }),
        ).toMatchObject({ unchanged: true, revision_id: null });
        expect(await rows("revisions")).toEqual([]);
        expect(await edge("e1")).toEqual(candidacy);
      });
    });

    describe("which election a candidacy was for", () => {
      const local = {
        source: "jan",
        target: "dolnoslaskie",
        type: "election",
        name: "kandydatura",
        position: "Samorząd",
        start_date: "2024-01-01",
        published: true,
        revision_id: "revisions/old",
      };
      beforeEach(() => {
        table("edges").e1 = { ...local };
      });

      it("waits for a reviewer, who is shown it under its own name", async () => {
        await sync();
        await update(READER, { edge_id: "e1", position: "Sejmik" });
        expect(await edge("e1")).toEqual(local);
        const [revision] = await revisionsOf("e1");
        expect(revision!.data.status).toBe("pending");
        expect(
          revisionChanges(
            revision!.data.data as Record<string, unknown>,
            withoutInternalFields(local),
          ),
        ).toEqual([
          {
            field: "position",
            label: "typ wyborów",
            from: "Samorząd",
            to: "Sejmik",
          },
        ]);
      });

      it("is written at once when an admin says it", async () => {
        await sync();
        await update(ADMIN, { edge_id: "e1", position: "Sejmik" });
        expect(await edge("e1")).toMatchObject({
          position: "Sejmik",
          start_date: "2024-01-01",
          published: true,
        });
      });

      it("refuses a kind the site does not have", async () => {
        await sync();
        expect(
          await statusOf(
            update(ADMIN, { edge_id: "e1", position: "Rada osiedla" }),
          ),
        ).toBe(400);
        expect(await edge("e1")).toEqual(local);
      });
    });
  });

  /** `sameEdges` and `edgeMatches` are pure (tests/server/utils/edges.test.ts);
   * what used to be their Firestore query is these two reads. */
  describe("the stored siblings a payload row is matched against", () => {
    const candidacy = {
      source: "person-1",
      target: "region-1",
      type: "election",
      name: "kandydatura",
      start_date: "2024-01-01",
    };
    beforeEach(() => {
      Object.assign(table("edges"), {
        "c-2": { ...candidacy },
        "c-1": { ...candidacy },
        "c-3": { ...candidacy, deleted: true },
        other_type: { ...candidacy, type: "connection" },
        other_target: { ...candidacy, target: "place-1" },
        other_source: { ...candidacy, source: "person-9" },
      });
    });

    it("reads every copy of the pair and type, removed ones too, in id order", async () => {
      await sync();
      const pairs = await edgesOfPairsPg(sql, [candidacy, candidacy]);
      const siblings = pairs.get(edgeKey(candidacy))!;
      expect(siblings.map((s) => s.id)).toEqual(["c-1", "c-2", "c-3"]);
      expect(sameEdges(candidacy, siblings)).toEqual(["c-1", "c-2", "c-3"]);
      // The person ingest reads the person's edges and keeps the pair's.
      const fromPerson = (await edgesFromPg(sql, "person-1")).filter(
        ({ data }) =>
          data.target === candidacy.target && data.type === candidacy.type,
      );
      expect(fromPerson.map((s) => s.id)).toEqual(["c-1", "c-2", "c-3"]);
    });

    it("hands back the stored documents, so two runs enrich the same one", async () => {
      await sync();
      const siblings = (await edgesOfPairsPg(sql, [candidacy])).get(
        edgeKey(candidacy),
      )!;
      const withCommittee = { ...candidacy, committee: "KW Ktoś" };
      const first = edgeMatches(withCommittee, siblings);
      const again = edgeMatches(
        withCommittee,
        (await edgesOfPairsPg(sql, [candidacy])).get(edgeKey(candidacy))!,
      );
      expect(first.enrichable.map((c) => c.id)).toEqual(
        again.enrichable.map((c) => c.id),
      );
      expect(first.enrichable[0]).toMatchObject({
        id: "c-1",
        stored: candidacy,
      });
      expect(first.ids).toEqual(new Set(["c-1", "c-2", "c-3"]));
    });
  });
});
