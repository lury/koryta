import { mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { migrate } from "~~/server/db/migrate";
import { TableLoader } from "~~/server/db/load";
import { closeDb } from "~~/server/db/client";
import { PG_TEST_DATABASE_URL } from "./pgHarness";

/** 0901_extraction_created_at.sql: every fact gets a `createdAt`, from its
 * extraction run, its article's date, else its row's load time, and keeps it.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/extractionCreatedAt.pg.test.ts
 */

const MIGRATIONS = join(import.meta.dirname, "../../../server/db/migrations");
const MIGRATION = "0901_extraction_created_at.sql";

/** The migrations before 0901, in a directory of their own. */
function migrationsBefore(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "koryta-migrations-"));
  for (const file of readdirSync(MIGRATIONS)) {
    if (file.endsWith(".sql") && file < name)
      symlinkSync(join(MIGRATIONS, file), join(dir, file));
  }
  return dir;
}

let sql: postgres.Sql;

const fact = (fields: Record<string, unknown>) => ({
  fact_type: "employment",
  articleUrl: "https://example.com/a",
  url: "https://example.com/a",
  justification: "bo tak",
  tag: "capture_v1",
  ...fields,
});

async function createdAt(id: string) {
  const [row] = await sql<{ data: { createdAt?: string }; at: string }[]>`
    SELECT data, iso_instant(created_at) AS at FROM extractions WHERE id = ${id}`;
  return { data: row?.data.createdAt, column: row?.at };
}

describe.runIf(PG_TEST_DATABASE_URL)("extraction facts' createdAt", () => {
  beforeAll(async () => {
    const url = new URL(PG_TEST_DATABASE_URL!);
    const database = `${url.pathname.slice(1)}_created_at`;
    const admin = postgres(PG_TEST_DATABASE_URL!, {
      max: 1,
      onnotice: () => {},
    });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    await admin.end();
    url.pathname = `/${database}`;
    process.env.DATABASE_URL = url.toString();
    sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
    await migrate(sql, migrationsBefore(MIGRATION));

    // As production holds them before the migration.
    const docs = {
      dated: fact({ createdAt: "2026-05-05T10:00:00.000Z" }),
      captured: fact({ articleNodeId: "article-1" }),
      published: fact({ articleNodeId: "article-1", tag: "v1" }),
      byUrl: fact({ articleUrl: "https://example.com/b", tag: "v1" }),
      nothing: fact({ articleUrl: "https://example.com/none", tag: "v1" }),
      garbage: fact({ createdAt: "not a date", articleUrl: "x", tag: "v1" }),
    };
    for (const [id, data] of Object.entries(docs)) {
      await sql`INSERT INTO extractions (id, data, created_at)
        VALUES (${id}, ${sql.json(data)}, '2026-11-01T00:00:00Z')`;
    }
    await sql`INSERT INTO article_pages (id, data) VALUES ('page-1', ${sql.json(
      {
        url: "https://example.com/a",
        normalizedUrl: "example.com/a",
        capturedAt: "2026-03-03T00:00:00.000Z",
        extraction: {
          tag: "capture_v1",
          startedAt: "2026-03-04T00:00:00.000Z",
          finishedAt: "2026-03-04T00:05:00.000Z",
        },
      },
    )})`;
    await sql`INSERT INTO nodes (id, data) VALUES
      ('article-1', ${sql.json({ type: "article", name: "A", sourceURL: "https://example.com/a", publishedDate: "2026-02-02T00:00:00.000Z" })}),
      ('article-2', ${sql.json({ type: "article", name: "B", sourceURL: "https://example.com/b", publishedDate: "2026-01-01T12:00:00.000Z" })})`;

    expect((await migrate(sql))[0]).toBe(MIGRATION);
  }, 120_000);

  afterAll(async () => {
    await sql.end();
    await closeDb();
  });

  it("backfills from the run, then the article, then the load time", async () => {
    expect(await createdAt("dated")).toEqual({
      data: "2026-05-05T10:00:00.000Z",
      column: "2026-05-05T10:00:00.000Z",
    });
    // The capture with the fact's tag: when its extraction finished.
    expect((await createdAt("captured")).column).toBe(
      "2026-03-04T00:05:00.000Z",
    );
    // Another tag than the capture's: the article's own date.
    expect((await createdAt("published")).column).toBe(
      "2026-02-02T00:00:00.000Z",
    );
    // No `articleNodeId`: the article whose url the fact names.
    expect((await createdAt("byUrl")).column).toBe("2026-01-01T12:00:00.000Z");
    expect(await createdAt("nothing")).toEqual({
      data: "2026-11-01T00:00:00.000Z",
      column: "2026-11-01T00:00:00.000Z",
    });
    expect((await createdAt("garbage")).data).toBe("2026-11-01T00:00:00.000Z");
    const [{ missing }] = await sql<{ missing: number }[]>`
      SELECT count(*)::int AS missing FROM extractions
      WHERE jsonb_instant(data -> 'createdAt') IS DISTINCT FROM created_at`;
    expect(missing).toBe(0);
  });

  it("dates a new fact without one, and keeps the date through an update", async () => {
    await sql`INSERT INTO extractions (id, data) VALUES
      ('new-a', ${sql.json(fact({ articleNodeId: "article-1", tag: "v9" }))}),
      ('new-b', ${sql.json(fact({ articleUrl: "https://example.com/none" }))}),
      ('new-c', ${sql.json(fact({ createdAt: "2026-06-06T00:00:00.000Z" }))})`;
    expect((await createdAt("new-a")).data).toBe("2026-02-02T00:00:00.000Z");
    const b = await createdAt("new-b");
    expect(b.data).toBe(b.column);
    expect(Date.now() - Date.parse(b.data!)).toBeLessThan(60_000);
    expect((await createdAt("new-c")).column).toBe("2026-06-06T00:00:00.000Z");

    // An update that drops the field keeps the date; one that sets it moves it.
    await sql`UPDATE extractions SET data = data - 'createdAt' WHERE id = 'new-a'`;
    expect((await createdAt("new-a")).data).toBe("2026-02-02T00:00:00.000Z");
    await sql`UPDATE extractions
      SET data = jsonb_set(data, '{createdAt}', '"2026-07-07T00:00:00.000Z"') WHERE id = 'new-a'`;
    expect((await createdAt("new-a")).column).toBe("2026-07-07T00:00:00.000Z");
  });

  it("loads a fact without one dated, and a second load leaves the date alone", async () => {
    const load = async () => {
      const loader = new TableLoader(sql, "extractions", "extractions");
      await loader.add(
        "loaded",
        fact({ articleUrl: "https://example.com/none", tag: "v1" }),
      );
      await loader.flush();
      return loader.report;
    };
    expect((await load()).inserted).toBe(1);
    const first = await createdAt("loaded");
    expect(first.data).toBe(first.column);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await load()).unchanged).toBe(1);
    expect(await createdAt("loaded")).toEqual(first);
  });

  it("orders the list by the column with its index", async () => {
    const lines = await sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`;
      return tx<{ "QUERY PLAN": string }[]>`
        EXPLAIN SELECT id FROM extractions ORDER BY created_at DESC, id DESC LIMIT 10`;
    });
    expect(lines.map((l) => l["QUERY PLAN"]).join("\n")).toContain(
      "extractions_created",
    );
  });
});
