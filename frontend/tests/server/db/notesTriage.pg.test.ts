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
import handler from "~~/server/api/notes/admin.post";
import type { NoteSource } from "~~/shared/model";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { readStored, syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** /api/notes/admin (POST) on Postgres: an admin's triage of one entry of
 * somebody's note, written onto that entry alone.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/notesTriage.pg.test.ts
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

/** Writes `stored` to the tables and starts the query log afresh. */
async function arrange(stored: StoredDocs) {
  await syncStored(sql, stored);
  queries.length = 0;
}

/** Opens this file's database; run inside the describe. */
function useDatabase() {
  beforeAll(async () => {
    sql = await openTestDatabase("notes_triage");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}

/** The note as arranged: `note-1` with the sources a test cares about. */
let arranged: StoredDocs = {};

const callHandler = async (body: Record<string, unknown>) => {
  await arrange(arranged);
  return (handler as unknown as (event: unknown) => Promise<unknown>)({ body });
};

const seedNote = (sources: NoteSource[]) => {
  arranged = {
    "notes/note-1": { nodeId: "place-1", userUid: "author-1", sources },
  };
};

/** The sources as stored now. */
const written = async (): Promise<NoteSource[]> =>
  ((await readStored(sql, "notes/note-1")) as { sources: NoteSource[] })
    .sources;

describe.runIf(PG_TEST_DATABASE_URL)(
  "POST /api/notes/admin on Postgres",
  () => {
    useDatabase();

    beforeEach(() => {
      vi.clearAllMocks();
      mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
      seedNote([{ note: "pierwsza" }]);
    });

    it("rejects callers without the admin claim", async () => {
      mockGetUser.mockResolvedValue({ uid: "user-1" });

      await expect(
        callHandler({ noteId: "note-1", sourceIndex: 0, adminType: "context" }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await written()).toEqual(
        (arranged["notes/note-1"] as { sources: NoteSource[] }).sources,
      );
    });

    it("writes the type onto the source the admin triaged", async () => {
      seedNote([{ note: "pierwsza" }, { note: "druga" }]);

      await callHandler({
        noteId: "note-1",
        sourceIndex: 1,
        adminType: "new_connection",
      });

      expect((await written())[0]).toEqual({ note: "pierwsza" });
      expect((await written())[1]).toMatchObject({
        adminType: "new_connection",
      });
    });

    it("records that the phone queue could not classify an entry", async () => {
      seedNote([{ note: "za mało kontekstu" }]);

      await callHandler({
        noteId: "note-1",
        sourceIndex: 0,
        adminType: null,
        adminTypeDeferred: true,
      });

      expect((await written())[0]).toEqual({
        note: "za mało kontekstu",
        adminTypeDeferred: true,
      });
    });

    it("clears the deferral once any view gives the entry a type", async () => {
      // Otherwise an entry classified in the table would keep asking the table
      // to classify it.
      seedNote([{ note: "oceniona w tabeli", adminTypeDeferred: true }]);

      await callHandler({
        noteId: "note-1",
        sourceIndex: 0,
        adminType: "missing_data",
      });

      expect((await written())[0]).toEqual({
        note: "oceniona w tabeli",
        adminType: "missing_data",
      });
    });

    it("leaves a field the caller did not mention alone", async () => {
      seedNote([
        { note: "a", adminStatus: "unresolved", adminTypeDeferred: true },
      ]);

      await callHandler({
        noteId: "note-1",
        sourceIndex: 0,
        adminStatus: "resolved",
      });

      expect((await written())[0]).toEqual({
        note: "a",
        adminStatus: "resolved",
        adminTypeDeferred: true,
      });
    });

    it("404s on a source that is not there", async () => {
      seedNote([{ note: "jedyna" }]);

      await expect(
        callHandler({ noteId: "note-1", sourceIndex: 3, adminType: "other" }),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(await written()).toEqual(
        (arranged["notes/note-1"] as { sources: NoteSource[] }).sources,
      );
    });
  },
);
