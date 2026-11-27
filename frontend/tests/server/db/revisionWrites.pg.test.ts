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

/** What a proposal keeps and pins, how an approval answers to a relation's
 * pages and a person's hold, and what the author is told: the cases of
 * /api/revisions/{create,approve,reject} beside editorial.pg.test.ts.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/revisionWrites.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  type Event = { body?: unknown; context: Record<string, unknown> };
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.readBody = async (event: Event) => event.body;
  g.readValidatedBody = async (event: Event, parse: (b: unknown) => unknown) =>
    parse(event.body);
  g.useRuntimeConfig = () => ({ public: { siteUrl: "https://koryta.test" } });
  g.useStorage = () => ({ clear: async () => {} });
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
const mail = async () => rows("mail");

const verifiedAuthor = () =>
  accounts.set("author-1", {
    uid: "author-1",
    email: "a@example.test",
    emailVerified: true,
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

describe.runIf(PG_TEST_DATABASE_URL)("revision writes on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("revw_writes");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    accounts.clear();
    vi.mocked(afterHandPublicationPg).mockClear();
  });

  describe("POST /api/revisions/create", () => {
    const create = async (body: unknown, as: string = READER) => {
      await store.sync(sql);
      return callAs<{ id: string; node_id: string; duplicate: boolean }>(
        createPost,
        as,
        { body },
      );
    };
    const proposed = async (body: unknown) =>
      (await stored("revisions", (await create(body)).id))?.data as Record<
        string,
        unknown
      >;
    /** Refused with 400 and `message`, nothing filed. */
    const refused = async (body: unknown, message?: string) => {
      await expect(create(body)).rejects.toMatchObject({
        statusCode: 400,
        ...(message ? { message } : {}),
      });
      expect(await rows("revisions")).toHaveLength(0);
    };

    it("leaves an unanswered ownership question unanswered", async () => {
      table("nodes").min = { type: "place", name: "Ministerstwo" };
      const data = await proposed({
        node_id: "min",
        name: "Ministerstwo",
        content: "Resort odpowiedzialny za kolej.",
      });
      expect(data).not.toHaveProperty("isPublic");
      expect(data).not.toHaveProperty("isPublicSource");
    });

    it("pins a filled category set, and claims none the proposal never mentioned", async () => {
      table("nodes").pkp = {
        type: "place",
        name: "PKP Informatyka",
        categories: [],
      };
      expect(
        await proposed({
          node_id: "pkp",
          name: "PKP Informatyka",
          categories: ["koleje"],
        }),
      ).toMatchObject({
        type: "place",
        categories: ["koleje"],
        categoriesSource: "manual",
      });

      store.clear();
      table("nodes").szpital = {
        type: "place",
        name: "Szpital Powiatowy",
        categories: ["szpitale"],
      };
      const data = await proposed({
        node_id: "szpital",
        name: "Szpital Powiatowy w Wołowie",
      });
      expect(data).toMatchObject({ categories: ["szpitale"] });
      expect(data).not.toHaveProperty("categoriesSource");
    });

    it("keeps the owner the entry carries and never files one under the Treasury", async () => {
      table("nodes").pge = {
        type: "place",
        name: "PGE",
        categories: ["energetyka", "skarb-panstwa"],
        categoriesSource: "manual",
      };
      table("nodes").wodociagi = {
        type: "place",
        name: "Wodociągi Miasta Krakowa",
        categories: ["wodociagi"],
      };
      expect(
        await proposed({
          node_id: "pge",
          name: "PGE",
          categories: ["energetyka", "cieplownictwo"],
        }),
      ).toMatchObject({
        categories: ["energetyka", "cieplownictwo", "skarb-panstwa"],
        categoriesSource: "manual",
      });
      expect(
        await proposed({
          node_id: "wodociagi",
          name: "Wodociągi Miasta Krakowa",
          categories: ["wodociagi", "skarb-panstwa"],
        }),
      ).toMatchObject({
        categories: ["wodociagi"],
        categoriesSource: "manual",
      });
    });

    it("gives a proposed new company no owner", async () => {
      expect(
        await proposed({
          type: "place",
          name: "Nowa Spółka",
          categories: ["skarb-panstwa"],
        }),
      ).toMatchObject({ categories: [] });
    });

    it("turns down a proposal that changes nothing but the owner", async () => {
      table("nodes").pge = {
        type: "place",
        name: "PGE",
        categories: ["energetyka", "skarb-panstwa"],
        categoriesSource: "manual",
      };
      await refused(
        { node_id: "pge", name: "PGE", categories: ["energetyka"] },
        "Ta propozycja niczego nie zmienia - wpis już to zawiera.",
      );
    });

    it("pins a person's parties, an emptied list too, and claims none never mentioned", async () => {
      table("nodes").delewicz = {
        type: "person",
        name: "Edward Delewicz",
        parties: ["SLD", "Nowoczesna"],
      };
      expect(
        await proposed({
          node_id: "delewicz",
          name: "Edward Delewicz",
          parties: ["Nowoczesna"],
        }),
      ).toMatchObject({ parties: ["Nowoczesna"], partiesSource: "manual" });
      expect(
        await proposed({
          node_id: "delewicz",
          name: "Edward Delewicz",
          parties: [],
        }),
      ).toMatchObject({ parties: [], partiesSource: "manual" });
      const untouched = await proposed({
        node_id: "delewicz",
        name: "Edward Delewicz Jr",
      });
      expect(untouched).toMatchObject({ parties: ["SLD", "Nowoczesna"] });
      expect(untouched).not.toHaveProperty("partiesSource");
      // No ingest overwrites a person's name, so it is not pinned.
      expect(untouched).not.toHaveProperty("nameSource");
    });

    it("rejects a category the site does not offer", async () => {
      table("nodes").lawica = { type: "place", name: "Port Lotniczy" };
      await refused(
        { node_id: "lawica", name: "Port Lotniczy", categories: ["lotniska"] },
        "Nieznana kategoria",
      );
    });

    it("does not let a person edit smuggle in a category or an ownership flag", async () => {
      table("nodes").jan = { type: "person", name: "Jan Kowalski" };
      const data = await proposed({
        node_id: "jan",
        name: "Jan Kowalski",
        content: "Poseł.",
        categories: ["koleje"],
        isPublic: true,
      });
      for (const key of [
        "categories",
        "categoriesSource",
        "isPublic",
        "isPublicSource",
      ])
        expect(data).not.toHaveProperty(key);
    });

    it("stores REGON and NIP as bare digits, and refuses a bad check digit", async () => {
      table("nodes").wfos = { type: "place", name: "WFOŚiGW Zielona Góra" };
      expect(
        await proposed({
          node_id: "wfos",
          name: "WFOŚiGW Zielona Góra",
          regonNumber: "123 456 785",
          nipNumber: "PL 526-025-02-74",
        }),
      ).toMatchObject({ regonNumber: "123456785", nipNumber: "5260250274" });
      await sql`TRUNCATE revisions`;
      store.clear();
      table("nodes").wfos = { type: "place", name: "WFOŚiGW Zielona Góra" };
      await refused(
        {
          node_id: "wfos",
          name: "WFOŚiGW Zielona Góra",
          regonNumber: "123456784",
        },
        "Numer REGON jest niepoprawny",
      );
    });

    it("keeps the fields it was not given, an activity list among them", async () => {
      table("nodes").tramwaje = {
        type: "place",
        name: "Tramwaje Śląskie",
        krsNumber: "0000145278",
        activity: ["49.31.Z"],
      };
      expect(
        await proposed({
          node_id: "tramwaje",
          name: "Tramwaje Śląskie",
          krsNumber: "0000145278",
          isPublic: true,
        }),
      ).toMatchObject({ krsNumber: "0000145278", activity: ["49.31.Z"] });
    });

    it("does not pin a company name the proposal passes through unchanged", async () => {
      table("nodes").capital = {
        type: "place",
        name: "CAPITAL PARTNERS (Warszawa)",
        isPublic: false,
      };
      const data = await proposed({
        node_id: "capital",
        name: "CAPITAL PARTNERS (Warszawa)",
        isPublic: true,
      });
      expect(data).toMatchObject({ isPublic: true });
      expect(data).not.toHaveProperty("nameSource");
    });

    it("creates a place with the fields a place has, named by hand", async () => {
      expect(
        await proposed({
          type: "place",
          name: "Lubelskie Koleje sp. z o.o.",
          krsNumber: "0000999888",
          isPublic: true,
        }),
      ).toMatchObject({
        type: "place",
        name: "Lubelskie Koleje sp. z o.o.",
        krsNumber: "0000999888",
        isPublic: true,
        isPublicSource: "manual",
        nameSource: "manual",
      });
    });

    it("creates an article with its address, and insists the address is usable", async () => {
      expect(
        await proposed({
          type: "article",
          name: "Żona byłego sekretarza w radzie nadzorczej",
          sourceURL: "https://wiadomosci.wp.pl/lubelskie-koleje",
          shortName: "WP",
        }),
      ).toMatchObject({
        type: "article",
        sourceURL: "https://wiadomosci.wp.pl/lubelskie-koleje",
        shortName: "WP",
      });
      await sql`TRUNCATE revisions, nodes`;
      store.clear();
      await refused({
        type: "article",
        name: "Artykuł",
        sourceURL: "wiadomosci.wp.pl",
      });
    });

    it("still defaults to a person when no type is given", async () => {
      expect(await proposed({ name: "Sylwia Sobolewska" })).toMatchObject({
        type: "person",
      });
    });

    it("files a removal as the whole entry, pending", async () => {
      table("nodes").jan = { type: "person", name: "Jan Kowalski" };
      const answer = await create({
        node_id: "jan",
        deleted: true,
        delete_reason: "Duplikat",
      });
      expect(await stored("revisions", answer.id)).toMatchObject({
        status: "pending",
        data: {
          type: "person",
          name: "Jan Kowalski",
          deleted: true,
          delete_reason: "Duplikat",
        },
      });
    });

    it("insists a removal's reason says something", async () => {
      table("nodes").jan = { type: "person", name: "Jan Kowalski" };
      await refused({ node_id: "jan", deleted: true, delete_reason: "  " });
    });

    it("still takes a restatement that pins a pipeline's guess", async () => {
      table("nodes").tramwaje = {
        type: "place",
        name: "Tramwaje Śląskie",
        categories: ["koleje"],
      };
      expect(
        await proposed({
          node_id: "tramwaje",
          name: "Tramwaje Śląskie",
          categories: ["koleje"],
        }),
      ).toMatchObject({ categories: ["koleje"], categoriesSource: "manual" });
    });
  });

  describe("POST /api/revisions/approve", () => {
    const approve = async (body: unknown, as: string = ADMIN) => {
      await store.sync(sql);
      return callAs<{ id: string; collection: string; published: boolean }>(
        approvePost,
        as,
        { body },
      );
    };
    const edgeRevision = (
      data: Record<string, unknown>,
      edge: Record<string, unknown> = data,
    ) => {
      table("edges").e1 = { type: "employed", ...edge };
      table("revisions").re = revision(
        "e1",
        { type: "employed", ...data },
        { collection: "edges" },
      );
    };
    const nodes = (a: boolean, b: boolean, c?: boolean) => {
      table("nodes").a = { type: "person", name: "Anna Nowak", published: a };
      table("nodes").b = { type: "place", name: "Bogdan Lis", published: b };
      if (c !== undefined)
        table("nodes").c = { type: "place", name: "Celina Mak", published: c };
    };
    /** Refused with 400 naming `names`, nothing written, nobody told. */
    const refusedNaming = async (body: unknown, names: RegExp) => {
      verifiedAuthor();
      await expect(approve(body)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringMatching(names),
      });
      expect((await stored("revisions", "re"))?.status).toBe("pending");
      expect(await stored("edges", "e1")).not.toHaveProperty("revision_id");
      expect(await audit()).toEqual([]);
      expect(await mail()).toHaveLength(0);
    };

    it("tells the author whether the page went live", async () => {
      verifiedAuthor();
      table("nodes").n = { type: "person", name: "Jan Kowalski" };
      table("revisions").r1 = revision("n", {
        type: "person",
        name: "Jan Kowalski",
        content: "x",
      });
      await approve({ revision_id: "r1" });
      const [draft] = await mail();
      expect(draft!.data).toMatchObject({ kind: "revisionApproved" });
      expect((draft!.data.message as { text: string }).text).toContain(
        "nie jest jeszcze widoczna",
      );

      await sql`TRUNCATE mail`;
      table("revisions").r2 = revision("n", {
        type: "person",
        name: "Jan Kowalski",
        content: "y",
      });
      await approve({ revision_id: "r2", publish: true });
      const [live] = await mail();
      expect(live!.id).toBe("revisionApproved_r2");
      expect((live!.data.message as { text: string }).text).not.toContain(
        "nie jest jeszcze widoczna",
      );
    });

    it("keeps a published page published, and publishes a draft when asked, filing the publication", async () => {
      table("nodes").live = { type: "person", name: "Live", published: true };
      table("nodes").draft = {
        type: "person",
        name: "Draft",
        published: false,
      };
      table("revisions").r1 = revision("live", { type: "person", name: "L" });
      table("revisions").r2 = revision("draft", { type: "person", name: "D" });
      expect((await approve({ revision_id: "r1" })).published).toBe(true);
      expect((await stored("nodes", "live"))?.published).toBe(true);
      expect(
        (await approve({ revision_id: "r2", publish: true })).published,
      ).toBe(true);
      expect((await stored("nodes", "draft"))?.published).toBe(true);
      expect((await audit()).filter((e) => e.action === "publish")).toEqual([
        expect.objectContaining({
          action: "publish",
          collection: "nodes",
          target_id: "draft",
          revision_id: "r2",
          user: "admin-1",
        }),
      ]);
    });

    it("writes a removal as a removal, hidden", async () => {
      table("nodes").n = { type: "person", name: "Stara", published: false };
      table("revisions").r1 = revision("n", {
        type: "person",
        name: "Stara",
        deleted: true,
        delete_reason: "duplikat",
      });
      await approve({ revision_id: "r1", publish: true });
      expect(await stored("nodes", "n")).toMatchObject({
        deleted: true,
        published: false,
      });
    });

    // `nameChunksLower` is not kept in Postgres: the name index is a table.
    it("carries over the counters the triggers maintain", async () => {
      table("nodes").n = {
        type: "person",
        name: "Stara",
        stats: { notesCount: 3 },
        votes: { interesting: { total: 2 } },
        nameChunksLower: ["n", "no"],
      };
      table("revisions").r1 = revision("n", { type: "person", name: "Nowa" });
      await approve({ revision_id: "r1" });
      expect(await stored("nodes", "n")).toMatchObject({
        name: "Nowa",
        stats: { notesCount: 3 },
        votes: { interesting: { total: 2 } },
      });
    });

    it("infers the collection of a revision written before it was recorded", async () => {
      table("edges").e1 = { type: "owns", source: "a", target: "b" };
      const legacy: Record<string, unknown> = revision("e1", {
        source: "a",
        target: "b",
        type: "owns",
      });
      delete legacy.collection;
      table("revisions").old = legacy;
      const answer = await approve({ revision_id: "old" });
      expect(answer).toMatchObject({ id: "e1", collection: "edges" });
      expect((await stored("edges", "e1"))?.revision_id).toBe("revisions/old");
    });

    it("refuses a relation whose target page is a draft, naming it", async () => {
      nodes(true, false);
      edgeRevision({ source: "a", target: "b" });
      await refusedNaming({ revision_id: "re", publish: true }, /Bogdan Lis/);
    });

    it("names both pages when neither is live", async () => {
      nodes(false, false);
      edgeRevision({ source: "a", target: "b" });
      await refusedNaming(
        { revision_id: "re", publish: true },
        /Anna Nowak.*Bogdan Lis/,
      );
    });

    it("refuses to approve a live relation whose page has since been hidden", async () => {
      nodes(true, false);
      edgeRevision(
        { source: "a", target: "b" },
        { source: "a", target: "b", published: true },
      );
      await refusedNaming({ revision_id: "re" }, /Bogdan Lis/);
    });

    it("refuses a revision that moves a live relation onto a hidden page", async () => {
      nodes(true, true, false);
      edgeRevision(
        { source: "a", target: "c" },
        { source: "a", target: "b", published: true },
      );
      await refusedNaming({ revision_id: "re" }, /Celina Mak/);
    });

    it("approves a hidden relation whatever state its pages are in", async () => {
      nodes(false, false);
      edgeRevision({ source: "a", target: "b", type: "owns" });
      const answer = await approve({ revision_id: "re" });
      expect(answer.published).toBe(false);
      expect(await stored("edges", "e1")).toMatchObject({
        type: "owns",
        published: false,
        revision_id: "revisions/re",
      });
    });

    it("lets an admin hide a relation and accept its revision in one step", async () => {
      nodes(false, false);
      edgeRevision(
        { source: "a", target: "b" },
        { source: "a", target: "b", published: true },
      );
      const answer = await approve({ revision_id: "re", publish: false });
      expect(answer.published).toBe(false);
      expect((await stored("edges", "e1"))?.published).toBe(false);
      expect((await audit()).map((e) => e.action).sort()).toEqual([
        "approve",
        "unpublish",
      ]);
    });

    it("looks for no hold when a person is approved without publishing, or the page is a company", async () => {
      table("nodes").p = { type: "person", name: "Jan", published: false };
      table("nodes").firma = { type: "place", name: "Firma", published: false };
      table("revisions").r1 = revision("p", { type: "person", name: "Jan" });
      table("revisions").r2 = revision("firma", {
        type: "place",
        name: "Firma",
      });
      await approve({ revision_id: "r1" });
      expect(
        (await approve({ revision_id: "r2", publish: true })).published,
      ).toBe(true);
      expect(afterHandPublicationPg).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/revisions/reject", () => {
    beforeEach(() => {
      verifiedAuthor();
      table("nodes").n = {
        type: "person",
        name: "Jan Kowalski",
        revision_id: "revisions/served",
      };
      table("revisions").served = revision("n", { name: "Jan Kowalski" });
      table("revisions").r1 = revision("n", {
        type: "person",
        name: "Jan Kowalsky",
      });
    });
    const reject = async (body: unknown) => {
      await store.sync(sql);
      return callAs(rejectPost, ADMIN, { body });
    };

    it("tells the author, with the reason, and dates the verdict", async () => {
      await reject({ revision_id: "r1", reason: "Brak źródła" });
      const [message] = await mail();
      expect(message!.data).toMatchObject({
        to: ["a@example.test"],
        kind: "revisionRejected",
        uid: "author-1",
      });
      expect((message!.data.message as { text: string }).text).toContain(
        "Powód: Brak źródła",
      );
      expect((await stored("revisions", "r1"))?.review_time).toEqual(
        expect.any(String),
      );
    });

    it("tells nobody about a rejection it refused to make", async () => {
      expect(
        await statusOf(reject({ revision_id: "served", reason: "x" })),
      ).toBe(409);
      expect((await stored("revisions", "served"))?.status).toBe("pending");
      expect(await mail()).toHaveLength(0);
    });
  });
});
