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
import handler from "~~/server/api/nodes/[id]/url.get";
import { SITEMAP_NODE_TYPES } from "~~/shared/lastmod";
import { generateEntityUrl } from "~~/shared/slugs";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";

/** GET /api/nodes/[id]/url on Postgres: the public page a mangled id names
 * (lowercased, punctuation on the end), among the sitemap's pages.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/nodeUrl.pg.test.ts
 */

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});

let sql: postgres.Sql;
let stored: StoredDocs = {};
let id: string | undefined;

const call = async () => {
  await syncStored(sql, stored);
  globalThis.getRouterParam = vi.fn(() => id) as never;
  return (handler as unknown as (e: unknown) => Promise<{ url: string }>)({});
};

describe.runIf(PG_TEST_DATABASE_URL)(
  "GET /api/nodes/[id]/url on Postgres",
  () => {
    beforeAll(async () => {
      sql = await openTestDatabase("node_url");
    }, 120_000);
    afterAll(async () => {
      await closeTestDatabase(sql);
    });
    beforeEach(() => {
      stored = {
        "nodes/SVb31mmNOMmlOy1BsPhH": {
          type: "person",
          name: "Adam Niedziałek",
          published: true,
        },
        "nodes/aRhVbgfIke5i6PqDBZY5": {
          type: "place",
          name: "AMW INVEST (Warszawa)",
          published: true,
        },
        "nodes/DRf5LYAdf5TwXKDZYMcP": {
          type: "article",
          name: "1,7 mln dla młodego lekarza",
          published: true,
        },
        "nodes/Xx1Draftyyyyyyyyyyyy": { type: "person", name: "Szkic" },
        "nodes/Xx2Regionyyyyyyyyyyy": {
          type: "region",
          name: "Region",
          published: true,
        },
      };
    });

    it("finds the page an id names once its capitals are gone", async () => {
      id = "svb31mmnommloy1bsphh";
      expect(await call()).toEqual({
        url: generateEntityUrl(
          "person",
          "SVb31mmNOMmlOy1BsPhH",
          "Adam Niedziałek",
        ),
      });
    });

    it("finds it with the full stop of a pasted sentence on the end", async () => {
      id = "aRhVbgfIke5i6PqDBZY5.";
      expect(await call()).toEqual({
        url: generateEntityUrl(
          "place",
          "aRhVbgfIke5i6PqDBZY5",
          "AMW INVEST (Warszawa)",
        ),
      });
    });

    it("finds an article too", async () => {
      id = "drf5lyadf5twxkdzymcp";
      expect((await call()).url).toMatch(/DRf5LYAdf5TwXKDZYMcP$/);
    });

    it("answers 404 for an id no public page has", async () => {
      // An unpublished page, or a region, is not in the sitemap: a mangled
      // link to one stays a dead end rather than revealing where it is.
      for (const missing of [
        "xxxxxxxxxxxxxxxxxxxx",
        "xx1draftyyyyyyyyyyyy",
        "xx2regionyyyyyyyyyyy",
      ]) {
        id = missing;
        await expect(call()).rejects.toMatchObject({ statusCode: 404 });
      }
    });

    it("will not guess between two pages whose ids differ only in case", async () => {
      stored["nodes/svb31mmNOMmlOy1BsPhH"] = {
        type: "person",
        name: "Adam Niedziałek",
        published: true,
      };
      id = "svb31mmnommloy1bsphh";
      await expect(call()).rejects.toMatchObject({ statusCode: 404 });
    });

    it("refuses an id that is nothing but punctuation", async () => {
      id = "...";
      await expect(call()).rejects.toMatchObject({ statusCode: 400 });
    });

    it("searches the sitemap's page types, which the index lists", () => {
      // readPagesByMangledId and 0942's index name these three.
      expect([...SITEMAP_NODE_TYPES].sort()).toEqual([
        "article",
        "person",
        "place",
      ]);
    });
  },
);
