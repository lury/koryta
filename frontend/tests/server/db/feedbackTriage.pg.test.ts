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
import { isDeepStrictEqual } from "node:util";
import handler from "~~/server/api/feedback/admin.post";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** /api/feedback/admin on Postgres: an admin's triage of a report, written
 * field by field, and the renumbered queue in the same transaction.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/feedbackTriage.pg.test.ts
 */

const { mockGetUser } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);
  return { mockGetUser: vi.fn() };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => parser(event.body),
  };
});

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

let sql: postgres.Sql;

const { queries } = vi.hoisted(() => ({ queries: [] as LoggedQuery[] }));
// Every query the handler sends, logged: which tables a call read.
vi.mock("~~/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/db/client")>();
  const { logQueries } =
    await vi.importActual<typeof import("./queryLog")>("./queryLog");
  // Statements inside a transaction are logged too.
  const logged = (sql: ReturnType<typeof actual.useDb>) =>
    new Proxy(logQueries(sql, queries), {
      get(target, key, receiver) {
        if (key !== "begin") return Reflect.get(target, key, receiver);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (...args: any[]) => {
          const fn = args.pop();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (sql.begin as any)(...args, (tx: any) =>
            fn(logQueries(tx, queries)),
          );
        };
      },
    });
  return { ...actual, useDb: () => logged(actual.useDb()) };
});

/** The queries the call sent to `table`. */
const queriesOf = (table: string) =>
  queries.filter((query) => new RegExp(`FROM ${table}\\b`).test(query.text));

/** Writes `stored` to the tables and starts the query log afresh. */
async function arrange(stored: StoredDocs) {
  await syncStored(sql, stored);
  queries.length = 0;
}

/** Opens this file's database; run inside the describe. */
function useDatabase() {
  beforeAll(async () => {
    sql = await openTestDatabase("feedback_triage");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}

type Report = Record<string, unknown>;

/** A report as arranged: queued at `queueRank`, with a note. */
const report = (n: number): Report => ({
  kind: "bug",
  message: `Zgłoszenie ${n}`,
  context: { route: "/" },
  createdAt: `2026-11-0${n}T10:00:00.000Z`,
  adminStatus: "new",
  adminNote: "stara notatka",
  queueRank: n * 100,
});

let arranged: StoredDocs = {};

async function callHandler(body: Record<string, unknown>) {
  await arrange(arranged);
  return (handler as unknown as (event: unknown) => Promise<unknown>)({ body });
}

/** Every report as stored now, by id. */
async function reports(): Promise<Record<string, Report>> {
  const rows = await sql<{ id: string; data: Report }[]>`
    SELECT id, data FROM feedback ORDER BY id`;
  return Object.fromEntries(rows.map((row) => [row.id, row.data]));
}

/** What the call changed on report `id`: each field that moved, a removed
 * one as `REMOVED`. */
const REMOVED = "(removed)";
async function written(id = "fb-1"): Promise<Report> {
  const before = arranged[`feedback/${id}`] ?? {};
  const after = (await reports())[id] ?? {};
  const changes: Report = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(key in after)) changes[key] = REMOVED;
    else if (!isDeepStrictEqual(before[key], after[key]))
      changes[key] = after[key];
  }
  return changes;
}

/** Whether every report is as it was arranged. */
async function untouched(): Promise<boolean> {
  const now = await reports();
  return Object.entries(arranged).every(([path, data]) =>
    isDeepStrictEqual(now[path.slice("feedback/".length)], data),
  );
}

describe.runIf(PG_TEST_DATABASE_URL)(
  "POST /api/feedback/admin on Postgres",
  () => {
    useDatabase();

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
      arranged = Object.fromEntries(
        [1, 2, 3, 4].map((n) => [`feedback/fb-${n}`, report(n)]),
      );
    });

    describe("who may triage", () => {
      it("rejects callers without the admin claim", async () => {
        mockGetUser.mockResolvedValue({ uid: "user-1" });

        await expect(
          callHandler({ id: "fb-1", queueRank: 5 }),
        ).rejects.toMatchObject({ statusCode: 403 });
        // Refused before anything is read, let alone written.
        expect(queriesOf("feedback")).toEqual([]);
        expect(await untouched()).toBe(true);
      });

      it("rejects a stray newAdmin claim without admin", async () => {
        // A trial that ended by dropping `admin` can leave `newAdmin` behind; on
        // its own it grants nothing.
        mockGetUser.mockResolvedValue({ uid: "ex-trial", newAdmin: true });

        await expect(
          callHandler({ id: "fb-1", adminStatus: "resolved" }),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(await untouched()).toBe(true);
      });

      it("lets an administrator on trial work the queue", async () => {
        // Trial admins carry `newAdmin` alongside `admin`. They see less of the
        // activity feed, but the feedback queue is theirs to work like anyone's.
        mockGetUser.mockResolvedValue({
          uid: "trial-1",
          admin: true,
          newAdmin: true,
        });

        await expect(
          callHandler({ id: "fb-1", queueRank: 5 }),
        ).resolves.toEqual({
          ok: true,
        });
        expect(await written()).toEqual({ queueRank: 5 });
      });

      it("passes an authentication failure through untouched", async () => {
        mockGetUser.mockRejectedValue(
          Object.assign(new Error("brak tokenu"), { statusCode: 401 }),
        );

        await expect(
          callHandler({ id: "fb-1", queueRank: 5 }),
        ).rejects.toMatchObject({ statusCode: 401 });
        expect(await untouched()).toBe(true);
      });
    });

    describe("queueRank", () => {
      it("writes exactly the rank it was sent", async () => {
        const result = await callHandler({ id: "fb-1", queueRank: 5 });

        expect(result).toEqual({ ok: true });
        // Nothing but the rank: a status or note somebody else set in the
        // meantime must survive the move.
        expect(await written()).toEqual({ queueRank: 5 });
        expect(await written("fb-2")).toEqual({});
      });

      it("deletes the field when the rank is null", async () => {
        await callHandler({ id: "fb-1", queueRank: null });

        // Taking a report out of the queue removes the field rather than storing
        // null, so "absent" stays the one way to say "not queued".
        expect(await written()).toEqual({ queueRank: REMOVED });
      });

      // Ranks are midpoints between neighbours, so a report dropped above the
      // first one goes below zero and one dropped between two lands on a
      // fraction.
      it.each([0, -1, -3, 0.5, -0.25, 1.5 * 1024, 1e-9, -1e12])(
        "accepts the rank %s",
        async (queueRank) => {
          await callHandler({ id: "fb-1", queueRank });

          expect(await written()).toEqual({ queueRank });
        },
      );

      it.each([
        ["NaN", Number.NaN],
        ["Infinity", Number.POSITIVE_INFINITY],
        ["-Infinity", Number.NEGATIVE_INFINITY],
        ["a numeric string", "5"],
        ["an empty string", ""],
        ["a boolean", true],
        ["an object", { value: 5 }],
      ])("refuses %s as a rank", async (_label, queueRank) => {
        // A rank that does not compare like a number would scramble the order
        // of every report around it.
        await expect(callHandler({ id: "fb-1", queueRank })).rejects.toThrow();

        expect(queriesOf("feedback")).toEqual([]);
        expect(await untouched()).toBe(true);
      });

      it("writes the rank and the status together when both are sent", async () => {
        await callHandler({
          id: "fb-1",
          adminStatus: "in_progress",
          queueRank: 2,
        });

        expect(await written()).toEqual({
          adminStatus: "in_progress",
          queueRank: 2,
        });
      });

      it("leaves the rank alone on a status change", async () => {
        await callHandler({ id: "fb-1", adminStatus: "resolved" });

        // Closing a report must not pull it out of (or put it into) the queue;
        // the page decides that separately.
        expect(await written()).toEqual({ adminStatus: "resolved" });
      });

      it("leaves the rank alone on a note change", async () => {
        await callHandler({ id: "fb-1", adminNote: "sprawdzić w KRS" });

        expect(await written()).toEqual({ adminNote: "sprawdzić w KRS" });
      });
    });

    describe("the report", () => {
      it("404s on a report that is not there", async () => {
        await expect(
          callHandler({ id: "fb-gone", queueRank: 5 }),
        ).rejects.toMatchObject({ statusCode: 404 });
        expect(await untouched()).toBe(true);
      });

      it("refuses a body without an id", async () => {
        await expect(callHandler({ queueRank: 5 })).rejects.toThrow();
        await expect(callHandler({ id: "", queueRank: 5 })).rejects.toThrow();

        expect(await untouched()).toBe(true);
      });

      it("does not write at all when nothing was sent", async () => {
        const result = await callHandler({ id: "fb-1" });

        expect(result).toEqual({ ok: true });
        expect(queries.filter((q) => /UPDATE feedback/.test(q.text))).toEqual(
          [],
        );
        expect(await untouched()).toBe(true);
      });

      it("refuses a status it does not know", async () => {
        await expect(
          callHandler({ id: "fb-1", adminStatus: "done" }),
        ).rejects.toThrow();

        expect(await untouched()).toBe(true);
      });
    });

    describe("renumber", () => {
      // What the page sends when a report is dropped where the neighbours have
      // no gap left: the move plus the rest of the queue spaced out again.
      const spacedOut = [
        { id: "fb-2", queueRank: 1024 },
        { id: "fb-3", queueRank: 2048 },
        { id: "fb-4", queueRank: 3072 },
      ];

      it("writes the move and every renumbered report in one batch", async () => {
        const result = await callHandler({
          id: "fb-1",
          queueRank: 1536,
          renumber: spacedOut,
        });

        expect(result).toEqual({ ok: true });
        expect(await written("fb-2")).toEqual({ queueRank: 1024 });
        expect(await written("fb-3")).toEqual({ queueRank: 2048 });
        expect(await written("fb-4")).toEqual({ queueRank: 3072 });
        expect(await written("fb-1")).toEqual({ queueRank: 1536 });
      });

      it("puts a status sent along into the batched write of the report", async () => {
        await callHandler({
          id: "fb-1",
          adminStatus: "in_progress",
          queueRank: 1536,
          renumber: spacedOut,
        });

        expect(await written("fb-1")).toEqual({
          adminStatus: "in_progress",
          queueRank: 1536,
        });
        // One write for the report, not one per field.
        expect(
          queries.filter(
            (q) => /UPDATE feedback/.test(q.text) && q.args.includes("fb-1"),
          ),
        ).toHaveLength(1);
      });

      it("falls back to a plain update when renumber is empty", async () => {
        await callHandler({ id: "fb-1", queueRank: 1536, renumber: [] });

        expect(await written()).toEqual({ queueRank: 1536 });
        expect(await written("fb-2")).toEqual({});
      });

      it.each([
        ["a NaN rank", { id: "fb-2", queueRank: Number.NaN }],
        [
          "an Infinity rank",
          { id: "fb-2", queueRank: Number.POSITIVE_INFINITY },
        ],
        [
          "a -Infinity rank",
          { id: "fb-2", queueRank: Number.NEGATIVE_INFINITY },
        ],
        ["a string rank", { id: "fb-2", queueRank: "1024" }],
        ["a null rank", { id: "fb-2", queueRank: null }],
        ["a missing rank", { id: "fb-2" }],
        ["an empty id", { id: "", queueRank: 1024 }],
        ["a missing id", { queueRank: 1024 }],
      ])("refuses an entry with %s", async (_label, entry) => {
        await expect(
          callHandler({
            id: "fb-1",
            queueRank: 1536,
            renumber: [spacedOut[0], entry],
          }),
        ).rejects.toThrow();

        // Refused as a whole - not even the valid entry or the move is written.
        expect(queriesOf("feedback")).toEqual([]);
        expect(await untouched()).toBe(true);
      });

      const entries = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          id: `fb-r${String(i).padStart(3, "0")}`,
          queueRank: (i + 1) * 1024,
        }));

      it("takes a whole open queue of 500", async () => {
        for (const { id } of entries(500))
          arranged[`feedback/${id}`] = report(5);

        await callHandler({
          id: "fb-1",
          queueRank: 512,
          renumber: entries(500),
        });

        const now = await reports();
        expect(
          entries(500).every(
            ({ id, queueRank }) => now[id]!.queueRank === queueRank,
          ),
        ).toBe(true);
        expect(now["fb-1"]!.queueRank).toBe(512);
      });

      it("refuses more than 500 entries", async () => {
        await expect(
          callHandler({ id: "fb-1", queueRank: 512, renumber: entries(501) }),
        ).rejects.toThrow();

        expect(await untouched()).toBe(true);
      });

      it("fails the request when the batch does not commit", async () => {
        // A renumbered report was deleted in the meantime.
        delete arranged["feedback/fb-3"];

        await expect(
          callHandler({ id: "fb-1", queueRank: 1536, renumber: spacedOut }),
        ).rejects.toMatchObject({ statusCode: 404 });
        // No write of the move alone, nor of the renumbering before the gap.
        expect(await untouched()).toBe(true);
      });

      it("404s before batching anything when the report is not there", async () => {
        await expect(
          callHandler({ id: "fb-gone", queueRank: 1536, renumber: spacedOut }),
        ).rejects.toMatchObject({ statusCode: 404 });
        expect(await untouched()).toBe(true);
      });
    });

    describe("adminNote", () => {
      it("stores the note it was sent", async () => {
        await callHandler({ id: "fb-1", adminNote: "duplikat fb-7" });

        expect(await written()).toEqual({ adminNote: "duplikat fb-7" });
      });

      it("clears the note with an empty string", async () => {
        await callHandler({ id: "fb-1", adminNote: "" });

        expect(await written()).toEqual({ adminNote: "" });
      });

      it("clears the note with null, as an empty string", async () => {
        // Unlike the rank, a cleared note is kept as "" rather than deleted -
        // behaviour from before the queue, which it must not change.
        await callHandler({ id: "fb-1", adminNote: null });

        expect(await written()).toEqual({ adminNote: "" });
      });

      it("refuses a note over 2000 characters", async () => {
        await expect(
          callHandler({ id: "fb-1", adminNote: "x".repeat(2001) }),
        ).rejects.toThrow();

        expect(await untouched()).toBe(true);
      });
    });
  },
);
