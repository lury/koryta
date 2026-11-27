import { call, decodeTestToken } from "./declarationsHarness";
import "./cachedOnce";
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
import overviewGet from "~~/server/api/declarations/overview.get";
import { countTotalsPg, reviewListsPg } from "~~/server/db/declarationOverview";
import { withLists } from "~~/server/utils/declarationOverview";
import type { DeclarationOverview } from "~~/shared/declarations";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
} from "./pgHarness";

/** What /admin/oswiadczenia shows, on Postgres (server/db/declarationOverview.ts):
 * the counts, cached for two minutes, and the lists an admin works through,
 * read on every request. The cases of the Firestore-mock tests
 * tests/server/api/declarations/overview.test.ts and
 * tests/server/utils/declarationOverview.test.ts (`countEverything`, now the
 * counts and the lists of `withLists`).
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/declarationOverview.pg.test.ts
 */

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: async (t: string) => decodeTestToken(t) }),
}));

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;
const sync = () => store.sync(sql);

type Data = Record<string, unknown>;

const NOW = new Date("2026-10-29T12:00:00Z");
const at = (iso: string) => new Date(iso).toISOString();

const countEverything = async (dailyLimit: number) =>
  withLists(await countTotalsPg(dailyLimit, NOW), await reviewListsPg(), NOW);

/** The world of the old test: four searches, three crops, four answers, one
 * held page, the day's count. */
function world() {
  table("declarationCandidacies").a = {
    status: "found",
    personIds: ["kowalska"],
  };
  table("declarationCandidacies").b = {
    status: "found",
    personIds: ["kowalska"],
  };
  table("declarationCandidacies").c = {
    status: "not_found",
    reason: "no_seed",
    personIds: ["nowak"],
  };
  table("declarationCandidacies").d = {
    status: "not_found",
    reason: "brand_new_code",
    personIds: ["nowak"],
  };
  table("declarationExtracts").x1 = {
    status: "disputed",
    units: [{ unitName: "Strzelin", office: "Rada gminy" }],
    url: "https://bip.strzelin.pl/1",
    personIds: ["kowalska"],
    answers: {
      readings: { "1979-07-15": 2, "1979-07-16": 2 },
      unreadable: 1,
      empty: 1,
    },
    updatedAt: at("2026-10-29T10:00:00Z"),
    tag: "bip-cut-v1",
    runId: "run-1",
  };
  table("declarationExtracts").x2 = {
    status: "agreed",
    pageMatch: "different",
    agreed: {
      value: "1980-01-01",
      kind: "date",
      by: "admin",
      at: at("2026-10-28T09:00:00Z"),
    },
    personIds: ["nowak"],
    units: [{ teryt: "021704", office: "Rada gminy" }],
    url: "https://bip.strzelin.pl/2",
    updatedAt: at("2026-10-28T09:00:00Z"),
    tag: "bip-cut-v1",
    runId: "run-1",
  };
  table("declarationExtracts").x3 = {
    status: "failed",
    reason: "blank_form",
    updatedAt: at("2026-10-27T09:00:00Z"),
    tag: "bip-cut-v1",
    runId: "run-0",
  };
  const answer = (uid: string, fields: Data) => ({
    uid,
    counted: true,
    votes: true,
    day: "2026-10-29",
    ...fields,
  });
  table("declarationAnswers").x1_r1 = answer("r1", {
    at: at("2026-10-29T09:00:00Z"),
  });
  table("declarationAnswers").x1_r2 = answer("r2", {
    at: at("2026-10-29T09:30:00Z"),
  });
  // Read without an account: no vote, so no reader and no answer here.
  const stranger = "anon:0f8fad5b-d9cb-469f-a165-000000000001";
  table("declarationAnswers")[`x1_${stranger}`] = answer(stranger, {
    votes: false,
    at: at("2026-10-29T10:30:00Z"),
  });
  table("declarationAnswers").x2_r1 = answer("r1", {
    counted: false,
    day: "2026-10-28",
    at: at("2026-10-28T08:00:00Z"),
  });
  table("declarationPublications").kowalska = {
    status: "held",
    reason: "pending_proposal",
    queuedAt: at("2026-10-29T08:00:00Z"),
    declarations: [{ url: "https://bip.strzelin.pl/1", unit: "Strzelin" }],
  };
  table("declarationPublishLimits")["2026-10-29"] = { count: 3 };
  table("nodes").kowalska = {
    type: "person",
    name: "Anna Kowalska",
    published: false,
    birthDate: "1979-07-15",
  };
  table("nodes").nowak = {
    type: "person",
    name: "Jan Nowak",
    published: true,
    birthDate: "1979-07-15",
  };
}

describe.runIf(PG_TEST_DATABASE_URL)("declarations, the overview", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("decla_overview");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    world();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET /api/declarations/overview", () => {
    const held = () => ({
      status: "held",
      reason: "two_places",
      queuedAt: at("2026-10-29T08:00:00Z"),
      declarations: [],
    });

    // One case, as the counts are cached for the file once taken.
    it("reads the lists on every request and counts them, the totals once, and counts who went up since", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      table("nodes").wodociagi = { type: "place", isPublic: true };
      for (const id of ["a", "b"]) {
        table("nodes")[id] = { type: "person", name: id };
        table("declarationPublications")[id] = held();
        table("edges")[`${id}-job`] = {
          type: "employed",
          name: "Zarząd",
          source: id,
          target: "wodociagi",
        };
      }
      await sync();
      expect(await statusOf(call(overviewGet, "anna,verified"))).toBe(403);
      const first = await call<DeclarationOverview>(overviewGet, "boss,admin");
      expect(first.lists.held.map((row) => row.personId).sort()).toEqual([
        "a",
        "b",
      ]);

      // A minute on, "a" went up and a search came in: the lists show it,
      // the cached counts do not.
      vi.setSystemTime(new Date(NOW.getTime() + 60_000));
      table("declarationPublications").a = {
        ...held(),
        status: "published",
        publishedAt: at("2026-10-29T12:00:30Z"),
      };
      // Published before the counts were taken: counted there already.
      table("declarationPublications").old = {
        ...held(),
        status: "published",
        publishedAt: at("2026-10-29T11:30:00Z"),
      };
      table("declarationCandidacies").e = { status: "found", personIds: ["x"] };
      await sync();
      const second = await call<DeclarationOverview>(overviewGet, "boss,admin");
      expect(second.lists.held.map((row) => row.personId)).toEqual(["b"]);
      expect(second.candidacies.total).toBe(first.candidacies.total);
      expect(second.publications).toMatchObject({
        published: first.publications.published + 1,
        held: 1,
        heldBy: [{ reason: "two_places", count: 1 }],
      });
      // As of the lists, which are what an admin decides on.
      expect(Date.parse(second.at)).toBeGreaterThan(Date.parse(first.at));
    });
  });

  describe("countEverything", () => {
    it("counts the searches, the crops, the readers who vote and the publications", async () => {
      await sync();
      const overview = await countEverything(10);
      expect(overview.dailyLimit).toBe(10);
      expect(overview.candidacies).toEqual({
        total: 4,
        people: 2,
        byStatus: { pending: 0, found: 2, unconfirmed: 0, not_found: 2 },
        notFound: [
          { reason: "no_seed", count: 1 },
          { reason: "other", count: 1 },
        ],
      });
      expect(overview.extracts.byStatus).toMatchObject({
        disputed: 1,
        agreed: 1,
        failed: 1,
        open: 0,
      });
      expect(overview.extracts.failed).toEqual([
        { reason: "blank_form", count: 1 },
      ]);
      expect(overview.readers.answers).toBe(2);
      expect(overview.readers.readers).toBe(2);
      expect(overview.readers.days).toHaveLength(30);
      expect(overview.readers.days.at(-1)).toEqual({
        day: "2026-10-29",
        answers: 2,
        settled: 0,
      });
      expect(overview.readers.days.at(-2)).toEqual({
        day: "2026-10-28",
        answers: 0,
        settled: 1,
      });
      expect(overview.pages).toEqual({
        same: 0,
        different: 1,
        noDate: 0,
        confirmed: 0,
      });
      // Her page has no post on it, so nobody is asked about her proposal.
      expect(overview.publications).toMatchObject({
        held: 0,
        setAside: 1,
        today: 3,
        heldBy: [],
      });
    });

    describe("who waits for an admin, and who will not be published", () => {
      const hold = (
        id: string,
        reason: string,
        day: number,
        fields: Data = {},
      ) => {
        const when = at(`2026-10-${String(day).padStart(2, "0")}T10:00:00Z`);
        table("declarationPublications")[id] = {
          status: "held",
          reason,
          queuedAt: when,
          heldAt: when,
          declarations: [],
          ...fields,
        };
        table("nodes")[id] ??= { type: "person", name: id, published: false };
      };
      /** A paid post on the page, at the water company of the world below. */
      const post = (id: string) => {
        table("edges")[`${id}-job`] = {
          type: "employed",
          name: "Zarząd",
          source: id,
          target: "wodociagi",
        };
      };

      beforeEach(() => {
        table("nodes").wodociagi = { type: "place", isPublic: true };
        post("kowalska");
      });

      it("reads what becomes of a page off the page, not off why it was held", async () => {
        // Held for something else, and with no post either: the record's
        // first reason says nothing about the ones after it.
        hold("no-post", "two_places", 3);
        hold("ruled-out", "no_public_post", 4);
        // Declined: still held on the record, with the admin's no on it.
        hold("declined", "two_places", 2, {
          declinedBy: "admin",
          declinedAt: at("2026-10-27T10:00:00Z"),
        });
        await sync();
        const { publications, lists } = await countEverything(0);
        expect(publications).toMatchObject({
          held: 1,
          setAside: 3,
          heldBy: [{ reason: "pending_proposal", count: 1 }],
        });
        expect(lists.held.map((row) => row.personId)).toEqual(["kowalska"]);
        // The newest first, an admin's by when they said no.
        expect(
          lists.setAside.map((row) => [row.personId, row.status, row.reason]),
        ).toEqual([
          ["declined", "declined", "two_places"],
          ["ruled-out", "held", "no_public_post"],
          ["no-post", "held", "two_places"],
        ]);
        expect(lists.setAside[0]!.at).toBe("2026-10-27T10:00:00.000Z");
      });

      it("brings a page back the day it has a post, whatever it was held for", async () => {
        hold("gained", "no_public_post", 3);
        post("gained");
        await sync();
        const { publications, lists } = await countEverything(0);
        expect(lists.held.map((row) => row.personId)).toContain("gained");
        expect(publications.setAside).toBe(0);
        expect(
          lists.held.find((row) => row.personId === "gained"),
        ).toMatchObject({ reason: "no_public_post", paidPost: true });
      });

      it("does not count an unpaid seat, or a job at a company nobody owns", async () => {
        table("nodes").szpital = {
          type: "place",
          isPublic: true,
          supervisoryBody: "rada-spoleczna",
        };
        table("nodes").prywatna = { type: "place", isPublic: false };
        hold("seat", "two_places", 3);
        table("edges")["seat-job"] = {
          type: "employed",
          name: "Rada Nadzorcza",
          source: "seat",
          target: "szpital",
        };
        hold("private", "two_places", 4);
        table("edges")["private-job"] = {
          type: "employed",
          name: "Zarząd",
          source: "private",
          target: "prywatna",
        };
        await sync();
        const { lists } = await countEverything(0);
        expect(lists.setAside.map((row) => row.personId).sort()).toEqual([
          "private",
          "seat",
        ]);
      });

      it("leaves a public page on the list, with its hold to close", async () => {
        table("nodes").up = { type: "person", name: "Up", published: true };
        hold("up", "two_places", 3);
        await sync();
        const { lists } = await countEverything(0);
        expect(lists.held.find((row) => row.personId === "up")).toMatchObject({
          pagePublic: true,
          paidPost: false,
        });
      });

      it("lists every hold, the newest first, not the newest twenty", async () => {
        for (let day = 1; day <= 25; day++) {
          hold(
            `held-${day}`,
            day % 2 ? "two_places" : "ambiguous_candidacy",
            day,
          );
          post(`held-${day}`);
        }
        await sync();
        const { publications, lists } = await countEverything(0);
        expect(lists.held).toHaveLength(26);
        const days = lists.held.map((row) => row.at);
        expect(days).toEqual([...days].sort().reverse());
        // By how many they hold.
        expect(publications.heldBy).toEqual([
          { reason: "two_places", count: 13 },
          { reason: "ambiguous_candidacy", count: 12 },
          { reason: "pending_proposal", count: 1 },
        ]);
      });

      it("lists every hold, so none is counted where it is not shown", async () => {
        // Newer than everything that waits, and more than any cap would keep.
        for (let i = 0; i < 400; i++) {
          hold(`nopost-${i}`, "no_public_post", 28);
        }
        hold("old", "two_places", 1);
        post("old");
        // Past where a cap of 300 by id would have stopped, gaining a post.
        hold("zz-gained", "no_public_post", 27);
        post("zz-gained");
        await sync();
        const { publications, lists } = await countEverything(0);
        expect(lists.held.map((row) => row.personId)).toEqual(
          expect.arrayContaining(["old", "zz-gained"]),
        );
        expect(publications.setAside).toBe(400);
        expect(lists.setAside).toHaveLength(400);
        expect(publications.held).toBe(lists.held.length);
      });

      it("keeps a page held again where it first waited", async () => {
        hold("first", "two_places", 5);
        post("first");
        // Waited before "first", held again by a recheck since.
        hold("rechecked", "conflicting_reading", 2, {
          heldAt: at("2026-10-28T10:00:00Z"),
        });
        post("rechecked");
        await sync();
        const { lists } = await countEverything(0);
        const order = lists.held.map((row) => row.personId);
        expect(order.indexOf("first")).toBeLessThan(order.indexOf("rechecked"));
        // Shown by when it was held.
        expect(lists.held.find((row) => row.personId === "rechecked")!.at).toBe(
          "2026-10-28T10:00:00.000Z",
        );
      });

      it("leaves out the record of a page merged into another or removed", async () => {
        table("nodes").merged = { name: "M", merged_into: "kowalska" };
        hold("merged", "two_pages", 3);
        table("nodes").removed = { name: "R", deleted: true };
        hold("removed", "two_places", 4);
        await sync();
        const { lists } = await countEverything(0);
        const listed = [...lists.held, ...lists.setAside].map(
          (row) => row.personId,
        );
        expect(listed).not.toContain("merged");
        expect(listed).not.toContain("removed");
      });

      it("says which publications an admin made by hand", async () => {
        table("declarationPublications")["by-hand"] = {
          status: "published",
          reason: null,
          autoPublished: false,
          publishedAt: at("2026-10-29T09:00:00Z"),
          handPublished: { uid: "admin", held: "two_places" },
          declarations: [],
        };
        await sync();
        const { lists } = await countEverything(0);
        expect(
          lists.recent.find((row) => row.personId === "by-hand"),
        ).toMatchObject({ status: "published", byHand: true });
      });
    });

    it("reads the newest answers first, so a month past the cap leaves the oldest days short, never today", async () => {
      await sync();
      await sql`
        INSERT INTO declaration_answers (id, data)
        SELECT 'old_anon:' || i, jsonb_build_object(
          'uid', 'anon:' || i, 'counted', true, 'votes', false,
          'day', '2026-10-20', 'at', '2026-10-20T09:00:00.000Z')
        FROM generate_series(1, 20000) AS i`;
      const overview = await countEverything(0);
      expect(overview.readers.days.at(-1)).toMatchObject({
        day: "2026-10-29",
        answers: 2,
      });
    });

    it("lists what an admin decides, with the readings and the pages' dates", async () => {
      await sync();
      const { lists, runs } = await countEverything(0);
      expect(lists.disputed).toEqual([
        expect.objectContaining({
          id: "x1",
          unit: "Strzelin",
          readings: [
            { value: "1979-07-15", readers: 2 },
            { value: "1979-07-16", readers: 2 },
          ],
          unreadable: 2,
          agreed: null,
          agreedBy: null,
          people: [
            {
              id: "kowalska",
              name: "Anna Kowalska",
              published: false,
              birthDate: "1979-07-15",
            },
          ],
        }),
      ]);
      // Whose date it is, so the row does not take an admin's for the
      // readers'.
      expect(lists.different[0]).toMatchObject({
        id: "x2",
        unit: "TERYT 021704",
        agreed: "1980-01-01",
        agreedBy: "admin",
      });
      expect(lists.setAside).toEqual([
        expect.objectContaining({
          personId: "kowalska",
          name: "Anna Kowalska",
          reason: "pending_proposal",
          pagePublic: false,
          paidPost: false,
          unit: "Strzelin",
        }),
      ]);
      expect(runs.map((run) => [run.runId, run.extracts])).toEqual([
        ["run-1", 2],
        ["run-0", 1],
      ]);
    });

    it("says whose a date is, readers' or the job's, and whether a held page is public by now", async () => {
      table("declarationExtracts").x2!.agreed = {
        value: "1980-01-01",
        kind: "date",
        by: "machine",
      };
      // Published by hand while it waited.
      table("nodes").kowalska!.published = true;
      await sync();
      const { lists } = await countEverything(0);
      expect(lists.different[0]).toMatchObject({ agreedBy: "machine" });
      expect(lists.held[0]).toMatchObject({
        personId: "kowalska",
        pagePublic: true,
      });

      table("declarationExtracts").x2!.agreed = {
        value: "1980-01-01",
        kind: "date",
        by: "readers",
      };
      await sync();
      const again = await countEverything(0);
      expect(again.lists.different[0]).toMatchObject({ agreedBy: "readers" });
    });
  });

  // After an admin's press of „Opublikuj z kolejki”, which publishes past
  // the automatic daily limit and in none of its places.
  describe("countEverything, after an admin's press", () => {
    it("counts the page as published, not as today's, and says whose it is", async () => {
      table("declarationPublications").nowak = {
        status: "published",
        pressedBy: "admin-uid",
        autoPublished: false,
        publishedAt: at("2026-10-29T11:00:00Z"),
        declarations: [{ url: "https://bip.strzelin.pl/3", unit: "Strzelin" }],
      };
      await sync();
      const { publications, lists } = await countEverything(10);
      expect(publications).toMatchObject({ published: 1, today: 3 });
      expect(lists.recent).toEqual([
        expect.objectContaining({ personId: "nowak", pressed: true }),
      ]);
      expect(lists.setAside).toEqual([
        expect.objectContaining({ personId: "kowalska", pressed: false }),
      ]);
    });
  });
});
