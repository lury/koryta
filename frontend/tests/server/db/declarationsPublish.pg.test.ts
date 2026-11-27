import { call, cropId, decodeTestToken, MIDDAY } from "./declarationsHarness";
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
import settlePost from "~~/server/api/declarations/[id]/settle.post";
import withdrawPost from "~~/server/api/declarations/[id]/withdraw.post";
import publishQueuedPost from "~~/server/api/declarations/publish-queued.post";
import sweepPost from "~~/server/api/declarations/sweep.post";
import overviewGet from "~~/server/api/declarations/overview.get";
import declinePost from "~~/server/api/declarations/publications/[id]/decline.post";
import restorePost from "~~/server/api/declarations/publications/[id]/restore.post";
import recheckPost from "~~/server/api/declarations/publications/[id]/recheck.post";
import cropsGet from "~~/server/api/declarations/publications/[id]/crops.get";
import { afterHandPublicationPg } from "~~/server/db/declarationHolds";
import { DECLARATION_ACTOR } from "~~/shared/declarations";
import type { DeclarationOverview, DrainResult } from "~~/shared/declarations";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
} from "./pgHarness";

/** What a settled reading does to its pages on Postgres
 * (server/db/declarationPublish.ts, declarationHolds.ts,
 * declarationOverview.ts) through the admin's and the job's handlers: a
 * decision on a crop, a press of the queue, the sweep, a held page declined,
 * put back and asked again, the overview; who may do which. The cases of the
 * Firestore-mock tests they replace (tests/server/api/declarations/*).
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationsPublish.pg.test.ts
 */

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: async (t: string) => decodeTestToken(t) }),
}));

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;
const sync = () => store.sync(sql);

const BORN = "1979-07-15";
const AT = "2026-11-20T10:00:00.000Z";
const IMPORT = "pipeline-people";

type Doc = Record<string, unknown>;

async function doc(name: string, id: string): Promise<Doc | undefined> {
  const [row] = await sql<{ data: Doc }[]>`
    SELECT data FROM ${sql(name)} WHERE id = ${id}`;
  return row?.data;
}

async function rows(name: string): Promise<Doc[]> {
  return (
    await sql<{ data: Doc }[]>`SELECT data FROM ${sql(name)} ORDER BY id`
  ).map((row) => row.data);
}

/** A draft councillor born on the crop's day, with the import's revision, a
 * paid post at a public company and the candidacy the declaration was filed
 * for: everything `publishPage` asks of a page it puts up. */
function publishablePage() {
  const page = {
    type: "person",
    name: "Anna Kowalska",
    birthDate: BORN,
    published: false,
  };
  table("nodes").kowalska = page;
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
  const { published: _, ...said } = page;
  table("revisions").r1 = {
    node_id: "kowalska",
    collection: "nodes",
    data: said,
    update_time: AT,
    update_user: IMPORT,
    update_automatic: true,
    status: "pending",
  };
  const job = {
    type: "employed",
    source: "kowalska",
    target: "spolka",
    name: "Prezes Zarządu",
    start_date: "2020-01-01",
  };
  const candidacy = {
    type: "election",
    source: "kowalska",
    target: "teryt0217",
    start_date: "2024-04-07",
    position: "Rada gminy",
  };
  table("edges").job = { ...job, published: false };
  table("edges").candidacy = { ...candidacy, published: false };
  for (const [id, data] of [
    ["job", job],
    ["candidacy", candidacy],
  ] as const) {
    table("revisions")[`r-${id}`] = {
      node_id: id,
      collection: "edges",
      data,
      update_time: AT,
      update_user: IMPORT,
      update_automatic: true,
      status: "pending",
    };
  }
}

const agreedCrop = (fields: Doc = {}) => ({
  status: "agreed",
  agreed: { value: BORN, kind: "date", by: "readers", readers: 2 },
  personIds: ["kowalska"],
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
  pageMatch: null,
  updatedAt: AT,
  ...fields,
});

describe.runIf(PG_TEST_DATABASE_URL)("declarations, publication", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("declarations_publish");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MIDDAY);
    store.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("an admin's decision on a crop", () => {
    beforeEach(() => {
      table("nodes").kowalska = {
        type: "person",
        name: "Anna Kowalska",
        birthDate: BORN,
        published: false,
      };
      table("declarationExtracts")[cropId(1)] = agreedCrop({
        status: "disputed",
        agreed: null,
        answers: { readings: { [BORN]: 1, "1980-01-01": 1 } },
      });
      table("declarationExtracts")[cropId(2)] = agreedCrop({ status: "open" });
    });
    const settle = (as: string | undefined, id: string, body: unknown) =>
      call(settlePost, as, { params: { id }, body });

    it("is an admin's: 401 without a token, 403 for a reader, 404 for no crop", async () => {
      await sync();
      const body = { verdict: "date", value: BORN };
      expect(await statusOf(settle(undefined, cropId(1), body))).toBe(401);
      expect(await statusOf(settle("anna,verified", cropId(1), body))).toBe(
        403,
      );
      expect(await statusOf(settle("boss,admin", "nope", body))).toBe(404);
      expect(await statusOf(settle("boss,admin", cropId(9), body))).toBe(404);
      expect(await statusOf(settle("boss,admin", cropId(2), body))).toBe(409);
    });

    it("settles a disputed crop on the admin's date and holds the draft born that day", async () => {
      await sync();
      expect(
        await settle("boss,admin", cropId(1), { verdict: "date", value: BORN }),
      ).toEqual({ id: cropId(1), status: "agreed", compare: true });
      expect(await doc("declaration_extracts", cropId(1))).toMatchObject({
        status: "agreed",
        agreed: { value: BORN, kind: "date", by: "admin", uid: "boss" },
        decision: { verdict: "date", before: { status: "disputed" } },
        pageMatch: "same",
      });
      expect(await doc("declaration_publications", "kowalska")).toMatchObject({
        status: "held",
        reason: "admin_decision",
      });
      // Decided once, it waits for nobody.
      expect(
        await statusOf(
          settle("boss,admin", cropId(1), { verdict: "unreadable" }),
        ),
      ).toBe(409);
    });

    it("takes a crop back", async () => {
      await sync();
      expect(
        await call(withdrawPost, "boss,admin", { params: { id: cropId(1) } }),
      ).toEqual({ id: cropId(1), status: "withdrawn", compare: false });
      expect(
        await statusOf(
          call(withdrawPost, "anna", { params: { id: cropId(1) } }),
        ),
      ).toBe(403);
    });
  });

  describe("publishing from the queue", () => {
    beforeEach(() => {
      publishablePage();
      table("declarationExtracts")[cropId(1)] = agreedCrop({
        pageMatch: "same",
      });
      table("declarationPublications").kowalska = {
        personId: "kowalska",
        status: "queued",
        reason: null,
        extractIds: [cropId(1)],
        declarations: [],
        queuedAt: AT,
      };
    });

    it("is an admin's press", async () => {
      await sync();
      expect(await statusOf(call(publishQueuedPost, undefined))).toBe(401);
      expect(await statusOf(call(publishQueuedPost, "anna,verified"))).toBe(
        403,
      );
    });

    it("puts the page up with its revision, its candidacy and its job", async () => {
      await sync();
      const result = await call<DrainResult>(publishQueuedPost, "boss,admin");
      expect(result).toMatchObject({
        published: ["kowalska"],
        held: [],
        failed: [],
        waiting: 0,
      });
      const page = await doc("nodes", "kowalska");
      expect(page).toMatchObject({ published: true });
      expect(typeof page!.content_changed_at).toBe("string");
      expect(await doc("revisions", "r1")).toMatchObject({
        status: "approved",
        review_user: DECLARATION_ACTOR,
      });
      expect(await doc("edges", "job")).toMatchObject({
        published: true,
        revision_id: "revisions/r-job",
      });
      expect(await doc("edges", "candidacy")).toMatchObject({
        published: true,
        revision_id: "revisions/r-candidacy",
      });
      expect(await doc("declaration_publications", "kowalska")).toMatchObject({
        status: "published",
        autoPublished: false,
        pressedBy: "boss",
        edges: { published: ["candidacy", "job"], held: [] },
      });
      const audit = await rows("audit");
      expect(
        audit.find(
          (row) => row.action === "publish" && row.collection === "nodes",
        ),
      ).toMatchObject({
        target_id: "kowalska",
        user: DECLARATION_ACTOR,
        pressed_by: "boss",
      });
      // The trigger effects ran in the write's transaction.
      expect(await doc("nodes", "kowalska")).toHaveProperty("revisions");
    });

    it("holds a page a person's proposal is waiting on", async () => {
      table("revisions").r2 = {
        node_id: "kowalska",
        collection: "nodes",
        data: { type: "person", name: "Anna Kowalska-Nowak" },
        update_time: AT,
        update_user: "anna",
        update_automatic: false,
        status: "pending",
      };
      await sync();
      const result = await call<DrainResult>(publishQueuedPost, "boss,admin");
      expect(result.held).toEqual([
        { personId: "kowalska", reason: "pending_proposal" },
      ]);
      expect(await doc("nodes", "kowalska")).toMatchObject({
        published: false,
      });
      expect(await doc("declaration_publications", "kowalska")).toMatchObject({
        status: "held",
        reason: "pending_proposal",
      });
    });
  });

  describe("the job's sweep", () => {
    beforeEach(() => {
      publishablePage();
      table("declarationExtracts")[cropId(1)] = agreedCrop();
    });

    it("is the datascience group's", async () => {
      await sync();
      expect(await statusOf(call(sweepPost, "boss,admin"))).toBe(403);
    });

    it("compares a crop nothing compared and takes up the queue", async () => {
      await sync();
      const result = await call<{ checked: number; drain: DrainResult }>(
        sweepPost,
        "job,datascience",
      );
      expect(result.checked).toBe(1);
      expect(result.drain.published).toEqual(["kowalska"]);
      expect(await doc("declaration_extracts", cropId(1))).toMatchObject({
        pageMatch: "same",
        pageOutcomes: { kowalska: "queued" },
      });
      expect(await doc("declaration_publications", "kowalska")).toMatchObject({
        status: "published",
        autoPublished: true,
        day: "2026-11-27",
      });
      expect(
        await doc("declaration_publish_limits", "2026-11-27"),
      ).toMatchObject({ count: 1 });
    });
  });

  describe("the day's limit", () => {
    it("takes up no page once the day's slots are used", async () => {
      publishablePage();
      table("declarationExtracts")[cropId(1)] = agreedCrop();
      table("declarationPublishLimits")["2026-11-27"] = {
        day: "2026-11-27",
        count: 10_000,
      };
      await sync();
      const result = await call<{ drain: DrainResult }>(
        sweepPost,
        "job,datascience",
      );
      expect(result.drain).toMatchObject({ capReached: true, published: [] });
      expect(await doc("declaration_publications", "kowalska")).toMatchObject({
        status: "queued",
      });
      expect(await doc("nodes", "kowalska")).toMatchObject({
        published: false,
      });
    });
  });

  describe("a held page", () => {
    beforeEach(() => {
      publishablePage();
      table("declarationExtracts")[cropId(1)] = agreedCrop({
        pageMatch: "same",
      });
      table("declarationExtracts")[cropId(2)] = agreedCrop({
        agreed: { value: "1980-02-02", kind: "date", by: "readers" },
        status: "agreed",
        pageMatch: "different",
      });
      table("declarationPublications").kowalska = {
        personId: "kowalska",
        status: "held",
        reason: "conflicting_reading",
        extractIds: [cropId(1)],
        declarations: [],
        queuedAt: AT,
        heldAt: AT,
      };
    });
    const as = (handler: unknown, who: string | undefined, id = "kowalska") =>
      call(handler, who, { params: { id } });

    it("is an admin's to decide, and a page with no record is a 404", async () => {
      await sync();
      for (const handler of [declinePost, restorePost, recheckPost, cropsGet]) {
        expect(await statusOf(as(handler, undefined))).toBe(401);
        expect(await statusOf(as(handler, "anna,verified"))).toBe(403);
      }
      expect(await statusOf(as(declinePost, "boss,admin", "nikt"))).toBe(404);
      expect(await statusOf(as(declinePost, "boss,admin", "bad id!"))).toBe(
        404,
      );
    });

    it("is declined, then put back", async () => {
      await sync();
      expect(await as(declinePost, "boss,admin")).toEqual({ id: "kowalska" });
      expect(await doc("declaration_publications", "kowalska")).toMatchObject({
        status: "held",
        declinedBy: "boss",
      });
      expect(await statusOf(as(declinePost, "boss,admin"))).toBe(409);
      expect(await statusOf(as(recheckPost, "boss,admin"))).toBe(409);
      expect(await as(restorePost, "boss,admin")).toEqual({ id: "kowalska" });
      const record = await doc("declaration_publications", "kowalska");
      expect(record).not.toHaveProperty("declinedBy");
      expect(record).not.toHaveProperty("declinedAt");
      expect(await statusOf(as(restorePost, "boss,admin"))).toBe(409);
    });

    it("lists the crops that give it another date", async () => {
      await sync();
      const crops = await as(cropsGet, "boss,admin");
      expect(crops).toEqual([
        expect.objectContaining({
          id: cropId(2),
          agreed: "1980-02-02",
          decidable: true,
        }),
      ]);
    });

    it("is asked again, and held again for what holds it now", async () => {
      await sync();
      expect(await as(recheckPost, "boss,admin")).toEqual({
        outcome: "held",
        reason: "conflicting_reading",
      });
      Reflect.deleteProperty(table("declarationExtracts"), cropId(2));
      await sync();
      expect(await as(recheckPost, "boss,admin")).toEqual({
        outcome: "published",
      });
      expect(await doc("nodes", "kowalska")).toMatchObject({ published: true });
    });

    it("is closed by a publication by hand, and put back by an unpublication", async () => {
      await sync();
      await afterHandPublicationPg("kowalska", "boss", true);
      expect(await doc("declaration_publications", "kowalska")).toMatchObject({
        status: "published",
        autoPublished: false,
        handPublished: { uid: "boss", held: "conflicting_reading" },
      });
      await afterHandPublicationPg("kowalska", "boss", false);
      const record = await doc("declaration_publications", "kowalska");
      expect(record).toMatchObject({
        status: "held",
        reason: "conflicting_reading",
      });
      expect(record).not.toHaveProperty("handPublished");
    });
  });

  describe("GET /api/declarations/overview", () => {
    it("is an admin's, and counts what is there", async () => {
      publishablePage();
      table("declarationExtracts")[cropId(1)] = agreedCrop({
        status: "disputed",
        pageMatch: null,
      });
      table("declarationCandidacies").c1 = {
        status: "not_found",
        reason: "robots",
        personIds: ["kowalska", "nowak"],
      };
      table("declarationAnswers")[`${cropId(1)}_anna`] = {
        extractId: cropId(1),
        uid: "anna",
        verdict: "date",
        value: BORN,
        votes: true,
        counted: true,
        day: "2026-11-27",
        at: MIDDAY.toISOString(),
      };
      await sync();
      expect(await statusOf(call(overviewGet, "anna,verified"))).toBe(403);
      const overview = await call<DeclarationOverview>(
        overviewGet,
        "boss,admin",
      );
      expect(overview.candidacies).toMatchObject({
        total: 1,
        people: 2,
        notFound: [{ reason: "robots", count: 1 }],
      });
      expect(overview.extracts.byStatus.disputed).toBe(1);
      expect(overview.readers.answers).toBe(1);
      expect(overview.readers.readers).toBe(1);
      expect(overview.readers.days.at(-1)).toEqual({
        day: "2026-11-27",
        answers: 1,
        settled: 0,
      });
      expect(overview.lists.disputed.map((row) => row.id)).toEqual([cropId(1)]);
    });
  });
});
