import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** The TTL that replaces Firestore's on `expireAt`
 * (`expire_documents()`, run by server/plugins/expire-documents.ts).
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/opsExpiry.pg.test.ts
 */

let sql: postgres.Sql;

describe.runIf(PG_TEST_DATABASE_URL)("ops expiry on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("ops_expiry");
  }, 120_000);

  afterAll(async () => {
    await closeTestDatabase(sql);
  });

  it("expires what is past its expireAt", async () => {
    await sql`INSERT INTO ops.search_queries (id, data) VALUES
      ('old', ${sql.json({ query: "x", expireAt: "2020-01-01T00:00:00.000Z" })}),
      ('new', ${sql.json({ query: "y", expireAt: "2999-01-01T00:00:00.000Z" })})`;
    const [{ n }] = await sql<{ n: number }[]>`SELECT expire_documents() AS n`;
    expect(n).toBeGreaterThanOrEqual(1);
    const left =
      await sql`SELECT id FROM ops.search_queries WHERE id IN ('old', 'new')`;
    expect(left.map((r) => r.id)).toEqual(["new"]);
  });
});
