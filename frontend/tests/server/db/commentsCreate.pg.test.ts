import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import handler from "~~/server/api/comments/create.post";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { validatedBody } from "../h3Validation";

/** /api/comments/create on Postgres: what a comment request may hold, and
 * what lands in `comments`.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/commentsCreate.pg.test.ts
 */

const { auth } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).defineEventHandler = (fn: unknown) =>
    fn;
  return { auth: { signedIn: true } };
});

vi.mock("~~/server/utils/auth", () => ({
  getUser: async () => {
    if (!auth.signedIn) throw { statusCode: 401, message: "brak tokenu" };
    return { uid: "reader" };
  },
}));

let body: unknown;
(globalThis as Record<string, unknown>).readValidatedBody = (
  _event: unknown,
  parse: (body: unknown) => unknown,
) => validatedBody(body, parse);

let sql: postgres.Sql;

const call = () =>
  (handler as unknown as (event: unknown) => Promise<Record<string, unknown>>)(
    {},
  );

async function stored() {
  const rows = await sql<{ id: string; data: Record<string, unknown> }[]>`
    SELECT id, data FROM comments ORDER BY id`;
  return rows;
}

describe.runIf(PG_TEST_DATABASE_URL)("/api/comments/create on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("comments_create");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });

  beforeEach(async () => {
    await sql`DELETE FROM comments`;
    auth.signedIn = true;
    body = undefined;
  });

  it("stores a reply on a page as written", async () => {
    body = { content: "  Źródło?\n", nodeId: "person-1", parentId: "c-0" };

    const comment = await call();

    const rows = await stored();
    expect(rows.map(({ data }) => data)).toEqual([
      {
        content: "  Źródło?\n",
        authorId: "reader",
        authorName: "reader",
        createdAt: expect.any(String),
        isLead: false,
        nodeId: "person-1",
        edgeId: null,
        parentId: "c-0",
      },
    ]);
    expect(comment.id).toBe(rows[0]!.id);
  });

  it("stores a comment that names nothing as a lead", async () => {
    body = { content: "Ktoś wie więcej?", nodeId: null, edgeId: "" };
    await call();
    expect((await stored())[0]!.data).toMatchObject({
      isLead: true,
      nodeId: null,
      edgeId: null,
      parentId: null,
    });
  });

  it("refuses a comment with nothing in it, or not text", async () => {
    for (const content of [undefined, "", "   \n", 42, { text: "x" }]) {
      body = { content, nodeId: "person-1" };
      await expect(call()).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(await stored()).toEqual([]);
  });

  it("refuses a comment past the length cap", async () => {
    body = { content: "a".repeat(10_001) };
    await expect(call()).rejects.toMatchObject({ statusCode: 400 });
    body = { content: "a".repeat(10_000) };
    await call();
    expect(await stored()).toHaveLength(1);
  });

  it("refuses a target that is a path or not an id", async () => {
    for (const target of [
      { nodeId: "nodes/person-1" },
      { edgeId: ["edge-1"] },
      { parentId: 7 },
    ]) {
      body = { content: "Uwaga", ...target };
      await expect(call()).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(await stored()).toEqual([]);
  });

  it("answers a logged out caller 401 whatever they sent", async () => {
    auth.signedIn = false;
    body = { content: 42 };
    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
  });
});
