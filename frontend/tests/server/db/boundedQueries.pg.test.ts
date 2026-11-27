import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import { listNodes, nodeOptions, readNodesByIds } from "~~/server/db/nodes";
import { progressFromDb } from "~~/server/db/stats";
import { searchChunk } from "~~/server/db/search";
import { readEmployedPage, readTimelinePosts } from "~~/server/db/edgeLists";
import { topicsAndTags } from "~~/server/utils/topics";
import { revisionRowsOfNodePg } from "~~/server/db/revisionQueue";
import { edgesWithNullRevisionPg } from "~~/server/db/edgeQueues";
import { useDb } from "~~/server/db/client";

/** The readers behind the list and search pages read through an index: on
 * a small seed, with `enable_seqscan = off`, no statement they send plans a
 * sequential scan of `nodes`, `edges` or `revisions` - a scan the planner
 * still makes sequential has no index to use, and reads the whole table at
 * any scale - and none answers more rows than it was asked for. Cheap and
 * deterministic; the latency budgets are `npm run test:perf`'s, at x10
 * (tests/perf/budgets.json).
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/boundedQueries.pg.test.ts
 */

/** Every statement the readers send, with its parameters. */
const { sent } = vi.hoisted(() => ({
  sent: [] as { query: string; params: unknown[] }[],
}));
vi.mock("~~/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/db/client")>();
  const { default: postgres } =
    await vi.importActual<typeof import("postgres")>("postgres");
  let pool: ReturnType<typeof postgres> | undefined;
  return {
    ...actual,
    useDb: () =>
      (pool ??= postgres(process.env.DATABASE_URL!, {
        max: 2,
        onnotice: () => {},
        connection: { plan_cache_mode: "force_custom_plan" },
        debug: (_connection, query, params) => {
          sent.push({ query, params: params as unknown[] });
        },
      })),
    closeDb: async () => {
      await pool?.end();
      pool = undefined;
    },
  };
});

const BIG_TABLES = /\bSeq Scan on (nodes|edges|revisions)\b/;

let sql: postgres.Sql;

/** The statements `read` sent whose plans scan a big table whole. */
async function wholeScans(read: () => Promise<unknown>): Promise<string[]> {
  sent.length = 0;
  await read();
  // Nothing captured would make every check pass.
  expect(sent.length).toBeGreaterThan(0);
  const found: string[] = [];
  for (const { query, params } of [...sent]) {
    if (!/^\s*(SELECT|WITH)\b/i.test(query)) continue;
    const plan = await sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`;
      const rows = await tx.unsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN ${query}`,
        params as never[],
      );
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    });
    const scan = plan.match(BIG_TABLES);
    if (scan)
      found.push(`${scan[0]}: ${query.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  return found;
}

/** Forty people at four companies in two województwa, with posts,
 * candidacies, votes and revisions enough for every filter to match. */
function seed(): StoredDocs {
  const docs: StoredDocs = {};
  const region = (id: string, teryt: string) => {
    docs[`nodes/${id}`] = { type: "region", name: id, teryt, published: true };
  };
  region("teryt14", "14");
  region("teryt1465", "1465");
  region("teryt12", "12");
  region("teryt1261", "1261");
  const companies = [
    ["szpital", "teryt1465", ["szpitale"]],
    ["wodociagi", "teryt1465", ["wodociagi"]],
    ["krakow", "teryt1261", ["szpitale"]],
    ["fundusz", "teryt1261", []],
  ] as const;
  for (const [id, seat, categories] of companies) {
    docs[`nodes/${id}`] = {
      type: "place",
      name: `${id.toUpperCase()} SP. Z O.O.`,
      categories: [...categories],
      isPublic: true,
      published: true,
      krsNumber: `00000000${id.length}`,
    };
    docs[`edges/seat-${id}`] = {
      type: "seat",
      source: seat,
      target: id,
      published: true,
    };
  }
  for (let i = 0; i < 40; i++) {
    const id = `p${i}`;
    docs[`nodes/${id}`] = {
      type: "person",
      name: `Jan Kowalski ${i}`,
      published: i % 3 !== 0,
      parties: i % 2 ? ["PiS"] : ["PO"],
      stats: { queueTier: i % 4 },
    };
    docs[`edges/job-${id}`] = {
      type: "employed",
      source: id,
      target: companies[i % 4]![0],
      name: "Członek Rady Nadzorczej",
      start_date: `20${10 + (i % 15)}-01-01`,
      published: i % 5 !== 0,
    };
    if (i % 3 === 0)
      docs[`edges/run-${id}`] = {
        type: "election",
        source: id,
        target: i % 2 ? "teryt1465" : "teryt1261",
        start_date: "2024-01-01",
        position: "Rada miasta",
        elected: i % 2 === 0,
        published: true,
      };
    docs[`revisions/r-${id}`] = {
      node_id: id,
      update_time: "2026-01-01T00:00:00.000Z",
      name: `Jan Kowalski ${i}`,
    };
  }
  docs["nodes/art"] = {
    type: "article",
    name: "Kowalski w radzie",
    sourceURL: "https://example.pl/kowalski",
    published: true,
  };
  return docs;
}

describe.runIf(PG_TEST_DATABASE_URL)("bounded reads", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("bounded_queries");
    await syncStored(sql, seed());
    await sql`SELECT refresh_node_stats()`;
    await sql`SELECT refresh_node_derived()`;
    await sql`ANALYZE`;
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });

  it("sees a statement that reads a whole table", async () => {
    expect(
      await wholeScans(
        () =>
          useDb()`SELECT id FROM nodes WHERE data ->> 'name' LIKE '%Kowalski%'`,
      ),
    ).toHaveLength(1);
  });

  const lists: [string, Parameters<typeof listNodes>[0]][] = [
    ["a page of people", { type: "person", limit: 10 }],
    ["a later page", { type: "person", limit: 10, page: 3 }],
    [
      "by name",
      { type: "person", sortBy: "name", sortDesc: "true", limit: 10 },
    ],
    [
      "longest tenure",
      { type: "person", sortBy: "experience", sortDesc: "true", limit: 9 },
    ],
    ["a województwo", { type: "person", teryt: "14", limit: 10 }],
    ["a region", { type: "person", teryt: "1465", limit: 10 }],
    [
      "companies seated in a województwo",
      { type: "person", companyTeryt: "14", limit: 10 },
    ],
    ["a sector", { type: "person", category: "szpitale", limit: 10 }],
    [
      "a sector in a województwo",
      { type: "person", category: "szpitale", teryt: "12", limit: 10 },
    ],
    [
      "the queue",
      {
        type: "person",
        category: "szpitale",
        currentlyEmployed: "selected",
        hideVoted: "no_votes",
        visibility: "private",
        limit: 20,
      },
    ],
    ["a company", { type: "person", place: "szpital", limit: 10 }],
    ["by ids", { type: "place", ids: ["szpital", "krakow"], limit: 50 }],
  ];

  for (const [name, query] of lists) {
    it(`lists ${name} through an index, a page at most`, async () => {
      let rows = 0;
      const scans = await wholeScans(async () => {
        for (const signedIn of [false, true]) {
          const list = await listNodes(query, signedIn);
          if (list !== "empty") rows = Math.max(rows, list.rows.length);
        }
      });
      expect(scans).toEqual([]);
      expect(rows).toBeLessThanOrEqual(query.limit!);
    });
  }

  it("counts a województwo, a sector and a region through an index", async () => {
    expect(
      await wholeScans(async () => {
        await progressFromDb({ teryt: "14" });
        await progressFromDb({ teryt: "1465" });
        await progressFromDb({ category: "szpitale" });
        await progressFromDb({ companyTeryt: "12" });
      }),
    ).toEqual([]);
  });

  it("offers a picker's options through an index, fifty at most", async () => {
    let rows = 0;
    const scans = await wholeScans(async () => {
      for (const options of [
        { type: "place" as const, q: "szp", showDrafts: false },
        { type: "place" as const, krs: ["000000007"], showDrafts: true },
        { type: "article" as const, q: "kowalski", showDrafts: false },
      ]) {
        rows = Math.max(rows, (await nodeOptions(options)).length);
      }
    });
    expect(scans).toEqual([]);
    expect(rows).toBeLessThanOrEqual(50);
  });

  it("searches and reads pages by id through an index", async () => {
    expect(
      await wholeScans(async () => {
        await searchChunk("kowalski", 20);
        await readNodesByIds(["p1", "p2", "szpital"]);
      }),
    ).toEqual([]);
  });

  it("pages through the newest posts through an index", async () => {
    let rows = 0;
    const scans = await wholeScans(async () => {
      const first = await readEmployedPage(null, 5);
      const last = first.at(-1)!;
      rows = (
        await readEmployedPage({ startDate: last.start_date, id: last.id }, 5)
      ).length;
    });
    expect(scans).toEqual([]);
    expect(rows).toBeLessThanOrEqual(5);
  });

  it("reads a page's revisions under either spelling through an index", async () => {
    expect(await wholeScans(() => revisionRowsOfNodePg("p1"))).toEqual([]);
  });

  it("reads the relations awaiting a first review through an index", async () => {
    expect(await wholeScans(() => edgesWithNullRevisionPg())).toEqual([]);
  });

  it("reads the topics and their tags through an index", async () => {
    expect(await wholeScans(() => topicsAndTags())).toEqual([]);
  });

  it("reads the timeline's newest posts through an index, as many as asked", async () => {
    let rows = 0;
    const scans = await wholeScans(async () => {
      rows = (await readTimelinePosts(5)).length;
    });
    expect(scans).toEqual([]);
    expect(rows).toBeLessThanOrEqual(5);
  });
});
