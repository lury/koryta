import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  readGroupGraph,
  refreshGroupSizes,
  takeGeneration,
  walkGroupSizes,
  writeGroupSizes,
} from "~~/server/db/groupSizes";
import { touchedBy } from "~~/server/db/writeEffects";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import {
  groupSizeMismatches,
  installGroupSizesOracle,
} from "./groupSizesOracle";

/** The nightly nodeGroupSize count of server/db/groupSizes.ts on small
 * graphs worked out by hand, against the SQL it replaced, and against the
 * incremental writes that may commit while it runs.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/groupSizes.pg.test.ts
 */

type Row = [id: string, type: string, data?: Record<string, unknown>];
type EdgeRow = [
  id: string,
  type: string,
  source: string | null,
  target: string | null,
  extra?: Record<string, unknown>,
];

// Each id starts with its case.
const NODES: Row[] = [
  // c1: a triangle of connections, each reaches the others and itself
  ["c1a", "person"],
  ["c1b", "person"],
  ["c1c", "person"],
  // c2: a hidden person on a connection, coworkers at a place
  ["c2h", "person", { hide: true }],
  ["c2p", "person"],
  ["c2q", "person"],
  ["c2X", "place"],
  // c3: dead ends: employees, a hidden one, a seat region, a mention
  ["c3Y", "place"],
  ["c3e1", "person"],
  ["c3e2", "person", { hide: 1 }],
  ["c3R", "region"],
  ["c3m", "person"],
  // c4: region owns place owns place; employees below
  ["c4R", "region"],
  ["c4P1", "place"],
  ["c4P2", "place"],
  ["c4w", "person"],
  ["c4u", "person"],
  ["c4v", "person"],
  // c5: self links
  ["c5a", "person"],
  ["c5b", "person"],
  // c6: a duplicated edge, and a person counted both as active and as a dead end
  ["c6p", "person"],
  ["c6X", "place"],
  ["c6q", "person"],
  // c7: JavaScript truthiness of hide
  ["c7X", "place"],
  ["c7z", "person", { hide: 0 }],
  ["c7s", "person", { hide: "" }],
  ["c7f", "person", { hide: "false" }],
  ["c7n", "person", { hide: null }],
  ["c7t", "person", { hide: false }],
  // c8: articles and unknown edge types do not take part
  ["c8p", "person"],
  ["c8A", "article"],
  ["c8q", "person"],
  // c9: an ownership cycle (an error in real data, but the walk survives it)
  ["c9P", "place"],
  ["c9Q", "place"],
  ["c9e", "person"],
];
const EDGES: EdgeRow[] = [
  ["e1", "connection", "c1a", "c1b"],
  ["e2", "connection", "c1b", "c1c"],
  ["e3", "connection", "c1c", "c1a"],
  ["e4", "connection", "c2p", "c2h"],
  ["e5", "employed", "c2p", "c2X"],
  ["e6", "employed", "c2q", "c2X"],
  ["e7", "employed", "c3e1", "c3Y"],
  ["e8", "employed", "c3e2", "c3Y"],
  ["e9", "seat", "c3R", "c3Y"],
  ["e10", "mentions", "c3m", "c3e1"],
  ["e11", "owns", "c4R", "c4P1"],
  ["e12", "owns", "c4P1", "c4P2"],
  ["e13", "employed", "c4w", "c4P1"],
  ["e14", "employed", "c4u", "c4P2"],
  ["e15", "employed", "c4v", "c4P2"],
  ["e16", "connection", "c5a", "c5a"],
  ["e17", "mentions", "c5b", "c5b"],
  ["e18", "employed", "c6p", "c6X"],
  ["e19", "employed", "c6p", "c6X"],
  ["e20", "connection", "c6p", "c6q"],
  ["e21", "employed", "c6q", "c6X"],
  ["e22", "employed", "c7z", "c7X"],
  ["e23", "employed", "c7s", "c7X"],
  ["e24", "employed", "c7f", "c7X"],
  ["e25", "employed", "c7n", "c7X"],
  ["e26", "employed", "c7t", "c7X"],
  ["e27", "employed", "c8p", "c8A"],
  ["e28", "friend", "c8p", "c8q"],
  ["e29", "connection", "c8A", "c8q"],
  ["e30", "connection", "c8p", null],
  // a deleted edge leads nowhere: c1a stays out of c9's group
  ["e36", "connection", "c1a", "c9e", { deleted: true }],
  ["e37", "employed", "c1b", "c9Q", { deleted: true }],
  ["e31", "owns", "c9P", "c9Q"],
  ["e32", "owns", "c9Q", "c9P"],
  ["e33", "employed", "c9e", "c9Q"],
];
/** Worked out by hand from the definition in server/db/groupSizes.ts. */
const EXPECTED: Record<string, number> = {
  c1a: 3,
  c1b: 3,
  c1c: 3, // b, c and itself through the cycle
  c2h: 3, // hidden, still sized: p (counted) and X; X's employees p, q as dead ends
  c2p: 3, // h (hidden, 0), X, itself via p-h-p (1); dead ends p, q (2)
  c2q: 2, // X (a place, 0); dead ends p, q
  c2X: 2, // nothing active; dead ends p, q
  c3Y: 1, // dead end e1 (e2 hidden, R a region)
  c3e1: 2, // Y and m (mentions backwards is active): m counts 1; dead end e1
  c3e2: 1, // Y: dead end e1
  c3R: 0, // seat leads to Y only as a dead end, and Y is not a person
  c3m: 1, // mentions is a dead end forwards: e1
  c4R: 3,
  c4P1: 3,
  c4P2: 2,
  c4w: 3,
  c4u: 2,
  c4v: 2, // owns R->P1->P2: dead ends w, u, v
  c5a: 0, // an active self link is dropped
  c5b: 1, // a dead-end self link stays: b is its own dead end
  c6p: 4,
  c6q: 4, // active q, p (cycle); dead ends p, q again (the dead end counts apart)
  c6X: 2,
  c7X: 4,
  c7z: 4,
  c7s: 4,
  c7f: 4,
  c7n: 4,
  c7t: 4, // hide 0, "", null, false count; "false" hides
  c8p: 0,
  c8q: 0,
  c8A: 0, // articles, unknown types and NULL ends drop out
  c9P: 1,
  c9Q: 1,
  c9e: 1, // P and Q reach each other; dead end e
};

async function load(sql: postgres.Sql, nodes: Row[], edges: EdgeRow[]) {
  await sql`TRUNCATE nodes, edges, node_derived`;
  for (const [id, type, data] of nodes)
    await sql`INSERT INTO nodes (id, data) VALUES (${id}, ${sql.json({ type, name: id, ...data })})`;
  for (const [id, type, source, target, extra] of edges)
    await sql`INSERT INTO edges (id, data) VALUES (${id}, ${sql.json({ type, source, target, ...extra })})`;
}

async function sizes(sql: postgres.Sql): Promise<Record<string, number>> {
  const rows = await sql<{ id: string; size: number }[]>`
    SELECT id, node_group_size AS size FROM node_derived ORDER BY id`;
  return Object.fromEntries(rows.map((r) => [r.id, r.size]));
}

describe.runIf(PG_TEST_DATABASE_URL)("nodeGroupSize, the nightly count", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await openTestDatabase("group_sizes");
    await installGroupSizesOracle(sql);
  }, 60_000);

  afterAll(async () => {
    await closeTestDatabase(sql);
  });

  beforeEach(async () => {
    await load(sql, NODES, EDGES);
  });

  it.each([1, 3])(
    "gives every node of the hand-made graphs its size on %i thread(s)",
    async (threads) => {
      const report = await refreshGroupSizes(sql, { threads });
      expect(await sizes(sql)).toEqual(EXPECTED);
      expect(report).toMatchObject({ nodes: NODES.length - 1, threads });
      expect(await groupSizeMismatches(sql)).toEqual({ count: 0, first: [] });
    },
  );

  it("writes only the rows that changed", async () => {
    await refreshGroupSizes(sql);
    expect((await refreshGroupSizes(sql)).changed).toBe(0);
    await sql`UPDATE node_derived SET node_group_size = 99 WHERE id IN ('c1a', 'c8A')`;
    expect((await refreshGroupSizes(sql)).changed).toBe(2);
    expect(await sizes(sql)).toEqual(EXPECTED);
  });

  it("gives a node without a row one, and 0 to a node that left the graph", async () => {
    await refreshGroupSizes(sql);
    await sql`INSERT INTO nodes (id, data) VALUES ('c1d', ${sql.json({ type: "person", name: "c1d" })})`;
    await sql`INSERT INTO edges (id, data) VALUES ('e34', ${sql.json({ type: "connection", source: "c1d", target: "c1a" })})`;
    await sql`UPDATE nodes SET data = data || '{"type": "article"}' WHERE id = 'c4P1'`;
    await refreshGroupSizes(sql);
    const got = await sizes(sql);
    // c1d joins the triangle: four people, each reaching all four.
    expect([got.c1a, got.c1b, got.c1c, got.c1d]).toEqual([4, 4, 4, 4]);
    // c4P1 is an article now: R reaches nothing, P1 is off the graph.
    expect([got.c4R, got.c4P1, got.c4w, got.c4P2]).toEqual([0, 0, 0, 2]);
    expect(await groupSizeMismatches(sql)).toEqual({ count: 0, first: [] });
  });

  it("walks a long chain and a wide star the same on one thread and on four", async () => {
    const nodes: Row[] = [["hub", "place"]];
    const edges: EdgeRow[] = [];
    for (let i = 0; i < 300; i++) {
      nodes.push([
        `p${String(i).padStart(4, "0")}`,
        "person",
        i % 7 === 0 ? { hide: true } : {},
      ]);
      edges.push([
        `w${i}`,
        "employed",
        `p${String(i).padStart(4, "0")}`,
        "hub",
      ]);
      if (i > 0)
        edges.push([
          `c${i}`,
          i % 50 === 0 ? "mentions" : "connection",
          `p${String(i - 1).padStart(4, "0")}`,
          `p${String(i).padStart(4, "0")}`,
        ]);
    }
    await load(sql, nodes, edges);
    await refreshGroupSizes(sql, { threads: 1 });
    const one = await sizes(sql);
    await sql`UPDATE node_derived SET node_group_size = -1`;
    await refreshGroupSizes(sql, { threads: 4 });
    expect(await sizes(sql)).toEqual(one);
    expect(await groupSizeMismatches(sql)).toEqual({ count: 0, first: [] });
  });

  it("leaves a size that a write moved after the snapshot to the write", async () => {
    await refreshGroupSizes(sql);
    const generation = await takeGeneration(sql);
    const { ids, graph } = await readGroupGraph(sql);
    // A write commits after the snapshot: c3m now connects to c1a.
    await sql.begin(async (tx) => {
      await tx`INSERT INTO edges (id, data) VALUES ('e35', ${tx.json({ type: "connection", source: "c3m", target: "c1a" })})`;
      await tx`SELECT refresh_node_derived_for(now(), '{}', '{c3m,c1a}')`;
    });
    const fresh = await sizes(sql);
    expect(fresh.c1a).toBe(EXPECTED.c1a! + 2); // c3m and its dead end c3e1
    const size = await walkGroupSizes(graph, 2);
    expect(size[ids.indexOf("c1a")]).toBe(EXPECTED.c1a);
    await writeGroupSizes(sql, ids, size, generation);
    expect(await sizes(sql)).toEqual(fresh);
    expect(await groupSizeMismatches(sql)).toEqual({ count: 0, first: [] });
  });

  it("drops a relation once it is deleted, at night and on the write", async () => {
    await refreshGroupSizes(sql);
    const before = { type: "connection", source: "c6p", target: "c6q" };
    const after = { ...before, deleted: true };
    expect([
      ...touchedBy([{ collection: "edges", id: "e20", before, after }]).ends,
    ]).toEqual(["c6p", "c6q"]);
    await sql.begin(async (tx) => {
      await tx`UPDATE edges SET data = ${tx.json(after)} WHERE id = 'e20'`;
      await tx`SELECT refresh_node_derived_for(now(), '{}', '{c6p,c6q}')`;
    });
    // Without the connection p and q each reach the place alone: their two
    // dead ends there.
    const written = await sizes(sql);
    expect([written.c6p, written.c6q, written.c6X]).toEqual([2, 2, 2]);
    await sql`UPDATE node_derived SET node_group_size = 4 WHERE id IN ('c6p', 'c6q')`;
    await refreshGroupSizes(sql);
    expect(await sizes(sql)).toEqual(written);
    expect(await groupSizeMismatches(sql)).toEqual({ count: 0, first: [] });
  });

  it("writes only after the incremental writes open at the time have committed", async () => {
    await refreshGroupSizes(sql);
    await sql`UPDATE node_derived SET node_group_size = 99 WHERE id = 'c1a'`;
    const writer = await sql.reserve();
    try {
      await writer`BEGIN`;
      await writer`SELECT write_node_group_sizes('{c5a}')`;
      let done = false;
      const job = refreshGroupSizes(sql).then((report) => {
        done = true;
        return report;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(done).toBe(false);
      await writer`COMMIT`;
      await job;
      expect(done).toBe(true);
    } finally {
      writer.release();
    }
    expect(await sizes(sql)).toEqual(EXPECTED);
  });
});
