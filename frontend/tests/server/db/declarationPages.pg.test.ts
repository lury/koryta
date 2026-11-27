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
import declarationsGet from "~~/server/api/nodes/[id]/declarations.get";
import cropsGet from "~~/server/api/nodes/[id]/declaration-crops.get";
import linksPost from "~~/server/api/nodes/[id]/declaration-links.post";
import {
  addDeclarationLinkPg,
  draftPersonPg,
  personDeclarationCropsPg,
} from "~~/server/db/declarationPages";
import { pagesWithAPublicPostPg } from "~~/server/db/publicPosts";
import { linkId, LINKS_PER_DAY } from "~~/server/utils/declarationPersonCrops";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** A person page's declarations on Postgres: the public list
 * (/api/nodes/<id>/declarations), a draft's crops and the links readers give
 * for it (declaration-crops, declaration-links), with who may see what.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationPages.pg.test.ts
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
    readValidatedBody: async (
      event: TestEvent,
      parse: (b: unknown) => unknown,
    ) => parse(event.body),
    setResponseHeader: (event: TestEvent, name: string, value: string) => {
      event.context[`header:${name}`] = value;
    },
  };
});
vi.mock("~~/server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => fn,
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

const STRZELIN = "Strzelin (gmina miejsko-wiejska)";
const BORN = "1979-07-15";

describe.runIf(PG_TEST_DATABASE_URL)("declarations on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("declarations");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
  });

  describe("GET /api/nodes/<id>/declarations", () => {
    const DECLARATION = {
      url: "https://bip.strzelin.pl/download/1",
      year: 2023,
      unit: STRZELIN,
      office: "Rada gminy",
    };
    const crop = (fields: Record<string, unknown> = {}) => ({
      status: "agreed",
      agreed: { value: BORN, kind: "date", by: "readers" },
      url: DECLARATION.url,
      declarationYear: DECLARATION.year,
      units: [{ unitName: STRZELIN, office: "Rada gminy" }],
      ...fields,
    });
    const publications = () => table("declarationPublications");
    const extracts = () => table("declarationExtracts");
    const call = async (id: string) => {
      await sync();
      return callAs(declarationsGet, undefined, { params: { id } });
    };

    beforeEach(() => {
      table("nodes").kowalska = {
        type: "person",
        name: "Anna Kowalska",
        published: true,
        birthDate: BORN,
      };
      extracts()["abc-p0"] = crop();
    });

    it("says the site published the page, with the declaration to check", async () => {
      publications().kowalska = {
        status: "published",
        autoPublished: true,
        publishedAt: "2026-10-29T08:15:00.000Z",
        declarations: [DECLARATION],
        // Never on the answer: what the automation did behind the scenes.
        edges: { published: ["e1"], held: [] },
        extractIds: ["abc-p0"],
      };
      expect(await call("kowalska")).toEqual({
        autoPublished: { at: "2026-10-29T08:15:00.000Z" },
        declarations: [DECLARATION],
      });
    });

    it("links the declaration of a page a person published, without the note", async () => {
      publications().kowalska = { status: "confirmed", extractIds: ["abc-p0"] };
      expect(await call("kowalska")).toEqual({
        autoPublished: null,
        declarations: [DECLARATION],
      });
      // An admin's press of „Opublikuj z kolejki” is no automatic one.
      publications().kowalska = {
        status: "published",
        autoPublished: false,
        pressedBy: "admin-uid",
        publishedAt: "2026-10-30T12:00:00.000Z",
        extractIds: ["abc-p0"],
      };
      expect(await call("kowalska")).toEqual({
        autoPublished: null,
        declarations: [DECLARATION],
      });
    });

    it("follows a merge to the page it went into", async () => {
      table("nodes")["kowalska-old"] = {
        type: "person",
        name: "Anna Kowalska",
        merged_into: "kowalska",
      };
      publications().kowalska = { status: "confirmed", extractIds: ["abc-p0"] };
      expect(await call("kowalska-old")).toMatchObject({
        declarations: [DECLARATION],
      });
    });

    it("answers 404, never an empty answer, for a draft or a page with nothing", async () => {
      publications().kowalska = { status: "queued", extractIds: ["abc-p0"] };
      expect(await statusOf(call("kowalska"))).toBe(404);

      table("nodes").kowalska!.published = false;
      publications().kowalska = { status: "published", extractIds: ["abc-p0"] };
      expect(await statusOf(call("kowalska"))).toBe(404);
      expect(await statusOf(call("nobody"))).toBe(404);
    });

    it("drops a declaration whose address is not a web link", async () => {
      extracts()["abc-p0"] = crop({ url: "javascript:alert(1)" });
      publications().kowalska = { status: "confirmed", extractIds: ["abc-p0"] };
      expect(await statusOf(call("kowalska"))).toBe(404);
    });

    it("lists a declaration only while its crop confirms the page's birth date", async () => {
      const LATER = {
        ...DECLARATION,
        url: "https://bip.strzelin.pl/download/2",
        year: 2024,
      };
      publications().kowalska = {
        status: "confirmed",
        extractIds: ["abc-p0", "def-p0", "abc-p0"],
      };
      extracts()["def-p0"] = crop({
        url: LATER.url,
        declarationYear: LATER.year,
        agreed: { value: BORN, kind: "date", by: "machine" },
      });
      // In the record's order, each crop once.
      expect(await call("kowalska")).toMatchObject({
        declarations: [DECLARATION, LATER],
      });

      extracts()["abc-p0"] = crop({ status: "withdrawn", agreed: null });
      expect(await call("kowalska")).toMatchObject({ declarations: [LATER] });

      // An admin's date counts (decision on 2026-11-18), another day does not.
      extracts()["def-p0"] = crop({
        url: LATER.url,
        declarationYear: LATER.year,
        agreed: { value: BORN, kind: "date", by: "admin" },
      });
      expect(await call("kowalska")).toMatchObject({ declarations: [LATER] });
      extracts()["def-p0"] = crop({
        url: LATER.url,
        agreed: { value: "1980-01-02", kind: "date", by: "admin" },
      });
      expect(await statusOf(call("kowalska"))).toBe(404);
    });

    it("says nothing, the automatic publication included, once the page's date is another", async () => {
      publications().kowalska = {
        status: "published",
        autoPublished: true,
        publishedAt: "2026-10-29T08:15:00.000Z",
        extractIds: ["abc-p0"],
      };
      table("nodes").kowalska!.birthDate = "1980-01-02";
      expect(await statusOf(call("kowalska"))).toBe(404);
    });
  });

  describe("a draft's crops", () => {
    /** A crop of Kowalska's declaration, still waiting for readers unless
     * told otherwise. */
    const crop = (fields: Record<string, unknown> = {}) => ({
      status: "open",
      personIds: ["kowalska"],
      url: "https://bip.strzelin.pl/download/1",
      units: [{ unitName: STRZELIN, office: "Rada gminy", teryt: "021502" }],
      answerCount: 0,
      agreed: null,
      failure: null,
      imageSize: {
        date: { width: 942, height: 93 },
        name: { width: 1128, height: 70 },
      },
      ...fields,
    });
    const candidacy = (fields: Record<string, unknown> = {}) => ({
      personIds: ["kowalska"],
      teryt: "021503",
      unitName: STRZELIN,
      level: "gmina",
      office: "Rada gminy",
      year: 2018,
      status: "not_found",
      reason: "not_listed",
      bipUrls: ["https://bip.strzelin.pl/"],
      files: 0,
      ...fields,
    });
    const election = (fields: Record<string, unknown> = {}) => ({
      source: "kowalska",
      target: "teryt0215",
      type: "election",
      position: "Rada gminy",
      start_date: "2018-01-01",
      elected: true,
      ...fields,
    });
    const crops = async (uid = "reader") => {
      await sync();
      return personDeclarationCropsPg("kowalska", uid);
    };
    /** A paid public post on Kowalska's page. */
    const paidPost = () => {
      table("nodes").spolka = {
        type: "place",
        name: "Wodociągi",
        isPublic: true,
      };
      table("edges").job = {
        source: "kowalska",
        target: "spolka",
        type: "employed",
        name: "Prezes zarządu",
      };
    };

    beforeEach(() => {
      table("nodes").kowalska = { type: "person", name: "Anna Kowalska" };
      table("nodes").teryt0215 = { type: "region", name: "powiat strzeliński" };
    });

    it("lists the page's crops by its own id", async () => {
      Object.assign(table("declarationExtracts"), {
        "a-p0": crop({ answerCount: 1 }),
        // Somebody else's: never listed.
        "b-p0": crop({ personIds: ["nowak"] }),
      });
      expect(await crops()).toEqual({
        publication: null,
        crops: [
          {
            id: "a-p0",
            status: "open",
            failure: null,
            unit: STRZELIN,
            office: "Rada gminy",
            documentUrl: "https://bip.strzelin.pl/download/1",
            answers: 1,
            agreed: null,
            agreedBy: null,
            outcome: null,
            imageSize: {
              date: { width: 942, height: 93 },
              name: { width: 1128, height: 70 },
            },
          },
        ],
        searches: [],
        links: [],
      });
    });

    it("orders the crops by what they say, nothing cut last, and leaves out those taken back", async () => {
      Object.assign(table("declarationExtracts"), {
        "open-p0": crop(),
        "busier-p0": crop({ answerCount: 1 }),
        "failed-p0": crop({
          status: "failed",
          failure: "no_label",
          imageSize: undefined,
        }),
        "withdrawn-p0": crop({ status: "withdrawn" }),
        "other-p0": crop({
          status: "agreed",
          agreed: { value: "1978-02-01", kind: "date", by: "readers" },
          pageOutcomes: { kowalska: "different" },
        }),
        "matched-p0": crop({
          status: "agreed",
          agreed: { value: BORN, kind: "date", by: "machine" },
          pageOutcomes: { kowalska: "queued", nowak: "different" },
        }),
      });
      table("declarationCandidacies").c2018 = candidacy();
      const answer = await crops();
      expect(answer.crops.map((c) => c.id)).toEqual([
        "matched-p0",
        "other-p0",
        "busier-p0",
        "open-p0",
        "failed-p0",
      ]);
      expect(answer.crops[0]).toMatchObject({
        agreed: BORN,
        agreedBy: "machine",
        outcome: "queued",
      });
      expect(answer.crops[4]).toMatchObject({
        failure: "no_label",
        imageSize: null,
      });
      // A page with a crop lists no elections.
      expect(answer.searches).toEqual([]);
    });

    it("never takes an unknown code for one of the site's", async () => {
      table("declarationExtracts")["read-p0"] = crop({
        status: "agreed",
        imageSize: undefined,
        agreed: { value: BORN, kind: "date", by: "someone" },
        pageOutcomes: { kowalska: "maybe" },
      });
      expect((await crops()).crops[0]).toMatchObject({
        imageSize: null,
        agreedBy: null,
        outcome: null,
      });
    });

    it("gives a held page's record with whether a paid post is on the page now", async () => {
      table("declarationExtracts")["a-p0"] = crop();
      table("declarationPublications").kowalska = {
        status: "held",
        reason: "no_public_post",
      };
      expect((await crops()).publication).toEqual({
        status: "held",
        reason: "no_public_post",
        paidPost: false,
      });
      paidPost();
      expect((await crops()).publication).toEqual({
        status: "held",
        reason: "no_public_post",
        paidPost: true,
      });
    });

    it("tells a declined page from a held one, and says no post of a queued one", async () => {
      table("declarationExtracts")["a-p0"] = crop();
      paidPost();
      table("declarationPublications").kowalska = {
        status: "held",
        reason: "two_places",
        declinedAt: "2026-11-01T00:00:00.000Z",
      };
      expect((await crops()).publication).toEqual({
        status: "declined",
        reason: "two_places",
        paidPost: false,
      });
      table("declarationPublications").kowalska = {
        status: "queued",
        reason: null,
      };
      expect((await crops()).publication).toEqual({
        status: "queued",
        reason: null,
        paidPost: false,
      });
      for (const status of ["published", "confirmed"]) {
        table("declarationPublications").kowalska = { status, reason: null };
        expect((await crops()).publication).toBeNull();
      }
    });

    it("lists each election won since 2014 with what the crawler found, newest first", async () => {
      Object.assign(table("declarationCandidacies"), {
        c2018: candidacy(),
        c2024: candidacy({
          year: 2024,
          status: "unconfirmed",
          reason: "unnamed",
          files: 3,
          bipUrls: [],
        }),
        other: candidacy({ personIds: ["nowak"], year: 2024, office: "Wójt" }),
      });
      Object.assign(table("edges"), {
        e2018: election(),
        e2024: election({ start_date: "2024-01-01" }),
      });
      const answer = await crops();
      expect(answer.crops).toEqual([]);
      expect(answer.searches).toEqual([
        {
          year: 2024,
          office: "Rada gminy",
          unit: STRZELIN,
          status: "unconfirmed",
          reason: "unnamed",
          files: 3,
          bipUrl: null,
        },
        {
          year: 2018,
          office: "Rada gminy",
          unit: STRZELIN,
          status: "not_found",
          reason: "not_listed",
          files: 0,
          bipUrl: "https://bip.strzelin.pl/",
        },
      ]);
    });

    it("names a win the crawler never looked for after the region the page files it under", async () => {
      table("declarationCandidacies").c2018 = candidacy();
      Object.assign(table("edges"), {
        e2018: election(),
        wojt: election({ position: "Wójt", start_date: "2024-01-01" }),
      });
      expect((await crops()).searches).toEqual([
        {
          year: 2024,
          office: "Wójt",
          unit: "powiat strzeliński",
          status: null,
          reason: null,
          files: 0,
          bipUrl: null,
        },
        expect.objectContaining({ year: 2018, status: "not_found" }),
      ]);
    });

    it("leaves out what has no BIP declaration to find: lost, older, parliamentary, deleted", async () => {
      Object.assign(table("edges"), {
        lost: election({ elected: false }),
        old: election({ start_date: "2010-01-01" }),
        sejm: election({ position: "Sejm", target: "teryt02" }),
        gone: election({ deleted: true }),
      });
      table("declarationCandidacies").old = candidacy({ year: 2010 });
      expect((await crops()).searches).toEqual([]);
    });

    it("keeps a sejmik win apart from a council one, matched by the województwo's digits", async () => {
      table("declarationCandidacies").sejmik = candidacy({
        office: "Sejmik",
        teryt: "020000",
        unitName: "województwo dolnośląskie",
        year: 2024,
      });
      Object.assign(table("edges"), {
        sejmik: election({
          position: "Sejmik",
          target: "teryt02",
          start_date: "2024-01-01",
        }),
        rada: election({ start_date: "2024-01-01" }),
      });
      const { searches } = await crops();
      expect(searches.map((s) => [s.office, s.unit, s.status])).toEqual([
        ["Sejmik", "województwo dolnośląskie", "not_found"],
        ["Rada gminy", "powiat strzeliński", null],
      ]);
    });

    it("lists the page's links with no crop, the oldest first, marking the reader's own", async () => {
      const URL = "https://bip.strzelin.pl/rada/oswiadczenia/kowalska.pdf";
      Object.assign(table("declarationLinks"), {
        [linkId("kowalska", URL)]: {
          personId: "kowalska",
          url: URL,
          uid: "reader",
          createdAt: "2026-11-20T10:00:00.000Z",
        },
        older: {
          personId: "kowalska",
          url: "https://bip.strzelin.pl/rada",
          uid: "someone",
          createdAt: "2026-11-19T10:00:00.000Z",
        },
        nowak: { personId: "nowak", url: URL, uid: "reader" },
      });
      expect((await crops()).links).toEqual([
        {
          url: "https://bip.strzelin.pl/rada",
          at: "2026-11-19T10:00:00.000Z",
          mine: false,
        },
        { url: URL, at: "2026-11-20T10:00:00.000Z", mine: true },
      ]);
      // A page with a crop lists none.
      table("declarationExtracts")["a-p0"] = crop();
      expect((await crops()).links).toEqual([]);
    });
  });

  describe("who may read and write a draft's declarations", () => {
    const URL = "https://bip.strzelin.pl/rada/oswiadczenia/kowalska.pdf";
    beforeEach(() => {
      Object.assign(table("nodes"), {
        kowalska: { type: "person", name: "Anna Kowalska", published: false },
        "kowalska-old": { type: "person", merged_into: "kowalska" },
        nowak: { type: "person", name: "Jan Nowak", published: true },
        strzelin: { type: "place", name: "Strzelin" },
      });
    });

    it("answers any signed-in reader of a draft, never to be cached, and nobody else", async () => {
      await sync();
      const event = { params: { id: "kowalska" }, context: {} };
      expect(await callAs(cropsGet, "reader", event)).toMatchObject({
        crops: [],
      });
      expect(event.context).toMatchObject({
        "header:Cache-Control": "private, no-store",
      });
      expect(
        await statusOf(
          callAs(cropsGet, undefined, { params: { id: "kowalska" } }),
        ),
      ).toBe(401);
      expect(await statusOf(callAs(cropsGet, "reader", {}))).toBe(400);
    });

    it("follows a merge to the draft, and is a 404 for a public page, one gone, one no person's", async () => {
      await sync();
      expect(await draftPersonPg("kowalska-old")).toBe("kowalska");
      for (const id of ["nowak", "nobody", "strzelin"]) {
        expect(await statusOf(draftPersonPg(id))).toBe(404);
        expect(
          await statusOf(callAs(cropsGet, "reader", { params: { id } })),
        ).toBe(404);
      }
    });

    it("stores a signed-in reader's link to a draft and answers with the block", async () => {
      await sync();
      const answer = await callAs<{ links: unknown[] }>(linksPost, "reader", {
        params: { id: "kowalska-old" },
        body: { url: `  ${URL}  ` },
      });
      expect(answer.links).toEqual([
        { url: URL, at: expect.any(String), mine: true },
      ]);
      const [row] = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM declaration_links WHERE id = ${linkId("kowalska", URL)}`;
      expect(row?.data).toMatchObject({
        personId: "kowalska",
        url: URL,
        host: "bip.strzelin.pl",
        uid: "reader",
        status: "new",
      });
    });

    it("stores nothing for somebody not signed in, a bad address, or a page that is no draft", async () => {
      await sync();
      const post = (as: string | undefined, id: string, url: string) =>
        statusOf(callAs(linksPost, as, { params: { id }, body: { url } }));
      expect(await post(undefined, "kowalska", URL)).toBe(401);
      expect(await post("reader", "kowalska", "javascript:alert(1)")).toBe(400);
      expect(await post("reader", "nowak", URL)).toBe(404);
      const [{ n }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM declaration_links`;
      expect(n).toBe(0);
    });

    it("stores a link once a page and address, whoever gives it again", async () => {
      await sync();
      const now = new Date("2026-11-20T10:00:00Z");
      const add = (uid: string) =>
        addDeclarationLinkPg({ personId: "kowalska", url: URL, uid, now });
      expect(await add("reader")).toBe("added");
      expect(await add("other")).toBe("known");
      const [row] = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM declaration_links WHERE id = ${linkId("kowalska", URL)}`;
      expect(row?.data).toEqual({
        personId: "kowalska",
        url: URL,
        host: "bip.strzelin.pl",
        uid: "reader",
        day: "2026-11-20",
        status: "new",
        createdAt: "2026-11-20T10:00:00.000Z",
      });
      expect(linkId("nowak", URL)).not.toBe(linkId("kowalska", URL));
    });

    it("refuses a reader's links past the day's limit, in the Warsaw day", async () => {
      for (let i = 0; i < LINKS_PER_DAY; i++) {
        table("declarationLinks")[`l${i}`] = {
          personId: `p${i}`,
          uid: "reader",
          day: "2026-11-20",
        };
      }
      await sync();
      const add = (uid: string, url: string, at: string) =>
        addDeclarationLinkPg({
          personId: "kowalska",
          url,
          uid,
          now: new Date(at),
        });
      expect(await statusOf(add("reader", URL, "2026-11-20T10:00:00Z"))).toBe(
        429,
      );
      // 23:30 UTC is the next day in Warsaw.
      expect(await add("reader", URL, "2026-11-20T23:30:00Z")).toBe("added");
      // Somebody else's day is their own.
      expect(await add("other", `${URL}?2`, "2026-11-20T10:00:00Z")).toBe(
        "added",
      );
    });
  });

  describe("pagesWithAPublicPostPg", () => {
    it("counts a paid post at a public company, drafts too, and no seat nobody is paid for", async () => {
      Object.assign(table("nodes"), {
        spolka: { type: "place", name: "Wodociągi", isPublic: true },
        prywatna: { type: "place", name: "Kiosk", isPublic: false },
        szpital: {
          type: "place",
          name: "Szpital",
          isPublic: true,
          supervisoryBody: "rada-spoleczna",
        },
      });
      Object.assign(table("edges"), {
        a: {
          source: "paid",
          target: "spolka",
          type: "employed",
          name: "Prezes",
        },
        b: { source: "private", target: "prywatna", type: "employed" },
        c: {
          source: "gone",
          target: "spolka",
          type: "employed",
          deleted: true,
        },
        d: { source: "member", target: "spolka", type: "member" },
        e: {
          source: "seat",
          target: "szpital",
          type: "employed",
          name: "Członek Rady Społecznej",
        },
      });
      await sync();
      expect(
        await pagesWithAPublicPostPg([
          "paid",
          "private",
          "gone",
          "member",
          "seat",
          "",
        ]),
      ).toEqual(new Set(["paid"]));
    });
  });
});
