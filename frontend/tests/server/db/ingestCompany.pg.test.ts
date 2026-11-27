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
import handler, {
  SKARB_PANSTWA_NODE_ID,
} from "~~/server/api/ingest/company.post";
import { edgeDocumentId } from "~~/server/utils/edges";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** POST /api/ingest/company on Postgres: who may send a company, what a
 * payload changes on the node, and the ownership and seat edges it draws, in
 * one transaction.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/ingestCompany.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
  g.readValidatedBody = async (
    event: { body?: unknown },
    parse: (b: unknown) => unknown,
  ) => parse(event.body);
});
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

type Doc = Record<string, unknown>;
type Answer = {
  id: string;
  code: number;
  region?: string;
  company: string;
  unknownOwners?: number;
  unknownFounders?: number;
};

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

async function ingest(body: Doc, as: string | null = "pipeline,datascience") {
  await store.sync(sql);
  return callAs<Answer>(handler, as ?? undefined, { body });
}

async function node(id: string): Promise<Doc | undefined> {
  const [row] = await sql<
    { data: Doc }[]
  >`SELECT data FROM nodes WHERE id = ${id}`;
  return row?.data;
}

async function edges(): Promise<{ id: string; data: Doc }[]> {
  return sql<
    { id: string; data: Doc }[]
  >`SELECT id, data FROM edges ORDER BY id`;
}

async function revisions(): Promise<Doc[]> {
  const rows = await sql<
    { data: Doc }[]
  >`SELECT data FROM revisions ORDER BY id`;
  return rows.map((row) => row.data);
}

const place = (krs: string, fields: Doc = {}) => ({
  type: "place",
  name: `Spółka ${krs}`,
  krsNumber: krs,
  published: true,
  ...fields,
});

describe.runIf(PG_TEST_DATABASE_URL)("POST /api/ingest/company", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("ingest_company");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
  });

  it("takes a company from the datascience group only, and a whole payload", async () => {
    const body = { krs: "12345", name: "Inna nazwa" };
    expect(await statusOf(ingest(body, null))).toBe(401);
    expect(await statusOf(ingest(body, "reader,admin"))).toBe(403);
    expect(await statusOf(ingest({ name: "Bez KRS" }))).toBe(400);
    // `supervisory_organ` is an enum: a name nothing can filter on is a 400.
    expect(
      await statusOf(ingest({ ...body, supervisory_organ: "RADA SPOŁECZNA" })),
    ).toBe(400);
    expect(await revisions()).toEqual([]);
  });

  it("creates a new company, published under an approved automatic revision", async () => {
    const answer = await ingest({
      krs: "12345",
      name: "Test Company",
      activity: ["86.10.Z"],
      categories: ["szpitale"],
      supervisory_body: "rada-nadzorcza",
      legal_form: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
      wikipedia: "https://pl.wikipedia.org/wiki/Test",
      is_public: true,
    });
    expect(answer).toEqual({ id: answer.id, code: 200, company: "created" });
    const stored = await node(answer.id);
    const [revision] = await revisions();
    expect(stored).toMatchObject({
      name: "Test Company",
      type: "place",
      krsNumber: "12345",
      activity: ["86.10.Z"],
      categories: ["szpitale"],
      supervisoryBody: "rada-nadzorcza",
      legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
      wikipedia: "https://pl.wikipedia.org/wiki/Test",
      isPublic: true,
      published: true,
      stats: { nodeGroupSize: 0, isApproved: true },
    });
    expect(revision).toMatchObject({
      node_id: answer.id,
      collection: "nodes",
      status: "approved",
      update_automatic: true,
      update_user: "pipeline",
      review_user: "pipeline",
    });
    expect(String(stored!.revision_id)).toMatch(/^revisions\//);
  });

  it("keeps an existing company's visibility, counters and what people set", async () => {
    Object.assign(table("nodes"), {
      live: place("1", {
        name: "Stawy Milickie",
        nameSource: "manual",
        isPublic: true,
        isPublicSource: "manual",
        categories: ["koleje"],
        categoriesSource: "manual",
        supervisoryBody: "rada-nadzorcza",
        supervisoryOrgan: "rada_nadzorcza",
        wikipedia: "https://pl.wikipedia.org/wiki/Stawy",
        stats: { nodeGroupSize: 4, isApproved: true },
        revision_id: "revisions/old",
      }),
      pending: place("2", { published: false, name: "OLD NAME (Gdańsk)" }),
    });
    expect(
      await ingest({
        krs: "1",
        name: "STAWY MILICKIE (Ruda Sułowska)",
        is_public: false,
        categories: [],
        activity: ["01.11.Z"],
      }),
    ).toEqual({ id: "live", code: 200, company: "updated" });
    expect(await node("live")).toMatchObject({
      name: "Stawy Milickie",
      isPublic: true,
      // The sectors are the person's; the register facts the payload's.
      categories: ["koleje"],
      categoriesSource: "manual",
      supervisoryBody: "rada-nadzorcza",
      supervisoryOrgan: "rada_nadzorcza",
      wikipedia: "https://pl.wikipedia.org/wiki/Stawy",
      published: true,
      stats: { nodeGroupSize: 4, isApproved: true },
    });

    expect(
      await ingest({ krs: "2", name: "NEW NAME", supervisory_body: "" }),
    ).toMatchObject({ id: "pending", company: "updated" });
    const pending = await node("pending");
    expect(pending).toMatchObject({ name: "NEW NAME", published: false });
    expect(pending).not.toHaveProperty("revision_id");
    const latest = (await revisions()).find((r) => r.node_id === "pending");
    expect(latest).toMatchObject({ status: "pending", update_automatic: true });
  });

  it("keeps a register fact on a company whose sectors a person set", async () => {
    table("nodes").pge = place("59307", {
      categories: ["energetyka"],
      categoriesSource: "manual",
    });
    await ingest({
      krs: "59307",
      name: "PGE",
      categories: ["cieplownictwo", "skarb-panstwa"],
    });
    expect((await node("pge"))?.categories).toEqual([
      "energetyka",
      "skarb-panstwa",
    ]);
  });

  it("draws owners, founders, the Treasury and the seat, once each", async () => {
    Object.assign(table("nodes"), {
      parent: place("P"),
      founder: place("F"),
      [SKARB_PANSTWA_NODE_ID]: { type: "place", name: "Skarb Państwa" },
      teryt2261: { type: "region", name: "Gdańsk", teryt: "2261" },
      gmina: { type: "region", name: "Gmina", teryt: "2205011" },
    });
    const answer = await ingest({
      krs: "C",
      name: "Córka",
      owners: ["P", "P", "missing"],
      owner_teryts: ["2205011", "9999999"],
      owner_skarb_panstwa: true,
      founders: ["F", "gone"],
      founder_skarb_panstwa: true,
      teryt: "226101",
    });
    expect(answer).toEqual({
      id: answer.id,
      code: 200,
      region: "added",
      company: "created",
      unknownOwners: 1,
      unknownFounders: 1,
    });
    const drawn = (await edges()).map(({ id, data }) => ({
      id,
      source: data.source,
      type: data.type,
      founder: data.founder,
      published: data.published,
    }));
    const id = (source: string, type: string) =>
      edgeDocumentId({ source, target: answer.id, type: type as "owns" });
    expect(drawn).toEqual(
      expect.arrayContaining([
        {
          id: id("parent", "owns"),
          source: "parent",
          type: "owns",
          founder: undefined,
          published: true,
        },
        {
          id: id("gmina", "owns"),
          source: "gmina",
          type: "owns",
          founder: undefined,
          published: true,
        },
        {
          id: id(SKARB_PANSTWA_NODE_ID, "owns"),
          source: SKARB_PANSTWA_NODE_ID,
          type: "owns",
          founder: undefined,
          published: true,
        },
        {
          id: id("founder", "owns"),
          source: "founder",
          type: "owns",
          founder: true,
          published: true,
        },
        // The powiat: the seat code has no node of its own.
        {
          id: id("teryt2261", "seat"),
          source: "teryt2261",
          type: "seat",
          founder: undefined,
          published: true,
        },
      ]),
    );
    // The Treasury as founder lands on the owner's edge: one fact per pair.
    expect(drawn).toHaveLength(5);
    // A re-run draws nothing again.
    store.clear();
    const now = await sql<
      { id: string; data: Doc }[]
    >`SELECT id, data FROM nodes`;
    for (const row of now) table("nodes")[row.id] = row.data;
    for (const row of await edges()) table("edges")[row.id] = row.data;
    for (const row of await sql<
      { id: string; data: Doc }[]
    >`SELECT id, data FROM revisions`)
      table("revisions")[row.id] = row.data;
    const again = await ingest({
      krs: "C",
      name: "Córka",
      owners: ["P"],
      owner_teryts: ["2205011"],
      owner_skarb_panstwa: true,
      founders: ["F"],
      teryt: "226101",
    });
    expect(again).toMatchObject({ region: "existing", company: "unchanged" });
    expect(await edges()).toHaveLength(5);
  });

  it("skips the Treasury edge where that node does not exist", async () => {
    const answer = await ingest({
      krs: "C",
      name: "Córka",
      owner_skarb_panstwa: true,
    });
    expect(answer.company).toBe("created");
    expect(await edges()).toEqual([]);
  });

  it("leaves a seat in another region alone, unless it was removed", async () => {
    Object.assign(table("nodes"), {
      company: place("C"),
      tarnow: { type: "region", name: "Tarnów", teryt: "1263" },
      mikolow: { type: "region", name: "Mikołów", teryt: "2408" },
    });
    table("edges").old = {
      source: "tarnow",
      target: "company",
      type: "seat",
      published: true,
    };
    expect(
      await ingest({ krs: "C", name: "Spółka C", teryt: "2408" }),
    ).toMatchObject({
      region: "existing",
    });
    expect(await edges()).toHaveLength(1);

    table("edges").old!.deleted = true;
    expect(
      await ingest({ krs: "C", name: "Spółka C", teryt: "2408" }),
    ).toMatchObject({
      region: "added",
    });
    expect((await edges()).map((e) => e.data.source)).toEqual(
      expect.arrayContaining(["tarnow", "mikolow"]),
    );
  });

  it("reports an unmappable seat, and skips one stored as a pre-split owns edge", async () => {
    Object.assign(table("nodes"), {
      company: place("C"),
      region: { type: "region", name: "R", teryt: "1201" },
    });
    expect(
      await ingest({ krs: "C", name: "Spółka C", teryt: "9999" }),
    ).toMatchObject({
      region: "unknown",
      company: "updated",
    });
    table("edges").legacy = {
      source: "region",
      target: "company",
      type: "owns",
      stray: "field",
    };
    expect(
      await ingest({ krs: "C", name: "Spółka C", teryt: "1201" }),
    ).toMatchObject({
      region: "existing",
    });
    expect((await edges()).map((e) => e.id)).toEqual(["legacy"]);
  });

  describe("what the revision of an existing or new company says", () => {
    /** The company's one revision, and the node as it was written. */
    async function written(id: string) {
      const all = (await revisions()).filter((r) => r.node_id === id);
      expect(all).toHaveLength(1);
      return { revision: all[0]!, stored: await node(id) };
    }
    const existing = (fields: Doc) => {
      table("nodes")["existing-id"] = {
        type: "place",
        krsNumber: "12345",
        ...fields,
      };
    };

    it("should create a new company if it doesn't exist", async () => {
      const answer = await ingest({ krs: "12345", name: "New Company" });
      expect(answer).toEqual({ id: answer.id, code: 200, company: "created" });
      const { revision, stored } = await written(answer.id);
      expect(revision).toMatchObject({
        status: "approved",
        update_automatic: true,
        data: { name: "New Company", type: "place", krsNumber: "12345" },
      });
      expect(Object.keys(revision.data as Doc).sort()).toEqual([
        "krsNumber",
        "name",
        "type",
      ]);
      expect(stored).toMatchObject({ published: true });
    });

    it("should re-approve an already-public existing company", async () => {
      existing({
        name: "Old",
        content: "Old Content",
        revision_id: "revisions/rev-1",
        published: true,
      });
      expect(await ingest({ krs: "12345", name: "Updated Company" })).toEqual({
        id: "existing-id",
        code: 200,
        company: "updated",
      });
      const { revision, stored } = await written("existing-id");
      // Layered over what is stored: `content` survives the write.
      expect(revision).toMatchObject({
        status: "approved",
        data: {
          content: "Old Content",
          name: "Updated Company",
          type: "place",
          krsNumber: "12345",
        },
      });
      expect(stored).toMatchObject({
        content: "Old Content",
        name: "Updated Company",
        published: true,
      });
      expect(stored!.revision_id).not.toBe("revisions/rev-1");
    });

    it("should keep a pending existing company pending", async () => {
      existing({ name: "Old", content: "Old Content" });
      expect(await ingest({ krs: "12345", name: "Updated Company" })).toEqual({
        id: "existing-id",
        code: 200,
        company: "updated",
      });
      const { revision, stored } = await written("existing-id");
      expect(revision).toMatchObject({
        status: "pending",
        data: { content: "Old Content", name: "Updated Company" },
      });
      expect(stored).toMatchObject({ published: false });
      expect(stored).not.toHaveProperty("revision_id");
    });

    it("should keep an approved-but-unpublished company hidden", async () => {
      existing({
        name: "Old",
        revision_id: "revisions/rev-1",
        published: false,
      });
      await ingest({ krs: "12345", name: "Updated Company" });
      const { revision, stored } = await written("existing-id");
      expect(revision).toMatchObject({
        status: "pending",
        data: { name: "Updated Company", type: "place", krsNumber: "12345" },
      });
      expect(stored).toMatchObject({
        published: false,
        revision_id: "revisions/rev-1",
      });
    });

    it("should leave a manually set isPublic alone", async () => {
      existing({ isPublic: true, isPublicSource: "manual", published: true });
      await ingest({ krs: "12345", name: "Public Company", is_public: false });
      const { revision } = await written("existing-id");
      expect(revision.data).toEqual({
        name: "Public Company",
        type: "place",
        krsNumber: "12345",
        isPublic: true,
        isPublicSource: "manual",
      });
    });

    it("leaves a name a person gave the company alone", async () => {
      existing({
        krsNumber: "0000378062",
        name: "Stawy Milickie",
        nameSource: "manual",
        published: true,
      });
      await ingest({
        krs: "0000378062",
        name: "STAWY MILICKIE (Ruda Sułowska)",
        is_public: true,
      });
      const { revision } = await written("existing-id");
      // Everything else the payload says still lands.
      expect(revision.data).toEqual({
        name: "Stawy Milickie",
        nameSource: "manual",
        type: "place",
        krsNumber: "0000378062",
        isPublic: true,
      });
    });

    it("renames a company whose name the pipelines wrote", async () => {
      existing({
        krsNumber: "0000110394",
        name: "CAPITAL PARTNERS (Warszawa)",
        published: true,
      });
      await ingest({
        krs: "0000110394",
        name: "BUMECH DEFENSE PARTNERS (Warszawa)",
      });
      const { revision, stored } = await written("existing-id");
      expect(revision.data).toEqual({
        name: "BUMECH DEFENSE PARTNERS (Warszawa)",
        type: "place",
        krsNumber: "0000110394",
      });
      expect(stored).toMatchObject({ published: true });
    });

    it("stores an empty category set, which is an answer and not a gap", async () => {
      existing({ categories: ["koleje"], published: true });
      await ingest({
        krs: "12345",
        name: "Instytut Badawczy Dróg i Mostów",
        activity: ["72.19.Z", "42.12.Z"],
        categories: [],
      });
      const { revision, stored } = await written("existing-id");
      expect(revision.data).toMatchObject({ categories: [] });
      expect(stored!.categories).toEqual([]);
    });

    it("clears the organ when the payload says the form has none worth naming", async () => {
      existing({ supervisoryBody: "rada-spoleczna", published: true });
      await ingest({ krs: "12345", name: "PKP SKM", supervisory_body: "" });
      const { revision, stored } = await written("existing-id");
      expect(revision.data).not.toHaveProperty("supervisoryBody");
      expect(stored).not.toHaveProperty("supervisoryBody");
    });

    it("leaves the stored categories alone when the payload states none", async () => {
      existing({ categories: ["koleje"], published: true });
      await ingest({ krs: "12345", name: "PKP SKM", activity: ["49.12.Z"] });
      const { revision } = await written("existing-id");
      expect(revision.data).toMatchObject({
        categories: ["koleje"],
        activity: ["49.12.Z"],
      });
    });

    it("should leave manually set categories alone", async () => {
      // An empty answer from a person binds as a full one does.
      existing({ categories: [], categoriesSource: "manual", published: true });
      await ingest({
        krs: "12345",
        name: "Kopalnia Wapienia Czatkowice",
        activity: ["08.11.Z", "49.20.Z"],
        categories: ["koleje"],
      });
      const { revision } = await written("existing-id");
      expect(revision.data).toEqual({
        name: "Kopalnia Wapienia Czatkowice",
        type: "place",
        krsNumber: "12345",
        activity: ["08.11.Z", "49.20.Z"],
        categories: [],
        categoriesSource: "manual",
      });
    });

    it("gives the owner to a company a person filed under no sector", async () => {
      existing({ categories: [], categoriesSource: "manual", published: true });
      await ingest({
        krs: "12345",
        name: "Ośrodek Hodowli Zwierząt Zarodowych",
        categories: ["skarb-panstwa"],
      });
      const { revision } = await written("existing-id");
      expect(revision.data).toMatchObject({
        categories: ["skarb-panstwa"],
        categoriesSource: "manual",
      });
    });

    it("takes the owner off a pinned company the list no longer names", async () => {
      existing({
        categories: ["energetyka", "skarb-panstwa"],
        categoriesSource: "manual",
        published: true,
      });
      await ingest({ krs: "12345", name: "PGE", categories: [] });
      const { revision } = await written("existing-id");
      expect(revision.data).toMatchObject({
        categories: ["energetyka"],
        categoriesSource: "manual",
      });
    });

    it("stores the legal form and the organ the register names", async () => {
      const answer = await ingest({
        krs: "12345",
        name: "SZPITAL POWIATOWY W GRÓJCU",
        legal_form: "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
        supervisory_organ: "rada_spoleczna",
      });
      const { revision } = await written(answer.id);
      expect(revision).toMatchObject({ status: "approved" });
      expect(revision.data).toEqual({
        name: "SZPITAL POWIATOWY W GRÓJCU",
        type: "place",
        krsNumber: "12345",
        legalForm: "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
        supervisoryOrgan: "rada_spoleczna",
      });
    });

    it("leaves a stored supervisory organ alone when the payload says nothing", async () => {
      existing({
        legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
        supervisoryOrgan: "rada_nadzorcza",
        published: true,
      });
      await ingest({ krs: "12345", name: "Szpital sp. z o.o." });
      const { revision } = await written("existing-id");
      expect(revision.data).toEqual({
        name: "Szpital sp. z o.o.",
        type: "place",
        krsNumber: "12345",
        legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
        supervisoryOrgan: "rada_nadzorcza",
      });
    });
  });

  describe("the edges a payload draws, one case each", () => {
    it("should create edge to region if teryt is provided", async () => {
      table("nodes").teryt1061 = { type: "region", name: "R", teryt: "1061" };
      const answer = await ingest({
        krs: "123456",
        name: "Regional Company",
        teryt: "1061",
      });
      expect(answer).toMatchObject({ region: "added", company: "created" });
      const seatId = edgeDocumentId({
        source: "teryt1061",
        target: answer.id,
        type: "seat",
      });
      expect(await edges()).toEqual([
        {
          id: seatId,
          data: expect.objectContaining({
            source: "teryt1061",
            target: answer.id,
            type: "seat",
            published: true,
          }),
        },
      ]);
      const seatRevision = (await revisions()).find(
        (r) => r.node_id === seatId,
      );
      expect(seatRevision).toMatchObject({
        collection: "edges",
        status: "approved",
        update_automatic: true,
        data: { source: "teryt1061", target: answer.id, type: "seat" },
      });
    });

    it("marks the Treasury as founder the same way", async () => {
      table("nodes")[SKARB_PANSTWA_NODE_ID] = {
        type: "place",
        name: "Skarb Państwa",
      };
      const answer = await ingest({
        krs: "0000070275",
        name: "Fundacja CBOS",
        founder_skarb_panstwa: true,
      });
      const drawn = await edges();
      expect(drawn).toHaveLength(1);
      expect(drawn[0]!.data).toMatchObject({
        source: SKARB_PANSTWA_NODE_ID,
        target: answer.id,
        type: "owns",
        founder: true,
      });
    });

    it("skips a founder the site does not have, and says so", async () => {
      const answer = await ingest({
        krs: "0000376820",
        name: "Fundacja Patronus Animalium",
        founders: ["0000125481"],
      });
      expect(answer).toMatchObject({ code: 200, unknownFounders: 1 });
      expect(answer).not.toHaveProperty("unknownOwners");
      expect(await edges()).toEqual([]);
      expect(await revisions()).toHaveLength(1);
    });

    it("draws no Treasury edge when the register names no such owner", async () => {
      table("nodes")[SKARB_PANSTWA_NODE_ID] = {
        type: "place",
        name: "Skarb Państwa",
      };
      await ingest({ krs: "123456", name: "Prywatna Sp. z o.o." });
      expect(await edges()).toEqual([]);
      expect(await revisions()).toHaveLength(1);
    });

    it("skips a seat already stored as a pre-split owns edge", async () => {
      Object.assign(table("nodes"), {
        company: place("123456"),
        teryt1061: { type: "region", name: "R", teryt: "1061" },
      });
      table("edges").legacy = {
        source: "teryt1061",
        target: "company",
        type: "owns",
      };
      expect(
        await ingest({
          krs: "123456",
          name: "Regional Company",
          teryt: "1061",
        }),
      ).toMatchObject({ region: "existing" });
      expect((await edges()).map((e) => e.id)).toEqual(["legacy"]);
    });

    it("skips the edge even when the stored one carries stray fields", async () => {
      Object.assign(table("nodes"), {
        company: place("123456"),
        teryt1061: { type: "region", name: "R", teryt: "1061" },
      });
      // A seat is a state edge: a date on the link does not make a second one.
      table("edges").dated = {
        source: "teryt1061",
        target: "company",
        type: "owns",
        start_date: "2020-01-01",
      };
      expect(
        await ingest({
          krs: "123456",
          name: "Regional Company",
          teryt: "1061",
        }),
      ).toMatchObject({ region: "existing" });
      expect((await edges()).map((e) => e.id)).toEqual(["dated"]);
    });
  });

  describe("a re-run over a company nothing has changed", () => {
    const storedCompany = {
      name: "PKP SKM",
      type: "place",
      krsNumber: "0000076705",
      activity: ["49.12.Z"],
      categories: ["koleje"],
      isPublic: true,
      published: true,
      revision_id: "revisions/rev-1",
      stats: { nodeGroupSize: 4, isApproved: true },
    };
    const payload = {
      krs: "0000076705",
      name: "PKP SKM",
      activity: ["49.12.Z"],
      categories: ["koleje"],
      is_public: true,
    };

    it("writes no revision at all, and writes as soon as one thing is new", async () => {
      table("nodes").skm = storedCompany;
      expect(await ingest(payload)).toEqual({
        id: "skm",
        code: 200,
        company: "unchanged",
      });
      expect(await revisions()).toEqual([]);
      expect(
        await ingest({ ...payload, categories: ["koleje", "szpitale"] }),
      ).toMatchObject({ company: "updated" });
      expect(await revisions()).toHaveLength(1);
    });

    it("still writes one with no counters, or live with no revision to point at", async () => {
      const { stats: _s, ...noStats } = storedCompany;
      table("nodes").skm = noStats;
      expect((await ingest(payload)).company).toBe("updated");
      const { revision_id: _r, ...noPointer } = storedCompany;
      table("nodes").skm = noPointer;
      expect((await ingest(payload)).company).toBe("updated");
    });

    it("writes nothing over a pinned company whose owner the list already gave", async () => {
      table("nodes").skm = {
        ...storedCompany,
        categories: ["koleje", "skarb-panstwa"],
        categoriesSource: "manual",
      };
      expect(
        (await ingest({ ...payload, categories: ["skarb-panstwa"] })).company,
      ).toBe("unchanged");
      expect(await revisions()).toEqual([]);
    });

    it("does not restate a pending company to its reviewer", async () => {
      const { revision_id: _r, ...pending } = storedCompany;
      table("nodes").skm = {
        ...pending,
        published: false,
        stats: { nodeGroupSize: 4, isApproved: false },
      };
      expect((await ingest(payload)).company).toBe("unchanged");
    });
  });
});
