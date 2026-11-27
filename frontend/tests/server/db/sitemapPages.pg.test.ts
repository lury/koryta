import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { readSitemapPages } from "~~/server/db/nodes";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored } from "./storedDocs";

/** What the sitemap reads of a type: the live, named pages, and of each
 * only the fields an entry is made of.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/sitemapPages.pg.test.ts
 */
let sql: postgres.Sql;

describe.runIf(PG_TEST_DATABASE_URL)("readSitemapPages", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("sitemap_pages");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });

  it("reads the live named pages of the type, with the entry's fields alone", async () => {
    const revisions = { latest_time: "2026-01-02T00:00:00.000Z", total: 1 };
    await syncStored(sql, {
      "nodes/anna": {
        type: "person",
        name: "Anna",
        published: true,
        content_changed_at: "2026-01-01T00:00:00.000Z",
        revisions,
        parties: ["PiS"],
        stats: { notesCount: 3 },
      },
      "nodes/draft": { type: "person", name: "Szkic" },
      "nodes/gone": {
        type: "person",
        name: "Usunięta",
        published: true,
        deleted: true,
      },
      "nodes/nameless": { type: "person", published: true },
      "nodes/orlen": { type: "place", name: "Orlen", published: true },
    });
    expect(await readSitemapPages("person")).toEqual({
      anna: {
        type: "person",
        name: "Anna",
        published: true,
        content_changed_at: "2026-01-01T00:00:00.000Z",
        revisions,
      },
    });
  });
});
