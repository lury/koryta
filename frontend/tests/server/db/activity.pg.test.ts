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
import activityGet, {
  type ActivityStats,
} from "~~/server/api/stats/activity.get";
import {
  collectActivityEventsFromDb,
  loadActivityRollupsFromDb,
  readPublicProfilesFromDb,
} from "~~/server/db/activity";
import { activityRanges } from "~~/shared/activity";
import { DECLARATION_ACTOR } from "~~/shared/declarations";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import type { LoggedQuery } from "./queryLog";

/** The activity section on Postgres: what counts as somebody's work in a
 * window (`collectActivityEventsFromDb`), the settled days kept in
 * `activity_daily` (`loadActivityRollupsFromDb`), and /api/stats/activity
 * presenting it to each kind of reader.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/activity.pg.test.ts
 */

const { caller, getUsers, headers, queries } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  // Nitro wraps the read-and-roll-up in its cache; here it runs straight
  // through, so each test sees the rows it set up.
  g.defineCachedFunction = (fn: unknown) => fn;
  return {
    caller: { value: null as null | Record<string, unknown> },
    getUsers: {
      fn: async (_ids: unknown[]): Promise<unknown> => ({
        users: [],
        notFound: [],
      }),
    },
    headers: new Map<string, string>(),
    queries: [] as LoggedQuery[],
  };
});
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
  getValidatedQuery: async (
    event: { query?: unknown },
    parse: (q: unknown) => unknown,
  ) => parse(event.query ?? {}),
  setResponseHeader: (_event: unknown, name: string, value: string) =>
    headers.set(name, value),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUsers: (ids: unknown[]) => getUsers.fn(ids) }),
}));
vi.mock("~~/server/utils/auth", () => ({
  getOptionalUser: async () => caller.value,
}));
vi.mock("~~/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/db/client")>();
  const { logQueries } =
    await vi.importActual<typeof import("./queryLog")>("./queryLog");
  return { ...actual, useDb: () => logQueries(actual.useDb(), queries) };
});

type Doc = Record<string, unknown>;
const store = new Collections();
let sql: postgres.Sql;

const AT = "2026-08-20T10:00:00.000Z";
const WINDOW = { sinceIso: "2026-08-01T00:00:00.000Z" };

/** The events in a window over these documents, by collection. */
async function collect(
  collections: Record<string, Doc[]>,
  window: { sinceIso: string; untilIso?: string } = WINDOW,
) {
  store.clear();
  for (const [name, docs] of Object.entries(collections))
    docs.forEach((doc, i) => {
      store.table(name as never)[`doc-${i}`] = doc;
    });
  await store.sync(sql);
  return collectActivityEventsFromDb(window);
}

describe.runIf(PG_TEST_DATABASE_URL)("activity on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("activity");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    queries.length = 0;
  });

  describe("revisions", () => {
    it("counts a change somebody proposed by hand", async () => {
      expect(
        await collect({
          revisions: [
            { update_user: "anna", update_time: AT, data: { type: "person" } },
          ],
        }),
      ).toEqual([{ uid: "anna", at: AT, kind: "revision" }]);
    });

    it("drops what the ingest wrote for itself", async () => {
      expect(
        await collect({
          revisions: [
            {
              update_user: "uploader",
              update_time: AT,
              update_automatic: true,
              data: { type: "person" },
            },
          ],
        }),
      ).toEqual([]);
    });

    it("keeps counting a revision that predates the flag", async () => {
      expect(
        await collect({
          revisions: [{ update_user: "anna", update_time: AT }],
        }),
      ).toHaveLength(1);
    });

    it("drops the article node every crawl and capture leaves behind", async () => {
      // Approved in its own commit: `review_time` is `update_time`.
      expect(
        await collect({
          revisions: [
            {
              update_user: "anna",
              update_time: AT,
              update_automatic: false,
              status: "approved",
              review_time: AT,
              data: { type: "article" },
            },
            {
              update_user: "anna",
              update_time: AT,
              update_automatic: false,
              status: "pending",
              data: { type: "person" },
            },
          ],
        }),
      ).toEqual([{ uid: "anna", at: AT, kind: "revision" }]);
    });

    it("drops the article nodes written before the collection had a status", async () => {
      expect(
        await collect({
          revisions: [
            { update_user: "anna", update_time: AT, data: { type: "article" } },
          ],
        }),
      ).toEqual([]);
    });

    it("keeps an article edit somebody actually proposed", async () => {
      expect(
        await collect({
          revisions: [
            {
              update_user: "anna",
              update_time: AT,
              update_automatic: false,
              status: "pending",
              data: { type: "article" },
            },
          ],
        }),
      ).toEqual([{ uid: "anna", at: AT, kind: "revision" }]);
    });

    it("keeps an article edit an administrator later approved", async () => {
      expect(
        await collect({
          revisions: [
            {
              update_user: "anna",
              update_time: AT,
              update_automatic: false,
              status: "approved",
              review_time: "2026-08-22T09:00:00.000Z",
              data: { type: "article" },
            },
          ],
        }),
      ).toHaveLength(1);
    });
  });

  describe("notes' sources", () => {
    it("counts a note dated by its edit, one unit a source", async () => {
      // `saveNote` stamps `updatedAt`; the migration stored the Timestamps
      // as ISO text like the older string dates.
      expect(
        await collect({
          notes: [{ userUid: "anna", updatedAt: AT, sources: ["a", "b", "c"] }],
        }),
      ).toEqual([{ uid: "anna", at: AT, kind: "noteSource", count: 3 }]);
    });

    it("still counts a note dated the way `saveNote` used to", async () => {
      expect(
        await collect({
          notes: [{ userUid: "anna", createdAt: AT, sources: ["a"] }],
        }),
      ).toEqual([{ uid: "anna", at: AT, kind: "noteSource", count: 1 }]);
    });

    it("counts a note once when both its dates are in the window", async () => {
      expect(
        await collect({
          notes: [
            { userUid: "anna", createdAt: AT, updatedAt: AT, sources: ["a"] },
          ],
        }),
      ).toHaveLength(1);
    });

    it("falls back to when the note was written if it was never edited", async () => {
      const [event] = await collect({
        notes: [{ userUid: "anna", createdAt: AT, sources: ["a"] }],
      });
      expect(event?.at).toBe(AT);
    });

    it("ignores a note holding no sources", async () => {
      expect(
        await collect({
          notes: [{ userUid: "anna", updatedAt: AT, sources: [] }],
        }),
      ).toEqual([]);
    });
  });

  describe("publications", () => {
    const audit = (docs: Doc[]) => collect({ audit: docs });
    /** Rows written inside one commit, milliseconds apart. */
    const inOneCommit = (rows: Doc[]) =>
      rows.map((row, index) => ({
        ...row,
        at: `2026-08-20T10:00:00.${String(index).padStart(3, "0")}Z`,
      }));

    it("counts a published page", async () => {
      expect(
        await audit([
          { user: "admin", at: AT, action: "publish", collection: "nodes" },
        ]),
      ).toEqual([{ uid: "admin", at: AT, kind: "publication" }]);
    });

    it("counts one publication for a person, not one per relation", async () => {
      expect(
        await audit([
          { user: "admin", at: AT, action: "publish", collection: "nodes" },
          ...inOneCommit(
            Array.from({ length: 12 }, () => [
              { user: "admin", action: "approve", collection: "edges" },
              { user: "admin", action: "publish", collection: "edges" },
            ]).flat(),
          ),
        ]),
      ).toEqual([{ uid: "admin", at: AT, kind: "publication" }]);
    });

    it("ignores everything an administrator did that was not publishing a page", async () => {
      expect(
        await audit([
          { user: "admin", at: AT, action: "approve", collection: "nodes" },
          { user: "admin", at: AT, action: "reject", collection: "nodes" },
          { user: "admin", at: AT, action: "unpublish", collection: "nodes" },
          { user: "admin", at: AT, action: "delete", collection: "edges" },
          { user: "admin", at: AT, action: "publish", collection: "edges" },
        ]),
      ).toEqual([]);
    });

    it("does not fold two people's work together", async () => {
      const events = await audit([
        {
          user: "ala",
          at: AT,
          action: "publish",
          collection: "nodes",
          target_id: "n1",
        },
        {
          user: "bogdan",
          at: AT,
          action: "publish",
          collection: "nodes",
          target_id: "n1",
        },
      ]);
      expect(events.map((e) => e.uid).sort()).toEqual(["ala", "bogdan"]);
    });

    it("keeps two pages published in the same second apart", async () => {
      expect(
        await audit([
          {
            user: "admin",
            at: AT,
            action: "publish",
            collection: "nodes",
            target_id: "n1",
          },
          {
            user: "admin",
            at: AT,
            action: "publish",
            collection: "nodes",
            target_id: "n2",
          },
          {
            user: "admin",
            at: "2026-08-20T10:00:00.400Z",
            action: "publish",
            collection: "nodes",
            target_id: "n2",
          },
        ]),
      ).toHaveLength(2);
    });

    it("counts a page an admin pressed „Opublikuj z kolejki” for as the admin's", async () => {
      const events = await audit([
        {
          user: DECLARATION_ACTOR,
          pressed_by: "admin",
          at: AT,
          action: "publish",
          collection: "nodes",
          target_id: "n1",
        },
        {
          user: DECLARATION_ACTOR,
          at: AT,
          action: "publish",
          collection: "nodes",
          target_id: "n2",
        },
      ]);
      expect(events.sort((a, b) => (a.uid < b.uid ? -1 : 1))).toEqual(
        [
          { uid: "admin", at: AT, kind: "publication" },
          { uid: DECLARATION_ACTOR, at: AT, kind: "publication" },
        ].sort((a, b) => (a.uid < b.uid ? -1 : 1)),
      );
    });
  });

  describe("readings", () => {
    const answer = (fields: Doc) => ({
      extractId: "x1",
      uid: "anna",
      verdict: "date",
      value: "1970-05-12",
      votes: true,
      counted: true,
      at: AT,
      ...fields,
    });
    const readings = (answers: Doc[], window = WINDOW) =>
      collect({ declarationAnswers: answers }, window);

    it("counts every crop a reader said something about", async () => {
      expect(
        await readings([
          answer({}),
          answer({ verdict: "empty", value: null }),
          answer({ verdict: "unreadable", value: null }),
        ]),
      ).toEqual([
        { uid: "anna", at: AT, kind: "reading" },
        { uid: "anna", at: AT, kind: "reading" },
        { uid: "anna", at: AT, kind: "reading" },
      ]);
    });

    it("drops a skip, as the reader's own tally does", async () => {
      expect(
        await readings([
          answer({ verdict: "skip", value: null, counted: false }),
        ]),
      ).toEqual([]);
    });

    it("drops an answer written before `counted` was, by its verdict", async () => {
      expect(
        await readings([
          answer({ verdict: "skip", value: null, counted: undefined }),
          answer({ counted: undefined }),
        ]),
      ).toEqual([{ uid: "anna", at: AT, kind: "reading" }]);
    });

    it("leaves out a browser's answers until an account takes them over", async () => {
      expect(
        await readings([
          answer({
            uid: "anon:0b9a3f4e-2a1c-4d6b-9e8f-7a6b5c4d3e2f",
            votes: false,
          }),
        ]),
      ).toEqual([]);
    });

    it("dates a reading an account took over by the claim, not by the reading", async () => {
      const claimedAt = "2026-08-25T18:30:00.000Z";
      expect(
        await readings([
          answer({
            at: "2026-08-18T09:00:00.000Z",
            claimedFrom: "anon:0b9a3f4e-2a1c-4d6b-9e8f-7a6b5c4d3e2f",
            claimedAt,
          }),
        ]),
      ).toEqual([{ uid: "anna", at: claimedAt, kind: "reading" }]);
    });

    it("counts an answer once when both its dates are in the window", async () => {
      expect(
        await readings([answer({ claimedAt: AT })], {
          sinceIso: "2026-08-01T00:00:00.000Z",
          untilIso: "2026-08-21T00:00:00.000Z",
        }),
      ).toEqual([{ uid: "anna", at: AT, kind: "reading" }]);
    });
  });

  it("reads every collection that records an interaction, in its window only", async () => {
    const events = await collect({
      votes: [
        { userUid: "anna", updatedAt: AT, nodeId: "n1" },
        { userUid: "anna", updatedAt: AT, extractionId: "e1" },
        {
          userUid: "anna",
          updatedAt: "2026-07-01T10:00:00.000Z",
          nodeId: "n2",
        },
      ],
      notes: [{ userUid: "bob", updatedAt: AT, sources: ["a", "b"] }],
      revisions: [{ update_user: "anna", update_time: AT }],
      audit: [
        { user: "admin", at: AT, action: "publish", collection: "nodes" },
      ],
      declarationAnswers: [{ uid: "bob", verdict: "date", at: AT }],
    });
    // A rating of a person and of an extracted fact are one kind here.
    expect(events.map((event) => event.kind).sort()).toEqual([
      "noteSource",
      "publication",
      "reading",
      "revision",
      "vote",
      "vote",
    ]);
    expect(events.find((event) => event.kind === "noteSource")?.count).toBe(2);
  });

  describe("the settled days", () => {
    // Settled: the 18th and the 19th; the 20th is live at noon.
    const UNTIL = new Date("2026-08-20T12:00:00.000Z");
    const vote = (uid: string, at: string, i: number) => ({
      [`v${i}`]: { userUid: uid, updatedAt: at, nodeId: `n${i}` },
    });
    const stored = async () =>
      Object.fromEntries(
        (
          await sql<
            { id: string; data: Doc }[]
          >`SELECT id, data FROM activity_daily ORDER BY id`
        ).map((r) => [r.id, r.data]),
      );
    const load = () => loadActivityRollupsFromDb(3, UNTIL);

    it("reads a stored day instead of counting it again", async () => {
      store.table("activityDaily")["2026-08-19"] = {
        version: 5,
        date: "2026-08-19",
        totals: { vote: 4 },
        truncated: [],
        contributors: {
          anna: { vote: 4, lastActiveAt: "2026-08-19T20:00:00.000Z" },
        },
      };
      Object.assign(
        store.table("votes"),
        vote("anna", "2026-08-19T09:00:00.000Z", 1),
      );
      await store.sync(sql);
      const { rollups } = await load();
      const day = rollups.find((r) => r.date === "2026-08-19")!;
      expect(day.totals.vote).toBe(4);
      expect(day.contributors.anna).toMatchObject({
        lastActiveAt: "2026-08-19T20:00:00.000Z",
      });
    });

    it("counts a missing day, stores it, and does not count it twice", async () => {
      Object.assign(
        store.table("votes"),
        vote("anna", "2026-08-19T09:00:00.000Z", 1),
      );
      await store.sync(sql);
      await load();
      expect(Object.keys(await stored())).toEqual(["2026-08-18", "2026-08-19"]);
      await sql`DELETE FROM votes`;
      const { rollups } = await load();
      expect(rollups.find((r) => r.date === "2026-08-19")!.totals.vote).toBe(1);
    });

    it("counts a run of missing days, each on its own day, today live and never stored", async () => {
      Object.assign(
        store.table("votes"),
        vote("anna", "2026-08-18T09:00:00.000Z", 1),
        vote("anna", "2026-08-19T09:00:00.000Z", 2),
        vote("anna", "2026-08-19T10:00:00.000Z", 3),
        vote("anna", "2026-08-20T09:00:00.000Z", 4),
      );
      await store.sync(sql);
      const { spanned, rollups } = await load();
      expect(spanned).toEqual(["2026-08-18", "2026-08-19", "2026-08-20"]);
      expect(rollups.map((r) => [r.date, r.totals.vote])).toEqual([
        ["2026-08-18", 1],
        ["2026-08-19", 2],
        ["2026-08-20", 1],
      ]);
      expect(Object.keys(await stored())).not.toContain("2026-08-20");
    });

    it("stores the automation's publications only where there are any, and reads them back", async () => {
      store.table("audit").a1 = {
        user: DECLARATION_ACTOR,
        at: "2026-08-18T09:00:00.000Z",
        action: "publish",
        collection: "nodes",
        target_id: "n1",
      };
      Object.assign(
        store.table("votes"),
        vote("anna", "2026-08-19T09:00:00.000Z", 1),
      );
      await store.sync(sql);
      await load();
      const days = await stored();
      expect(days["2026-08-18"]).toMatchObject({ version: 5, automatic: 1 });
      expect(days["2026-08-19"]).not.toHaveProperty("automatic");
      await sql`DELETE FROM audit`;
      const { rollups } = await load();
      expect(rollups.slice(0, 2).map((r) => r.automatic)).toEqual([1, 0]);
    });

    it("recounts a day that was stored under an older counting rule", async () => {
      store.table("activityDaily")["2026-08-19"] = {
        version: 1,
        date: "2026-08-19",
        totals: { revision: 999 },
        contributors: {},
        truncated: [],
      };
      store.table("revisions").r1 = {
        update_user: "anna",
        update_time: "2026-08-19T09:00:00.000Z",
      };
      await store.sync(sql);
      const { rollups } = await load();
      expect(
        rollups.find((r) => r.date === "2026-08-19")!.totals.revision,
      ).toBe(1);
      expect((await stored())["2026-08-19"]).toMatchObject({ version: 5 });
    });

    it("still answers when it cannot store what it counted", async () => {
      Object.assign(
        store.table("votes"),
        vote("anna", "2026-08-19T09:00:00.000Z", 1),
      );
      await store.sync(sql);
      await sql`CREATE OR REPLACE FUNCTION refuse_rollup() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'read only'; END $$`;
      await sql`CREATE TRIGGER refuse_rollup BEFORE INSERT ON activity_daily
        FOR EACH ROW EXECUTE FUNCTION refuse_rollup()`;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { rollups } = await load();
        expect(rollups.find((r) => r.date === "2026-08-19")!.totals.vote).toBe(
          1,
        );
        expect(error).toHaveBeenCalled();
      } finally {
        error.mockRestore();
        await sql`DROP TRIGGER refuse_rollup ON activity_daily`;
      }
    });

    it("asks for nothing stored when the window has no finished days", async () => {
      await store.sync(sql);
      const { rollups } = await loadActivityRollupsFromDb(1, UNTIL);
      expect(rollups.map((r) => r.date)).toEqual(["2026-08-20"]);
      expect(await stored()).toEqual({});
    });

    it("passes on the kinds a stored day says were cut short", async () => {
      store.table("activityDaily")["2026-08-19"] = {
        version: 5,
        date: "2026-08-19",
        totals: {},
        contributors: {},
        truncated: ["vote"],
      };
      await store.sync(sql);
      const { rollups } = await load();
      expect(rollups.find((r) => r.date === "2026-08-19")!.truncated).toEqual([
        "vote",
      ]);
    });
  });

  describe("readPublicProfilesFromDb", () => {
    it("names only those who turned the setting on", async () => {
      store.table("users").on = { publicProfile: true };
      store.table("users").off = { publicProfile: false };
      store.table("users").unset = { newsletter: { recentPeople: true } };
      await store.sync(sql);
      expect(
        await readPublicProfilesFromDb(["on", "off", "unset", "gone"]),
      ).toEqual({
        on: true,
        off: false,
        unset: false,
        gone: false,
      });
    });

    it("reads the one field and nothing else of an owner-writable document", async () => {
      await store.sync(sql);
      queries.length = 0;
      await readPublicProfilesFromDb(["a"]);
      expect(queries).toHaveLength(1);
      expect(queries[0]!.text).toMatch(/data -> 'publicProfile'/);
      expect(queries[0]!.text).not.toMatch(/SELECT\s+(id,\s*)?data\s*(,|FROM)/);
    });

    it("reads nothing for nobody, and everybody asked in one query", async () => {
      await store.sync(sql);
      queries.length = 0;
      expect(await readPublicProfilesFromDb([])).toEqual({});
      expect(queries).toHaveLength(0);
      await readPublicProfilesFromDb(
        Array.from({ length: 301 }, (_, i) => `u${i}`),
      );
      expect(queries).toHaveLength(1);
    });
  });

  describe("GET /api/stats/activity", () => {
    /** Now, so the events land inside whatever window the handler computes. */
    const today = () => new Date().toISOString();
    let n = 0;
    /** Rows that stand for these events, today. */
    const events = (list: [uid: string, kind: string][]) => {
      for (const [uid, kind] of list) {
        const id = `e${n++}`;
        const at = today();
        if (kind === "vote")
          store.table("votes")[id] = {
            userUid: uid,
            updatedAt: at,
            nodeId: id,
          };
        if (kind === "revision")
          store.table("revisions")[id] = { update_user: uid, update_time: at };
        if (kind === "reading")
          store.table("declarationAnswers")[id] = { uid, verdict: "date", at };
        if (kind === "publication")
          store.table("audit")[id] = {
            user: uid,
            at,
            action: "publish",
            collection: "nodes",
            target_id: id,
          };
      }
    };
    const call = async (query: Record<string, unknown> = {}) => {
      await store.sync(sql);
      return (activityGet as unknown as (e: unknown) => Promise<ActivityStats>)(
        { query },
      );
    };

    beforeEach(() => {
      headers.clear();
      caller.value = null;
      events([
        ["busy", "vote"],
        ["busy", "vote"],
        ["busy", "revision"],
        ["quiet", "vote"],
      ]);
      getUsers.fn = async () => ({
        users: [
          {
            uid: "busy",
            displayName: "Anna Nowak",
            email: "anna@example.com",
            photoURL: "https://example.com/anna.png",
          },
          {
            uid: "quiet",
            displayName: "Bartosz Lis",
            email: "bartosz@example.com",
            photoURL: null,
          },
        ],
        notFound: [],
      });
    });
    /** Only these events, none of the default ones. */
    const only = (list: [string, string][]) => {
      store.clear();
      events(list);
    };

    it("gives an anonymous caller the ranking with every name masked", async () => {
      const result = await call();
      expect(result.identified).toBe(false);
      expect(result.contributorCount).toBe(2);
      expect(result.rankings.changes.rows.map((c) => c.name)).toEqual([
        "A•••••",
        "B•••••",
      ]);
      expect(result.rankings.changes.rows.filter((c) => c.named)).toEqual([]);
      expect(result.rankings.changes.self).toBeNull();
      expect(result.totals.vote).toBe(3);
      expect(result.total).toBe(4);
    });

    it("sends a stranger no uid, address, avatar or real name", async () => {
      const result = await call();
      expect(result.rankings.changes.rows.every((c) => c.uid === null)).toBe(
        true,
      );
      expect(result.rankings.changes.rows.every((c) => c.email === null)).toBe(
        true,
      );
      expect(
        result.rankings.changes.rows.every((c) => c.photoURL === null),
      ).toBe(true);
      const body = JSON.stringify(result);
      for (const secret of [
        "busy",
        "quiet",
        "Anna Nowak",
        "anna@example.com",
        "Bartosz Lis",
        "anna.png",
      ])
        expect(body).not.toContain(secret);
    });

    it("names the contributors who asked to be named", async () => {
      store.table("users").busy = { publicProfile: true };
      const result = await call();
      expect(result.rankings.changes.rows[0]).toMatchObject({
        name: "Anna Nowak",
        named: true,
        uid: null,
        email: null,
        photoURL: "https://example.com/anna.png",
      });
      expect(result.rankings.changes.rows[1]).toMatchObject({
        name: "B•••••",
        named: false,
      });
    });

    it("still withholds a name that was never turned on", async () => {
      store.table("users").busy = { publicProfile: false };
      store.table("users").quiet = { newsletter: { recentPeople: true } };
      const result = await call();
      expect(result.rankings.changes.rows.map((c) => c.named)).toEqual([
        false,
        false,
      ]);
    });

    it("shows a signed-in reader their own row and where they stand", async () => {
      caller.value = { uid: "quiet" };
      const result = await call();
      expect(result.rankings.changes.rows[1]).toMatchObject({
        name: "Bartosz Lis",
        named: true,
        isSelf: true,
      });
      expect(result.rankings.changes.rows[0]).toMatchObject({
        name: "A•••••",
        isSelf: false,
      });
      expect(result.rankings.changes.self).toEqual({ rank: 2, total: 1 });
    });

    it("tells a reader whether anybody else sees the name on their own row", async () => {
      caller.value = { uid: "quiet" };
      const hidden = await call();
      expect(hidden.rankings.changes.rows[1]).toMatchObject({
        named: true,
        isSelf: true,
        publicName: false,
      });
      expect(hidden.rankings.changes.rows[0]).not.toHaveProperty("publicName");
      store.table("users").quiet = { publicProfile: true };
      const shown = await call();
      expect(shown.rankings.changes.rows[1]).toMatchObject({
        publicName: true,
      });
    });

    it("does not tell a signed-out reader about anybody's setting", async () => {
      store.table("users").busy = { publicProfile: true };
      const result = await call();
      expect(result.rankings.changes.rows.some((c) => "publicName" in c)).toBe(
        false,
      );
    });

    it("still hands a signed-in non-admin no uids", async () => {
      caller.value = { uid: "quiet" };
      const result = await call();
      expect(result.rankings.changes.rows.every((c) => c.uid === null)).toBe(
        true,
      );
      expect(result.identified).toBe(false);
    });

    it("places a reader who did nothing nowhere", async () => {
      caller.value = { uid: "newcomer" };
      const result = await call();
      expect(result.rankings.changes.self).toBeNull();
      expect(result.rankings.readings.self).toBeNull();
    });

    it("ranks, names and identifies every contributor for an admin", async () => {
      caller.value = { uid: "admin-1", admin: true };
      const result = await call();
      expect(result.identified).toBe(true);
      expect(result.rankings.changes.rows.map((c) => c.uid)).toEqual([
        "busy",
        "quiet",
      ]);
      expect(result.rankings.changes.rows[0]).toMatchObject({
        name: "Anna Nowak",
        email: "anna@example.com",
        total: 3,
        counts: expect.objectContaining({ vote: 2, revision: 1 }),
      });
    });

    it("keeps a uid the auth service has forgotten in the ranking", async () => {
      caller.value = { uid: "admin-1", admin: true };
      getUsers.fn = async () => ({ users: [], notFound: [{ uid: "busy" }] });
      const result = await call();
      expect(result.rankings.changes.rows[0]).toMatchObject({
        uid: "busy",
        total: 3,
      });
      expect(result.rankings.changes.rows[0]!.name).toBe("Uczestnik #1");
    });

    it("marks a signed-in caller's response uncacheable, since it names them", async () => {
      caller.value = { uid: "quiet" };
      await call();
      expect(headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("leaves an anonymous response cacheable", async () => {
      await call();
      expect(headers.has("Cache-Control")).toBe(false);
    });

    it("defaults to 30 days and honours an explicit range", async () => {
      expect((await call()).window.days).toBe(30);
      expect((await call({ days: "7" })).window.days).toBe(7);
      expect((await call({ days: "7" })).daily).toHaveLength(7);
    });

    it("stores the settled days and reads the tail of the window live", async () => {
      const result = await call({ days: "7" });
      const spanned = result.daily.map((day) => day.date);
      const settled = (
        await sql<{ id: string }[]>`SELECT id FROM activity_daily ORDER BY id`
      ).map((r) => r.id);
      // Yesterday joins them six hours after it ends, so the count depends
      // on the hour: the stored days are a prefix of the window, today never.
      expect(settled.length).toBeGreaterThanOrEqual(spanned.length - 2);
      expect(settled.length).toBeLessThanOrEqual(spanned.length - 1);
      expect(settled).toEqual(spanned.slice(0, settled.length));
      // Today's events count although nothing stored them.
      expect(result.totals.vote).toBe(3);
    });

    it("answers only for the ranges the page offers", async () => {
      for (const days of activityRanges)
        expect((await call({ days: String(days) })).window.days).toBe(days);
    });

    it("refuses any other range", async () => {
      for (const days of ["0", "1", "45", "365", "3650", "nie"])
        await expect(call({ days })).rejects.toThrow();
    });

    it("ranks the readings on /oswiadczenia apart from the changes", async () => {
      caller.value = { uid: "admin-1", admin: true };
      only([
        ["busy", "vote"],
        ["busy", "reading"],
        ["reader", "reading"],
        ["reader", "reading"],
        ["reader", "reading"],
      ]);
      getUsers.fn = async () => ({
        users: [
          { uid: "busy", displayName: "Anna Nowak", email: "a@example.com" },
          {
            uid: "reader",
            displayName: "Celina Wrona",
            email: "c@example.com",
          },
        ],
        notFound: [],
      });
      const result = await call();
      expect(result.rankings.changes.rows.map((c) => [c.uid, c.total])).toEqual(
        [["busy", 1]],
      );
      expect(result.rankings.changes.count).toBe(1);
      expect(
        result.rankings.readings.rows.map((c) => [c.uid, c.total]),
      ).toEqual([
        ["reader", 3],
        ["busy", 1],
      ]);
      expect(result.rankings.readings.count).toBe(2);
      expect(result.rankings.readings.rows[0]!.name).toBe("Celina Wrona");
      expect(result.contributorCount).toBe(2);
    });

    it("places a reader in each ranking by that ranking's own count", async () => {
      caller.value = { uid: "quiet" };
      only([
        ["busy", "vote"],
        ["busy", "vote"],
        ["quiet", "revision"],
        ["quiet", "reading"],
        ["quiet", "reading"],
      ]);
      const result = await call();
      expect(result.rankings.changes.self).toEqual({ rank: 2, total: 1 });
      expect(result.rankings.readings.self).toEqual({ rank: 1, total: 2 });
    });

    it("sends what the declarations' automation published apart, in no total and no row", async () => {
      only([
        [DECLARATION_ACTOR, "publication"],
        [DECLARATION_ACTOR, "publication"],
        ["busy", "publication"],
      ]);
      const result = await call();
      expect(result.automatic).toBe(2);
      expect(result.daily.at(-1)?.automatic).toBe(2);
      expect(result.totals.publication).toBe(1);
      expect(result.total).toBe(1);
      expect(result.contributorCount).toBe(1);
    });
  });
});
