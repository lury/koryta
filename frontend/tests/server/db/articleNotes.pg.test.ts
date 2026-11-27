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
import handler from "~~/server/api/articles/[id]/notes.get";
import type { NoteRow } from "~~/shared/model";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** /api/articles/[id]/notes on Postgres: what readers wrote about an
 * article on other pages, from the notes arranged per test.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/articleNotes.pg.test.ts
 */

/** The note entries, as rows, that the notes are arranged from. */
let rows: NoteRow[] = [];
/** Every node, keyed by id. */
let nodes: Record<string, Record<string, unknown> | undefined> = {};
let user: { uid: string } | null = { uid: "reader-uid" };

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
    sql = await openTestDatabase("article_notes");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}
vi.mock("~~/server/utils/auth", () => ({
  getUser: async () => {
    if (!user) throw { statusCode: 401 };
    return user;
  },
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});
globalThis.getRouterParam = vi.fn(() => "article-1");

const row = (overrides: Partial<NoteRow> = {}): NoteRow => ({
  key: "note-1:0",
  noteId: "note-1",
  sourceIndex: 0,
  nodeId: "person-1",
  nodeName: "Anna Nowak",
  nodeType: "person",
  userUid: "someone",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: null,
  note: "Warto przeczytać",
  url: null,
  kind: "source",
  articleNodeId: null,
  adminStatus: null,
  adminType: null,
  adminTypeDeferred: false,
  ...overrides,
});

/** The rows as the notes they are entries of: `<noteId>:<index>` keys, the
 * page each is on in `nodes` under its name. */
function notesOf(entries: NoteRow[]): StoredDocs {
  const docs: StoredDocs = {};
  for (const entry of entries) {
    const [noteId, index] = entry.key.split(":");
    const doc = (docs[`notes/${noteId}`] ??= {
      nodeId: entry.nodeId,
      userUid: entry.userUid,
      createdAt: entry.createdAt,
      sources: [],
    }) as { sources: Record<string, unknown>[] };
    doc.sources[Number(index)] = {
      note: entry.note,
      kind: entry.kind,
      ...(entry.url ? { url: entry.url } : {}),
      ...(entry.articleNodeId ? { articleNodeId: entry.articleNodeId } : {}),
    };
  }
  return docs;
}

const call = async () => {
  await arrange({
    ...Object.fromEntries(
      Object.entries(nodes).map(([id, data]) => [`nodes/${id}`, data]),
    ),
    "nodes/person-1": { type: "person", name: "Anna Nowak" },
    ...notesOf(rows),
  });
  return handler({} as never);
};

describe.runIf(PG_TEST_DATABASE_URL)(
  "GET /api/articles/[id]/notes on Postgres",
  () => {
    useDatabase();

    beforeEach(() => {
      user = { uid: "reader-uid" };
      globalThis.getRouterParam = vi.fn(() => "article-1");
      nodes = {
        "article-1": {
          type: "article",
          sourceURL: "https://www.example.pl/a/",
        },
      };
      rows = [];
    });

    it("takes the entries the promotion stamped with this article", async () => {
      rows = [row({ articleNodeId: "article-1" }), row({ key: "n2:0" })];

      const { notes } = await call();
      expect(notes.map((n) => n.key)).toEqual(["note-1:0"]);
    });

    it("takes an entry that cites the same page under another spelling", async () => {
      // Everything written before the promotion existed carries no stamp, and a
      // correction or a gap report carries a url and is never promoted at all.
      rows = [
        row({ key: "n1:0", url: "example.pl/a" }),
        row({
          key: "n2:0",
          url: "https://example.pl/a",
          kind: "change_request",
        }),
        row({ key: "n3:0", url: "https://example.pl/inny-tekst" }),
      ];

      const { notes } = await call();
      expect(notes.map((n) => n.key)).toEqual(["n1:0", "n2:0"]);
    });

    it("leaves out the article's own notes, which the editor below shows", async () => {
      rows = [
        row({ key: "own:0", nodeId: "article-1", articleNodeId: "article-1" }),
        row({ key: "other:0", articleNodeId: "article-1" }),
      ];

      const { notes } = await call();
      expect(notes.map((n) => n.key)).toEqual(["other:0"]);
    });

    it("carries the node the note was written on, which is the point of it", async () => {
      rows = [row({ articleNodeId: "article-1" })];

      const { notes } = await call();
      expect(notes[0]).toMatchObject({
        nodeId: "person-1",
        nodeName: "Anna Nowak",
        nodeType: "person",
      });
    });

    it("refuses a signed out caller", async () => {
      // Notes on a person are withheld from logged out readers on the person's
      // own page; this must not be the way around that.
      user = null;
      await expect(call()).rejects.toMatchObject({ statusCode: 401 });
    });

    it("404s for an id that is not an article", async () => {
      nodes["article-1"] = { type: "person", name: "Anna" };
      await expect(call()).rejects.toMatchObject({ statusCode: 404 });
    });

    it("still matches by id when the article has no url to compare", async () => {
      nodes["article-1"] = { type: "article" };
      rows = [
        row({ articleNodeId: "article-1" }),
        row({ key: "n2:0", url: "x" }),
      ];

      const { notes } = await call();
      expect(notes.map((n) => n.key)).toEqual(["note-1:0"]);
    });
  },
);
