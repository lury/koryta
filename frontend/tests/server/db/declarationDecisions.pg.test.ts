import {
  call,
  cropId,
  decodeTestToken,
  MIDDAY,
  PNG,
  takeCleared,
} from "./declarationsHarness";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type postgres from "postgres";
import { useRuntimeConfig } from "#app";
import imagesGet from "~~/server/api/declarations/[id]/images.get";
import settlePost from "~~/server/api/declarations/[id]/settle.post";
import withdrawPost from "~~/server/api/declarations/[id]/withdraw.post";
import publishQueuedPost from "~~/server/api/declarations/publish-queued.post";
import declinePost from "~~/server/api/declarations/publications/[id]/decline.post";
import restorePost from "~~/server/api/declarations/publications/[id]/restore.post";
import recheckPost from "~~/server/api/declarations/publications/[id]/recheck.post";
import cropsGet from "~~/server/api/declarations/publications/[id]/crops.get";
import peopleGet from "~~/server/api/declarations/people.get";
import { decideExtractPg } from "~~/server/db/declarationHolds";
import { matchAndDrainPg } from "~~/server/db/declarationPublish";
import { cropImagesPg } from "~~/server/db/declarationReading";
import {
  restageCropPeoplePg,
  restageDeclarationPeoplePg,
} from "~~/server/db/declarationPeopleCount";
import {
  OVERVIEW_CACHE_BASE,
  waitsForAdmin,
} from "~~/server/utils/declarationDecisions";
import { SEEDED_DECLARATION_PEOPLE as seeded } from "~~/scripts/declarationPeople";
import type { DrainResult } from "~~/shared/declarations";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
} from "./pgHarness";
import {
  peopleEntries,
  peopleSnapshot,
  seedPeople,
} from "./declarationPeopleSeed";

/** An admin's decisions on Postgres, past what declarationsPublish.pg covers:
 * a crop settled or taken back (server/db/declarationHolds.ts) and what
 * follows it - the comparison with its pages under the configured limit, the
 * caches dropped, the people count and the readers' queue moved - a held
 * page asked again, declined, put back and its crops listed, the crop's
 * pictures and the people snapshot. The cases of the Firestore-mock tests
 * tests/server/api/declarations/{decisions,publications}.test.ts and
 * tests/server/utils/declaration{Decisions,People}.test.ts.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationDecisions.pg.test.ts
 */

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: async (t: string) => decodeTestToken(t) }),
}));
// The real comparison, watched for what the handlers hand it, and made to
// fail where a case says so.
vi.mock("~~/server/db/declarationPublish", async (original) => {
  const real =
    await original<typeof import("~~/server/db/declarationPublish")>();
  return {
    ...real,
    matchAndDrainPg: vi.fn(real.matchAndDrainPg),
    drainPublicationsPg: vi.fn(real.drainPublicationsPg),
  };
});

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;
const sync = () => store.sync(sql);

const BORN = "1966-05-21";
const AT = "2026-11-20T10:00:00.000Z";
const IMPORT = "pipeline-people";
/** The runtime config the handlers read the daily limit from. */
const config = () => useRuntimeConfig() as Record<string, unknown>;
let shippedLimit: unknown;

type Doc = Record<string, unknown>;

async function doc(name: string, id: string): Promise<Doc | undefined> {
  const [row] = await sql<{ data: Doc }[]>`
    SELECT data FROM ${sql(name)} WHERE id = ${id}`;
  return row?.data;
}

async function allRows(name: string): Promise<[string, Doc][]> {
  const found = await sql<{ id: string; data: Doc }[]>`
    SELECT id, data FROM ${sql(name)} ORDER BY id`;
  return found.map((row) => [row.id, row.data]);
}

/** The handler's event, to read the headers it set off afterwards. */
function event(fields: { params?: Record<string, string>; body?: unknown }) {
  return { ...fields, context: {} as Record<string, unknown> };
}

/** A draft councillor everything `publishPage` asks of a page is ready for:
 * the import's revision, a paid post at a public company, the candidacy. */
function publishablePage(id: string, born: string) {
  const page = { type: "person", name: `Osoba ${id}`, birthDate: born };
  table("nodes")[id] = { ...page, published: false };
  table("nodes").spolka = {
    type: "place",
    name: "Wodociągi Strzelin",
    published: true,
    isPublic: true,
  };
  table("nodes").teryt0217 = {
    type: "region",
    name: "powiat strzeliński",
    published: true,
  };
  table("revisions")[`r-${id}`] = {
    node_id: id,
    collection: "nodes",
    data: page,
    update_time: AT,
    update_user: IMPORT,
    update_automatic: true,
    status: "pending",
  };
  const edges = {
    [`${id}-job`]: {
      type: "employed",
      source: id,
      target: "spolka",
      name: "Prezes Zarządu",
      start_date: "2020-01-01",
    },
    [`${id}-candidacy`]: {
      type: "election",
      source: id,
      target: "teryt0217",
      start_date: "2024-04-07",
      position: "Rada gminy",
    },
  };
  for (const [edge, data] of Object.entries(edges)) {
    table("edges")[edge] = { ...data, published: false };
    table("revisions")[`r-${edge}`] = {
      node_id: edge,
      collection: "edges",
      data,
      update_time: AT,
      update_user: IMPORT,
      update_automatic: true,
      status: "pending",
    };
  }
}

const settledCrop = (personId: string, fields: Doc = {}) => ({
  status: "agreed",
  agreed: { value: BORN, kind: "date", by: "readers", readers: 2 },
  personIds: [personId],
  url: "https://bip.test/1",
  declarationYear: 2023,
  units: [
    {
      teryt: "021704",
      level: "gmina",
      unitName: "Strzelin",
      office: "Rada gminy",
      year: 2024,
    },
  ],
  pageMatch: "same",
  updatedAt: AT,
  ...fields,
});

const disputed = (personId: string, fields: Doc = {}) =>
  settledCrop(personId, {
    status: "disputed",
    agreed: null,
    pageMatch: null,
    answers: { readings: { [BORN]: 2, "1966-12-05": 2 }, unreadable: 1 },
    ...fields,
  });

const queued = (personId: string, extractIds: string[]) => ({
  personId,
  status: "queued",
  reason: null,
  extractIds,
  declarations: [],
  queuedAt: AT,
});

/** Whether the re-staging reached the page's entry in the people count. */
async function restaged(page: string): Promise<boolean> {
  return (await peopleEntries(sql))[page]?.at === MIDDAY.getTime();
}

/** An entry a newer release wrote: while one does not read, the re-staging
 * writes nothing and logs. */
const unreadableEntry = { stage: "queued", detail: "", future: true };

describe("waitsForAdmin", () => {
  it("is the overview's two lists: a dispute, and a reading its page contradicts", () => {
    expect(waitsForAdmin({ status: "disputed" })).toBe(true);
    expect(waitsForAdmin({ status: "agreed", pageMatch: "different" })).toBe(
      true,
    );
    for (const data of [
      { status: "agreed", pageMatch: "same" },
      { status: "agreed", pageMatch: null },
      { status: "open" },
      { status: "unreadable" },
      { status: "withdrawn" },
      undefined,
    ]) {
      expect(waitsForAdmin(data)).toBe(false);
    }
  });
});

describe.runIf(PG_TEST_DATABASE_URL)(
  "declarations, an admin's decisions",
  () => {
    beforeAll(async () => {
      sql = await openTestDatabase("decla_decisions");
      shippedLimit = config().declarationsDailyPublishLimit;
    }, 120_000);
    afterAll(async () => {
      config().declarationsDailyPublishLimit = shippedLimit;
      await closeTestDatabase(sql);
    });
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(MIDDAY);
      vi.mocked(matchAndDrainPg).mockClear();
      config().declarationsDailyPublishLimit = 4;
      store.clear();
      takeCleared();
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    describe("decideExtractPg", () => {
      const NOW = new Date("2026-10-29T12:00:00Z");
      const EARLIER = "2026-10-27T09:00:00.000Z";
      beforeEach(() => {
        table("declarationExtracts").sporny = disputed("fx0001", {
          answers: {
            readings: { [BORN]: 2, "1966-12-05": 2 },
            unreadable: 1,
          },
        });
        table("declarationExtracts")["inna-data"] = settledCrop("fx0002", {
          agreed: {
            value: "1971-09-03",
            kind: "date",
            by: "readers",
            at: EARLIER,
          },
          pageMatch: "different",
          pageRecheck: true,
          pageOutcomes: { fx0002: "different" },
        });
      });
      const decide = (
        extractId: string,
        decision: Parameters<typeof decideExtractPg>[0]["decision"],
      ) => decideExtractPg({ extractId, uid: "admin-uid", decision, now: NOW });

      it("settles a dispute on the admin's date, to be compared with its pages", async () => {
        await sync();
        expect(
          await decide("sporny", { verdict: "date", value: BORN }),
        ).toEqual({
          id: "sporny",
          status: "agreed",
          compare: true,
        });
        const at = NOW.toISOString();
        const crop = await doc("declaration_extracts", "sporny");
        expect(crop).toMatchObject({
          status: "agreed",
          agreed: {
            value: BORN,
            kind: "date",
            by: "admin",
            uid: "admin-uid",
            at,
          },
          decision: {
            verdict: "date",
            value: BORN,
            uid: "admin-uid",
            at,
            before: { status: "disputed", agreed: null },
          },
          pageMatch: null,
          pageRecheck: false,
          updatedAt: at,
        });
        // What the readers typed stays the record of the dispute.
        expect(crop!.answers).toEqual({
          readings: { [BORN]: 2, "1966-12-05": 2 },
          unreadable: 1,
        });
      });

      it("settles on a year, which compares with nothing", async () => {
        await sync();
        expect(
          await decide("sporny", { verdict: "date", value: "1966" }),
        ).toEqual({ id: "sporny", status: "agreed", compare: false });
        expect(
          (await doc("declaration_extracts", "sporny"))!.agreed,
        ).toMatchObject({ value: "1966", kind: "year" });
      });

      it("corrects a reading its page contradicts, and compares it afresh", async () => {
        await sync();
        expect(
          await decide("inna-data", { verdict: "date", value: "1971-03-09" }),
        ).toMatchObject({ status: "agreed", compare: true });
        expect(await doc("declaration_extracts", "inna-data")).toMatchObject({
          agreed: { value: "1971-03-09", by: "admin" },
          decision: { before: { status: "agreed", agreed: "1971-09-03" } },
          // Off the "different" list until the comparison says otherwise.
          pageMatch: null,
          pageRecheck: false,
        });
      });

      it("marks a crop unreadable, with no reading left to count", async () => {
        await sync();
        expect(await decide("inna-data", { verdict: "unreadable" })).toEqual({
          id: "inna-data",
          status: "unreadable",
          compare: false,
        });
        expect(await doc("declaration_extracts", "inna-data")).toMatchObject({
          status: "unreadable",
          agreed: null,
          decision: {
            verdict: "unreadable",
            value: null,
            before: { status: "agreed", agreed: "1971-09-03" },
          },
          pageMatch: null,
          pageRecheck: false,
        });
      });

      it("withdraws a crop, so its reading stops counting for the page", async () => {
        await sync();
        expect(await decide("inna-data", { verdict: "withdraw" })).toEqual({
          id: "inna-data",
          status: "withdrawn",
          compare: false,
        });
        expect(await doc("declaration_extracts", "inna-data")).toMatchObject({
          status: "withdrawn",
          agreed: null,
          decision: { verdict: "withdraw", uid: "admin-uid" },
          pageMatch: null,
        });
      });

      it("refuses a crop somebody settled in the meantime, and writes nothing", async () => {
        table("declarationExtracts").zgodny = settledCrop("fx0003", {
          agreed: { value: "1980-01-02", kind: "date", by: "readers" },
        });
        await sync();
        await decide("sporny", { verdict: "withdraw" });
        const before = await allRows("declaration_extracts");
        for (const [id, decision] of [
          ["sporny", { verdict: "date", value: BORN }],
          ["sporny", { verdict: "withdraw" }],
          ["zgodny", { verdict: "unreadable" }],
        ] as const) {
          await expect(decide(id, decision)).rejects.toMatchObject({
            statusCode: 409,
            message: "Ten wycinek ktoś już rozstrzygnął.",
          });
        }
        expect(await allRows("declaration_extracts")).toEqual(before);
      });

      it("says a crop still being read waits for readers", async () => {
        table("declarationExtracts").otwarty = { status: "open" };
        await sync();
        await expect(
          decide("otwarty", { verdict: "unreadable" }),
        ).rejects.toMatchObject({
          statusCode: 409,
          message: "Ten wycinek czeka jeszcze na czytelników.",
        });
      });

      it("is a 404 for a crop that is not there or has nothing to read", async () => {
        table("declarationExtracts").pusty = { status: "failed" };
        await sync();
        for (const id of ["nie-ma", "pusty"]) {
          await expect(
            decide(id, { verdict: "withdraw" }),
          ).rejects.toMatchObject({
            statusCode: 404,
            message: "Nie ma takiego wycinka.",
          });
        }
      });

      it("refuses a date that is neither a day nor a year", async () => {
        await sync();
        await expect(
          decide("sporny", { verdict: "date", value: "05.1966" }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect((await doc("declaration_extracts", "sporny"))!.status).toBe(
          "disputed",
        );
      });
    });

    describe("a crop's pictures", () => {
      const DATA_URL = `data:image/png;base64,${PNG.$bytes}`;
      beforeEach(() => {
        table("declarationExtracts")[cropId(1)] = settledCrop("fx0001");
        table("declarationExtracts")[cropId(2)] = settledCrop("fx0002");
      });

      it("gives the crop's pictures as data URLs", async () => {
        table("declarationExtractImages")[cropId(1)] = { date: PNG, name: PNG };
        table("declarationExtractImages")[cropId(2)] = {
          date: PNG,
          name: null,
        };
        await sync();
        expect(await cropImagesPg(cropId(1))).toEqual({
          date: DATA_URL,
          name: DATA_URL,
        });
        expect(await cropImagesPg(cropId(2))).toEqual({
          date: DATA_URL,
          name: null,
        });
      });

      it("gives no pictures for a crop the job read itself and sent without", async () => {
        await sync();
        expect(await cropImagesPg(cropId(2))).toEqual({
          date: null,
          name: null,
        });
      });

      it("is null for a crop that is not there", async () => {
        table("declarationExtractImages")[cropId(3)] = { date: PNG };
        await sync();
        expect(await cropImagesPg(cropId(3))).toBeNull();
      });

      it("answers a signed-in reader never to be cached, and is a 404 with words for no crop", async () => {
        table("declarationExtractImages")[cropId(1)] = { date: PNG };
        await sync();
        const asked = event({ params: { id: cropId(1) } });
        expect(await call(imagesGet, "anna", asked)).toEqual({
          date: DATA_URL,
          name: null,
        });
        expect(asked.context["header:Cache-Control"]).toBe("private, no-store");
        expect(
          await statusOf(
            call(imagesGet, "anna", { params: { id: "../overview" } }),
          ),
        ).toBe(404);
        await expect(
          call(imagesGet, "anna", { params: { id: cropId(9) } }),
        ).rejects.toMatchObject({
          statusCode: 404,
          message: "Nie ma takiego wycinka.",
        });
      });
    });

    describe("POST /api/declarations/<id>/settle", () => {
      beforeEach(() => {
        table("nodes").kowalska = {
          type: "person",
          name: "Anna Kowalska",
          birthDate: BORN,
          published: false,
        };
        table("declarationExtracts")[cropId(1)] = disputed("kowalska");
        // Her other crop, in the readers' queue at a place no rule gives.
        table("declarationExtracts")[cropId(2)] = settledCrop("kowalska", {
          status: "open",
          agreed: null,
          pageMatch: null,
          priority: 99,
          answerCount: 0,
        });
      });
      const settle = (as: string | undefined, body: unknown, id = cropId(1)) =>
        call(settlePost, as, event({ params: { id }, body }));

      it("settles on the admin's date, read again here, and compares it with its pages", async () => {
        seedPeople(store, ["kowalska"]);
        await sync();
        const asked = event({
          params: { id: cropId(1) },
          body: { verdict: "date", value: "21.05.1966" },
        });
        expect(await call(settlePost, "boss,admin", asked)).toEqual({
          id: cropId(1),
          status: "agreed",
          compare: true,
        });
        expect(await doc("declaration_extracts", cropId(1))).toMatchObject({
          agreed: { value: BORN, by: "admin", uid: "boss" },
          decision: { verdict: "date", value: BORN, uid: "boss" },
          pageMatch: "same",
        });
        const [ids, , limit, options] =
          vi.mocked(matchAndDrainPg).mock.calls[0]!;
        expect(ids).toEqual([cropId(1)]);
        expect(limit).toBe(4);
        expect(options).toEqual({ maxPages: 1 });
        // The reload reads the overview again; no page showed the crop and the
        // pass published nobody, so the pages' answers stand.
        const cleared = takeCleared();
        expect(cleared).toContain(OVERVIEW_CACHE_BASE);
        expect(cleared).not.toContain("nitro:handlers");
        expect(asked.context["header:Cache-Control"]).toBe("private, no-store");
        // Her other crop takes its place in the readers' queue.
        expect(
          (await doc("declaration_extracts", cropId(2)))!.priority,
        ).not.toBe(99);
        // She moves in the people count: held for the admin's own date.
        expect((await peopleEntries(sql)).kowalska).toMatchObject({
          stage: "held",
          at: MIDDAY.getTime(),
        });
      });

      it("drops the cached pages when a public page linked the crop", async () => {
        table("declarationExtracts")[cropId(3)] = disputed("kowalska");
        table("declarationPublications").kowalska = {
          ...queued("kowalska", [cropId(1), cropId(3)]),
          status: "published",
        };
        await sync();
        for (const [id, body] of [
          [cropId(1), { verdict: "date", value: BORN }],
          [cropId(3), { verdict: "unreadable" }],
        ] as const) {
          takeCleared();
          await settle("boss,admin", body, id);
          const cleared = takeCleared();
          expect(cleared).toContain("nitro:handlers");
          expect(cleared).toContain(OVERVIEW_CACHE_BASE);
        }
      });

      it("compares nothing for a year or for an unreadable crop", async () => {
        table("declarationExtracts")[cropId(3)] = disputed("kowalska");
        await sync();
        await settle("boss,admin", { verdict: "date", value: "1966" });
        expect(
          await settle("boss,admin", { verdict: "unreadable" }, cropId(3)),
        ).toMatchObject({ status: "unreadable" });
        expect(
          (await doc("declaration_extracts", cropId(1)))!.agreed,
        ).toMatchObject({ value: "1966", kind: "year" });
        expect(matchAndDrainPg).not.toHaveBeenCalled();
        expect(takeCleared()).toContain(OVERVIEW_CACHE_BASE);
      });

      it("decides nothing for somebody who is not an admin, nor reads what they sent", async () => {
        await sync();
        // A body that would be a 400 is never read: the gate answers first.
        expect(
          await statusOf(settle("anna,verified", { verdict: "nope" })),
        ).toBe(403);
        expect((await doc("declaration_extracts", cropId(1)))!.status).toBe(
          "disputed",
        );
      });

      it("refuses a verdict or a date it does not know", async () => {
        await sync();
        for (const body of [
          { verdict: "withdraw" },
          { verdict: "date" },
          { verdict: "date", value: "wczoraj" },
          { verdict: "date", value: "31.02.1966" },
        ]) {
          expect(await statusOf(settle("boss,admin", body))).toBe(400);
        }
        expect(await doc("declaration_extracts", cropId(1))).toMatchObject({
          status: "disputed",
          agreed: null,
        });
      });

      it("passes on the refusal of a crop somebody settled meanwhile", async () => {
        table("declarationExtracts")[cropId(1)] = settledCrop("kowalska");
        await sync();
        await expect(
          settle("boss,admin", { verdict: "unreadable" }),
        ).rejects.toMatchObject({
          statusCode: 409,
          message: "Ten wycinek ktoś już rozstrzygnął.",
        });
        expect(matchAndDrainPg).not.toHaveBeenCalled();
      });

      it("keeps the decision when comparing it fails, for the sweep to finish", async () => {
        await sync();
        vi.mocked(matchAndDrainPg).mockRejectedValueOnce(
          new Error("deadline exceeded"),
        );
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(
          await settle("boss,admin", { verdict: "date", value: BORN }),
        ).toMatchObject({ status: "agreed" });
        expect(quiet).toHaveBeenCalledWith(
          expect.stringContaining(`comparing ${cropId(1)} failed`),
          expect.any(Error),
        );
        expect(await doc("declaration_extracts", cropId(1))).toMatchObject({
          status: "agreed",
          // Left for the sweep, which compares what nothing compared.
          pageMatch: null,
        });
      });

      it("moves the crop's people, and those the pass took up, in the people count", async () => {
        // A page the pass after the decision takes up.
        publishablePage("nowak", "1970-01-01");
        table("declarationExtracts")[cropId(4)] = settledCrop("nowak", {
          agreed: { value: "1970-01-01", kind: "date", by: "readers" },
        });
        table("declarationPublications").nowak = queued("nowak", [cropId(4)]);
        table("declarationExtracts")[cropId(3)] = disputed("kowalska");
        seedPeople(store, ["kowalska", "nowak"]);
        await sync();
        await settle("boss,admin", { verdict: "date", value: BORN });
        expect(await restaged("kowalska")).toBe(true);
        expect(await restaged("nowak")).toBe(true);
        expect((await peopleEntries(sql)).nowak).toMatchObject({
          stage: "published",
        });

        seedPeople(store, ["kowalska", "nowak"]);
        table("declarationExtracts")[cropId(1)] = disputed("kowalska");
        await sync();
        await settle("boss,admin", { verdict: "unreadable" }, cropId(3));
        expect(await restaged("kowalska")).toBe(true);
        expect(await restaged("nowak")).toBe(false);
      });

      it("keeps the decision when the people count cannot be moved", async () => {
        seedPeople(store, ["kowalska"], { someone: unreadableEntry });
        await sync();
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(
          await settle("boss,admin", { verdict: "unreadable" }),
        ).toMatchObject({ status: "unreadable" });
        expect(quiet).toHaveBeenCalledWith(
          expect.stringContaining("re-staging kowalska"),
          expect.any(Error),
        );
        expect(takeCleared()).toContain(OVERVIEW_CACHE_BASE);
        expect(await restaged("kowalska")).toBe(false);
      });

      it("drops the cached pages when the comparison published somebody", async () => {
        publishablePage("nowak", "1970-01-01");
        table("declarationExtracts")[cropId(4)] = settledCrop("nowak", {
          agreed: { value: "1970-01-01", kind: "date", by: "readers" },
        });
        table("declarationPublications").nowak = queued("nowak", [cropId(4)]);
        await sync();
        await settle("boss,admin", { verdict: "date", value: BORN });
        expect(await doc("nodes", "nowak")).toMatchObject({ published: true });
        const cleared = takeCleared();
        expect(cleared).toContain("nitro:handlers");
        expect(cleared).toContain(OVERVIEW_CACHE_BASE);
      });
    });

    describe("POST /api/declarations/<id>/withdraw", () => {
      beforeEach(() => {
        table("nodes").kowalska = {
          type: "person",
          name: "Anna Kowalska",
          birthDate: BORN,
          published: false,
        };
        table("declarationExtracts")[cropId(1)] = disputed("kowalska");
        table("declarationExtracts")[cropId(2)] = settledCrop("kowalska", {
          status: "open",
          agreed: null,
          pageMatch: null,
          priority: 99,
          answerCount: 0,
        });
      });

      it("withdraws the crop as the admin's decision", async () => {
        seedPeople(store, ["kowalska"]);
        await sync();
        const asked = event({ params: { id: cropId(1) } });
        expect(await call(withdrawPost, "boss,admin", asked)).toEqual({
          id: cropId(1),
          status: "withdrawn",
          compare: false,
        });
        expect(await doc("declaration_extracts", cropId(1))).toMatchObject({
          status: "withdrawn",
          decision: { verdict: "withdraw", uid: "boss" },
        });
        expect(matchAndDrainPg).not.toHaveBeenCalled();
        const cleared = takeCleared();
        expect(cleared).toContain(OVERVIEW_CACHE_BASE);
        expect(cleared).not.toContain("nitro:handlers");
        expect(asked.context["header:Cache-Control"]).toBe("private, no-store");
        // Her people move in the count, and her other crop takes its place in
        // the readers' queue again: this may have been the only reading.
        expect(await restaged("kowalska")).toBe(true);
        expect(
          (await doc("declaration_extracts", cropId(2)))!.priority,
        ).not.toBe(99);
      });

      it("drops the cached pages when a public page linked the crop", async () => {
        table("declarationPublications").kowalska = {
          ...queued("kowalska", [cropId(1)]),
          status: "confirmed",
        };
        await sync();
        await call(withdrawPost, "boss,admin", { params: { id: cropId(1) } });
        const cleared = takeCleared();
        expect(cleared).toContain("nitro:handlers");
        expect(cleared).toContain(OVERVIEW_CACHE_BASE);
      });

      it("is a 404 for an id that is no crop's", async () => {
        await sync();
        expect(
          await statusOf(
            call(withdrawPost, "boss,admin", { params: { id: "nie-wycinek" } }),
          ),
        ).toBe(404);
      });
    });

    describe("POST /api/declarations/publish-queued", () => {
      it("drops the overview's cached answer after a pass, whatever it published", async () => {
        publishablePage("kowalska", BORN);
        table("declarationExtracts")[cropId(1)] = settledCrop("kowalska");
        table("declarationPublications").kowalska = queued("kowalska", [
          cropId(1),
        ]);
        // A person's proposal she waits on: the pass holds her.
        table("revisions").proposal = {
          node_id: "kowalska",
          collection: "nodes",
          data: { type: "person", name: "Anna Kowalska-Nowak" },
          update_time: AT,
          update_user: "anna",
          update_automatic: false,
          status: "pending",
        };
        seedPeople(store, ["kowalska"]);
        await sync();
        const result = await call<DrainResult>(publishQueuedPost, "boss,admin");
        expect(result.held).toEqual([
          { personId: "kowalska", reason: "pending_proposal" },
        ]);
        const cleared = takeCleared();
        expect(cleared).toContain(OVERVIEW_CACHE_BASE);
        expect(cleared).not.toContain("nitro:handlers");
        // The page it held moves in the people count.
        expect(await restaged("kowalska")).toBe(true);
      });
    });

    describe("a held page", () => {
      beforeEach(() => {
        publishablePage("kowalska", BORN);
        table("declarationExtracts")[cropId(1)] = settledCrop("kowalska");
        table("declarationExtracts")[cropId(2)] = settledCrop("kowalska", {
          agreed: { value: "1980-02-02", kind: "date", by: "readers" },
          pageMatch: "different",
        });
        table("declarationPublications").kowalska = {
          ...queued("kowalska", [cropId(1)]),
          status: "held",
          reason: "conflicting_reading",
          heldAt: AT,
        };
        seedPeople(store, ["kowalska"]);
      });
      const as = (handler: unknown, who: string, id = "kowalska") => {
        const asked = event({ params: { id } });
        return { asked, answer: call(handler, who, asked) };
      };

      it("answers a 404 for what cannot be a page's id, never to be cached", async () => {
        await sync();
        for (const handler of [
          recheckPost,
          declinePost,
          restorePost,
          cropsGet,
        ]) {
          const { asked, answer } = as(
            handler,
            "boss,admin",
            "../nodes/kowalska",
          );
          expect(await statusOf(answer)).toBe(404);
          expect(asked.context["header:Cache-Control"]).toBe(
            "private, no-store",
          );
        }
      });

      it("is asked again in the admin's name, answers what came of it and moves her", async () => {
        await sync();
        expect(await as(recheckPost, "boss,admin").answer).toEqual({
          outcome: "held",
          reason: "conflicting_reading",
        });
        // Nothing went up, so the pages' answers stand.
        expect(takeCleared()).not.toContain("nitro:handlers");
        expect(await restaged("kowalska")).toBe(true);
      });

      it("drops the pages' cached answers once she went up", async () => {
        Reflect.deleteProperty(table("declarationExtracts"), cropId(2));
        await sync();
        expect(await as(recheckPost, "boss,admin").answer).toEqual({
          outcome: "published",
        });
        expect(await doc("declaration_publications", "kowalska")).toMatchObject(
          {
            status: "published",
            pressedBy: "boss",
          },
        );
        expect(takeCleared()).toContain("nitro:handlers");
        expect((await peopleEntries(sql)).kowalska).toMatchObject({
          stage: "published",
        });
      });

      it("moves nobody when the night stopped it", async () => {
        // 03:00 in Warsaw, inside the people import's window.
        vi.setSystemTime(new Date("2026-11-27T02:00:00Z"));
        await sync();
        expect(await as(recheckPost, "boss,admin").answer).toEqual({
          outcome: "skipped",
          skipped: "night",
        });
        expect(await peopleSnapshot(sql)).toBeUndefined();
        expect((await peopleEntries(sql)).kowalska!.at).not.toBe(
          new Date("2026-11-27T02:00:00Z").getTime(),
        );
      });

      it("moves nobody when an import stopped it", async () => {
        await sync();
        await sql`
        INSERT INTO ops.job_runs (id, data) VALUES ('run-1', ${sql.json({
          job: "people_import",
          state: "running",
          startedAt: MIDDAY.toISOString(),
          heartbeatAt: MIDDAY.toISOString(),
        })})
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
        try {
          const answer = await as(recheckPost, "boss,admin").answer;
          expect(answer).toMatchObject({ outcome: "skipped" });
          expect(await restaged("kowalska")).toBe(false);
        } finally {
          await sql`DELETE FROM ops.job_runs WHERE id = 'run-1'`;
        }
      });

      it("is set aside in the admin's name, and she moves in the count", async () => {
        await sync();
        expect(await as(declinePost, "boss,admin").answer).toEqual({
          id: "kowalska",
        });
        expect(await doc("declaration_publications", "kowalska")).toMatchObject(
          {
            declinedBy: "boss",
          },
        );
        expect(await restaged("kowalska")).toBe(true);
      });

      it("moves nobody when the decision was refused", async () => {
        table("declarationPublications").kowalska = {
          ...queued("kowalska", [cropId(1)]),
          status: "published",
        };
        await sync();
        expect(await statusOf(as(declinePost, "boss,admin").answer)).toBe(409);
        expect(await restaged("kowalska")).toBe(false);
      });

      it("is put back, and she moves in the count", async () => {
        table("declarationPublications").kowalska.declinedBy = "boss";
        table("declarationPublications").kowalska.declinedAt = AT;
        await sync();
        expect(await as(restorePost, "boss,admin").answer).toEqual({
          id: "kowalska",
        });
        expect(await restaged("kowalska")).toBe(true);
      });

      it("lists the crops of another day, and which an admin can still decide", async () => {
        // Another page's declaration, matched to that page already.
        table("declarationExtracts")[cropId(3)] = settledCrop("nowak", {
          agreed: { value: "1981-03-03", kind: "date", by: "readers" },
          personIds: ["kowalska", "nowak"],
          pageMatch: "same",
        });
        table("nodes").nowak = {
          type: "person",
          name: "Jan Nowak",
          birthDate: "1981-03-03",
          published: true,
        };
        await sync();
        const crops = (await as(cropsGet, "boss,admin").answer) as Doc[];
        expect(
          crops.map((row) => [row.id, row.agreed, row.decidable]).sort(),
        ).toEqual([
          [cropId(2), "1980-02-02", true],
          [cropId(3), "1981-03-03", false],
        ]);
        const listed = crops.find((row) => row.id === cropId(3))!;
        expect(
          (listed.people as Doc[]).map((person) => person.id).sort(),
        ).toEqual(["kowalska", "nowak"]);
      });

      it("lists nothing for a page without a date to contradict", async () => {
        table("nodes").kowalska.birthDate = "";
        await sync();
        expect(await as(cropsGet, "boss,admin").answer).toEqual([]);
      });
    });

    describe("the people count, as the decisions move it", () => {
      beforeEach(() => {
        table("nodes").kowalska = {
          type: "person",
          name: "Anna Kowalska",
          birthDate: BORN,
          published: false,
        };
      });

      it("moves the people of a crop an admin decided", async () => {
        // A decision leaves what the crop said of its pages as it was.
        table("declarationExtracts")[cropId(1)] = settledCrop("kowalska", {
          status: "withdrawn",
          agreed: null,
          pageOutcomes: { kowalska: "queued" },
        });
        seedPeople(store, ["kowalska"]);
        await sync();
        await restageCropPeoplePg([cropId(1)], [], MIDDAY);
        expect((await peopleEntries(sql)).kowalska).toMatchObject({
          stage: "searching",
          at: MIDDAY.getTime(),
        });
        expect(await peopleSnapshot(sql)).toMatchObject({ people: 1 });
      });

      it("never fails its caller", async () => {
        seedPeople(store, ["kowalska"], { someone: unreadableEntry });
        table("declarationExtracts")[cropId(1)] = settledCrop("kowalska");
        await sync();
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(
          restageDeclarationPeoplePg(["kowalska"], MIDDAY),
        ).resolves.toBeUndefined();
        await expect(
          restageCropPeoplePg([cropId(1)], ["kowalska"], MIDDAY),
        ).resolves.toBeUndefined();
        expect(quiet).toHaveBeenCalledWith(
          expect.stringContaining("re-staging kowalska"),
          expect.objectContaining({
            message: expect.stringContaining("do not read"),
          }),
        );
        expect(await restaged("kowalska")).toBe(false);
      });
    });

    describe("GET /api/declarations/people", () => {
      it("reads the night's snapshot", async () => {
        table("stats").declaration_people = seeded;
        await sync();
        const { people } = await call<{
          people: { published: number; people: number } | null;
        }>(peopleGet, undefined);
        expect(people?.published).toBe(seeded.published);
        expect(people?.people).toBe(seeded.people);
      });

      it("says nothing of a document that does not read as a snapshot", async () => {
        // An old shape, or a job that wrote half of one: left unsaid rather
        // than half drawn.
        table("stats").declaration_people = { ...seeded, people: 1 };
        await sync();
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await call(peopleGet, undefined)).toEqual({ people: null });
        expect(quiet).toHaveBeenCalled();
      });
    });
  },
);
