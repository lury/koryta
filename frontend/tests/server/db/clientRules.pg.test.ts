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
import putNote from "~~/server/api/notes/[nodeId].put";
import deleteNote from "~~/server/api/notes/[nodeId].delete";
import attachArticles from "~~/server/api/notes/[nodeId]/articles.post";
import mePatch from "~~/server/api/me/index.patch";
import { notesOnNodePg } from "~~/server/db/notes";
import { contributionsFromDb } from "~~/server/db/stats";
import { listNodes } from "~~/server/db/nodes";
import { putOwnVotePg } from "~~/server/db/votes";
import {
  callAs,
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
  statusOf,
  type TestEvent,
} from "./pgHarness";

/** The cases of the firestore.rules tests (tests/rules, removed with the
 * Firestore client) that clientWrites.pg.test.ts and the read tests did not
 * already state as the API's behaviour on Postgres.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/clientRules.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.defineEventHandler = (fn: unknown) => fn;
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
  };
});

vi.mock("~~/server/utils/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/utils/auth")>();
  return {
    ...actual,
    getUser: async (event: TestEvent) => {
      const header = event.headers.authorization;
      if (!header) throw Object.assign(new Error("401"), { statusCode: 401 });
      return { uid: header.split(",")[0] };
    },
  };
});

describe.runIf(PG_TEST_DATABASE_URL)(
  "what firestore.rules held, as the API holds it",
  () => {
    let sql: postgres.Sql;

    beforeAll(async () => {
      sql = await openTestDatabase("client_rules");
    }, 120_000);

    afterAll(async () => {
      await closeTestDatabase(sql);
    });

    beforeEach(async () => {
      await sql`TRUNCATE nodes, notes, users, votes, revisions`;
      await sql`INSERT INTO nodes (id, data) VALUES
      ('published', ${sql.json({ type: "person", name: "Anna Nowak", published: true })}),
      ('draft', ${sql.json({ type: "person", name: "Jan Szkic", published: false })}),
      ('company', ${sql.json({ type: "place", name: "Wodociągi", published: true })})`;
      await sql`INSERT INTO notes (id, data) VALUES
      ('published_reader', ${sql.json({ nodeId: "published", userUid: "reader", sources: [] })}),
      ('draft_alice', ${sql.json({ nodeId: "draft", userUid: "alice", sources: [] })}),
      ('ghost_alice', ${sql.json({ nodeId: "ghost", userUid: "alice", sources: [] })}),
      ('ghost_reader', ${sql.json({ nodeId: "ghost", userUid: "reader", sources: [] })})`;
      await sql`SELECT refresh_node_stats()`;
    });

    it("keeps a note whose page is gone from a logged out reader", async () => {
      expect(await notesOnNodePg("ghost", false)).toEqual([]);
      expect((await notesOnNodePg("ghost", true)).map((n) => n.id)).toEqual([
        "ghost_alice",
        "ghost_reader",
      ]);
    });

    it("still counts a reader's own notes, on any page", async () => {
      // The profile's contributions count asks by author, not by page.
      expect(await contributionsFromDb("reader")).toMatchObject({ notes: 2 });
      expect(await contributionsFromDb("alice")).toMatchObject({ notes: 2 });
    });

    it("does not let anybody signed out write, change or remove a note", async () => {
      const params = { nodeId: "company" };
      expect(
        await statusOf(
          callAs(putNote, undefined, { params, body: { sources: [] } }),
        ),
      ).toBe(401);
      expect(await statusOf(callAs(deleteNote, undefined, { params }))).toBe(
        401,
      );
      expect(
        await statusOf(
          callAs(attachArticles, undefined, {
            params,
            body: { articleIds: {} },
          }),
        ),
      ).toBe(401);
      const [{ n }] = await sql<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM notes`;
      expect(n).toBe(4);
    });

    it("does not let anybody signed out write a profile", async () => {
      expect(
        await statusOf(
          callAs(mePatch, undefined, { body: { displayName: "Ala" } }),
        ),
      ).toBe(401);
      expect(await sql`SELECT 1 FROM users`).toHaveLength(0);
    });

    it("lists to a logged out reader only the people who are published", async () => {
      const list = await listNodes({ type: "person" }, false);
      expect(list).not.toBe("empty");
      const ids = (list as { rows: { id: string }[] }).rows.map((n) => n.id);
      expect(ids).toEqual(["published"]);
    });

    it("keeps every vote's map of categories, a vote with only a comment too", async () => {
      await putOwnVotePg("published", "reader", {
        kind: "node",
        comment: "ok",
      });
      const [{ data }] = await sql<{ data: Record<string, unknown> }[]>`
      SELECT data FROM votes WHERE id = 'published_reader'`;
      expect(data).toMatchObject({
        categoryVotes: {},
        comment: "ok",
        userUid: "reader",
      });
    });
  },
);
