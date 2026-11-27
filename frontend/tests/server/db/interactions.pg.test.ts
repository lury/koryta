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
import {
  nameVotes,
  scanMyVotes,
  VOTES_SCAN_CAP,
} from "~~/server/utils/myVotes";
import mineGet, {
  type MyInteractions,
} from "~~/server/api/interactions/mine.get";
import {
  callAs,
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";
import { planOf, type LoggedQuery } from "./queryLog";
import { textArray } from "~~/server/db/textArray";

/** One person's votes on /profil (server/utils/myVotes.ts over
 * server/db/interactions.ts), and GET /api/interactions/mine on Postgres.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/interactions.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
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
const { queries } = vi.hoisted(() => ({ queries: [] as LoggedQuery[] }));
// Every query the code sends, logged: which ones a call made, and their plans.
vi.mock("~~/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/db/client")>();
  const { logQueries } =
    await vi.importActual<typeof import("./queryLog")>("./queryLog");
  return { ...actual, useDb: () => logQueries(actual.useDb(), queries) };
});
vi.mock("firebase-functions/logger", () => ({ logger: { error: vi.fn() } }));

type Data = Record<string, unknown>;

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

/** A vote by `uid` on a person, `hoursAgo` before noon on 2026-11-20. */
const vote = (
  nodeId: string,
  value: number,
  hoursAgo: number,
  over: Data = {},
  uid = "me",
) => {
  table("votes")[`${nodeId}_${uid}`] = {
    nodeId,
    userUid: uid,
    categoryVotes: { interesting: value },
    updatedAt: new Date(
      Date.UTC(2026, 10, 20, 12) - hoursAgo * 3_600_000,
    ).toISOString(),
    ...over,
  };
};

describe.runIf(PG_TEST_DATABASE_URL)("one person's record on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("interactions");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    queries.length = 0;
  });

  describe("scanMyVotes", () => {
    it("reads one user's votes on people, newest first", async () => {
      vote("anna", 3, 5);
      vote("jan", -2, 1);
      vote("jan", 5, 0.5, {}, "other");
      await store.sync(sql);

      expect(await scanMyVotes("me")).toEqual({
        votes: [
          { nodeId: "jan", value: -2, updatedAt: "2026-11-20T11:00:00.000Z" },
          { nodeId: "anna", value: 3, updatedAt: "2026-11-20T07:00:00.000Z" },
        ],
        truncated: false,
      });
    });

    it("leaves out a rated fact, a vote taken back and a vote in another category", async () => {
      vote("anna", 3, 5);
      vote("jan", 0, 2);
      vote("ewa", 0, 3, { categoryVotes: { quality: 1 } });
      table("votes")["fact-1_me"] = {
        extractionId: "fact-1",
        userUid: "me",
        categoryVotes: { interesting: 2 },
        updatedAt: "2026-11-20T11:59:00.000Z",
      };
      await store.sync(sql);

      expect((await scanMyVotes("me")).votes.map((r) => r.nodeId)).toEqual([
        "anna",
      ]);
    });

    it("orders votes of the same instant by page", async () => {
      vote("b", 1, 1);
      vote("a", 1, 1);
      await store.sync(sql);

      expect((await scanMyVotes("me")).votes.map((r) => r.nodeId)).toEqual([
        "a",
        "b",
      ]);
    });

    it("reads one user's votes through the index on their uid", async () => {
      vote("anna", 3, 5);
      await store.sync(sql);
      await scanMyVotes("me");

      expect(queries).toHaveLength(1);
      expect(await planOf(sql, queries[0]!)).toMatch(/votes_user/);
    });

    it("says when the scan stopped at its cap", async () => {
      for (let i = 0; i < VOTES_SCAN_CAP; i++) vote(`p${i}`, 1, i / 100);
      // Past the cap, so never read: the oldest.
      vote("oldest", 1, 1_000);
      await store.sync(sql);

      const scanned = await scanMyVotes("me");
      expect(scanned.truncated).toBe(true);
      expect(scanned.votes).toHaveLength(VOTES_SCAN_CAP);
      expect(scanned.votes.some((r) => r.nodeId === "oldest")).toBe(false);
    });
  });

  describe("nameVotes", () => {
    it("names the people voted on and links their pages, a gone one without either", async () => {
      table("nodes").anna = { name: "Anna Nowak", type: "person" };
      table("nodes").blank = { name: "  ", type: "person" };
      await store.sync(sql);

      expect(
        await nameVotes([
          { nodeId: "anna", value: 3, updatedAt: "2026-11-20T07:00:00.000Z" },
          { nodeId: "gone", value: 2, updatedAt: "2026-11-20T06:00:00.000Z" },
          { nodeId: "blank", value: 1, updatedAt: "2026-11-20T05:00:00.000Z" },
        ]),
      ).toEqual([
        {
          nodeId: "anna",
          name: "Anna Nowak",
          path: "/osoba/anna-nowak-anna",
          value: 3,
          updatedAt: "2026-11-20T07:00:00.000Z",
        },
        {
          nodeId: "gone",
          name: null,
          path: null,
          value: 2,
          updatedAt: "2026-11-20T06:00:00.000Z",
        },
        {
          nodeId: "blank",
          name: null,
          path: null,
          value: 1,
          updatedAt: "2026-11-20T05:00:00.000Z",
        },
      ]);
    });

    it("reads the name and type of each page voted on, once", async () => {
      table("nodes").anna = { name: "Anna Nowak", type: "person" };
      await store.sync(sql);
      await nameVotes([
        { nodeId: "anna", value: 3, updatedAt: "2026-11-20T07:00:00.000Z" },
        { nodeId: "anna", value: 1, updatedAt: "2026-11-19T07:00:00.000Z" },
      ]);

      expect(queries).toHaveLength(1);
      expect(queries[0]!.args).toEqual([textArray(["anna"])]);
      // Only the two fields the row reads, not the whole document.
      expect(queries[0]!.text).toMatch(/data -> 'name'.*data -> 'type'/s);
      expect(queries[0]!.text).not.toMatch(/SELECT\s+(id,\s*)?data\s*(,|FROM)/);
    });

    it("reads nothing for a page with no votes on it", async () => {
      expect(await nameVotes([])).toEqual([]);
      expect(queries).toEqual([]);
    });
  });

  describe("GET /api/interactions/mine", () => {
    const mine = (as: string | undefined, query: Record<string, string> = {}) =>
      callAs<MyInteractions>(mineGet, as, { query });

    beforeEach(() => {
      table("nodes").anna = { name: "Anna Nowak", type: "person" };
      vote("anna", 3, 5);
      vote("anna", 4, 1, {}, "other");
    });

    it("turns away a reader who is not signed in", async () => {
      await store.sync(sql);
      expect(await statusOf(mine(undefined))).toBe(401);
    });

    it("answers the record of the uid on the token, votes named, newest first", async () => {
      await store.sync(sql);
      const answer = await mine("me");

      expect(answer.items).toHaveLength(1);
      expect(answer.items[0]).toEqual({
        kind: "vote",
        at: "2026-11-20T07:00:00.000Z",
        vote: {
          nodeId: "anna",
          name: "Anna Nowak",
          path: "/osoba/anna-nowak-anna",
          value: 3,
          updatedAt: "2026-11-20T07:00:00.000Z",
        },
      });
      expect(answer.counts.votes).toBe(1);
      expect(answer.truncated).toEqual({ proposals: false, votes: false });
      expect(answer.votesFailed).toBeUndefined();

      const theirs = await mine("other", { filter: "votes" });
      expect(theirs.items.map((item) => item.kind)).toEqual(["vote"]);
      expect(theirs.items[0]).toMatchObject({ vote: { value: 4 } });
      expect(theirs.total).toBe(1);
    });

    it("merges the uid's own proposals, read from revisions, with their votes", async () => {
      const proposal = (
        id: string,
        user: string,
        at: string,
        over: Data = {},
      ) => {
        table("revisions")[id] = {
          node_id: "anna",
          collection: "nodes",
          data: { name: "Anna Nowak", type: "person", content: "Nowy opis." },
          status: "pending",
          update_time: at,
          update_user: user,
          update_automatic: false,
          ...over,
        };
      };
      proposal("mine-new", "me", "2026-11-20T09:00:00.000Z");
      proposal("mine-old", "me", "2026-11-20T03:00:00.000Z", {
        status: "rejected",
      });
      proposal("mine-robot", "me", "2026-11-20T10:00:00.000Z", {
        update_automatic: true,
      });
      proposal("theirs", "other", "2026-11-20T08:00:00.000Z");
      await store.sync(sql);

      const answer = await mine("me");
      expect(
        answer.items.map((item) =>
          item.kind === "vote"
            ? `vote:${item.vote.nodeId}`
            : `proposal:${item.proposal.id}`,
        ),
      ).toEqual(["proposal:mine-new", "vote:anna", "proposal:mine-old"]);
      expect(answer.counts).toMatchObject({
        pending: 1,
        rejected: 1,
        votes: 1,
      });
      expect(answer.total).toBe(3);

      const rejected = await mine("me", { filter: "rejected" });
      expect(
        rejected.items.map(
          (item) => item.kind === "proposal" && item.proposal.id,
        ),
      ).toEqual(["mine-old"]);
    });
  });
});
