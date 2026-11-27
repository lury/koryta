import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { searchChunk, searchKrs } from "~~/server/db/search";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** The two reads /api/search is made of, on Postgres: a chunk of a name
 * against the search columns of 0101_a_search.sql, and a KRS number. What the
 * route makes of their rows is tests/server/api/search.test.ts.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/search.pg.test.ts
 */

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

const node = (
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
) => {
  table("nodes")[id] = { type: "person", name, published: true, ...extra };
};
/** The group sizes the order goes by, as the night writes them. */
async function sizes(of: Record<string, number>) {
  for (const [id, size] of Object.entries(of))
    await sql`INSERT INTO node_derived (id, node_group_size) VALUES (${id}, ${size})
      ON CONFLICT (id) DO UPDATE SET node_group_size = EXCLUDED.node_group_size`;
}
const ids = (rows: { node: { id: string } }[]) => rows.map((r) => r.node.id);

describe.runIf(PG_TEST_DATABASE_URL)("/api/search's reads on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("search");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
  });

  it("matches a prefix of the whole name or of any of its words", async () => {
    node("jan", "Jan Kowalski");
    node("anna", "Anna Kowalska-Nowak");
    node("other", "Piotr Nowicki");
    await store.sync(sql);
    expect(ids(await searchChunk("kowal", 10)).sort()).toEqual(["anna", "jan"]);
    expect(ids(await searchChunk("jan kow", 10))).toEqual(["jan"]);
    // The middle of a word is no chunk.
    expect(ids(await searchChunk("owalski", 10))).toEqual([]);
  });

  it("matches a chunk with a space only at the start of the whole name", async () => {
    node("jan", "Jan Kowalski");
    await store.sync(sql);
    expect(ids(await searchChunk("kowalski jan", 10))).toEqual([]);
    expect(ids(await searchChunk("jan kowalski", 10))).toEqual(["jan"]);
  });

  it("answers a town chunk from the town bracket only, one word at a time", async () => {
    node("sanikom", "SANIKOM (Lubawka)", { type: "place" });
    node("lubawka-person", "Lubawka Nowak");
    await store.sync(sql);
    expect(ids(await searchChunk("@lubaw", 10))).toEqual(["sanikom"]);
    expect(ids(await searchChunk("@lubawka x", 10))).toEqual([]);
    expect(ids(await searchChunk("@", 10))).toEqual([]);
    // The town is not a word of the company's own name.
    expect(ids(await searchChunk("lubawka", 10))).toEqual(["lubawka-person"]);
  });

  it("reads persons, places and regions only, everything for the empty chunk", async () => {
    node("p", "Anna");
    node("c", "Anna Sp. z o.o.", { type: "place" });
    node("r", "Annopol", { type: "region" });
    node("a", "Anna w gazecie", { type: "article" });
    await store.sync(sql);
    expect(ids(await searchChunk("ann", 10)).sort()).toEqual(["c", "p", "r"]);
    expect(ids(await searchChunk("", 10)).sort()).toEqual(["c", "p", "r"]);
  });

  it("puts the largest group first, ties by id going down, and cuts at the limit", async () => {
    node("a1", "Jan A");
    node("a2", "Jan B");
    node("a3", "Jan C");
    await store.sync(sql);
    await sizes({ a1: 5, a2: 9, a3: 5 });
    expect(ids(await searchChunk("jan", 10))).toEqual(["a2", "a3", "a1"]);
    expect(ids(await searchChunk("jan", 2))).toEqual(["a2", "a3"]);
  });

  it("hands back a merged-away page marked, and the served document", async () => {
    node("gone", "Jan Kowalski", { deleted: true, merged_into: "jan" });
    node("jan", "Jan Kowalski", { published: false });
    await store.sync(sql);
    await sizes({ jan: 2, gone: 1 });
    const rows = await searchChunk("jan", 10);
    expect(rows.map((r) => [r.node.id, r.deleted, r.node.visibility])).toEqual([
      ["jan", false, false],
      ["gone", true, false],
    ]);
    expect(rows[0]!.node.stats).toMatchObject({ nodeGroupSize: 2 });
    expect(rows[0]!.node).not.toHaveProperty("nameChunksLower");
  });

  it("finds a company by its KRS number, and only a company", async () => {
    node("pgk", "SANIKOM", { type: "place", krsNumber: "0000029741" });
    node("person", "Jan", { krsNumber: "0000029741" });
    node("numeric", "X", { type: "place", krsNumber: 29741 });
    await store.sync(sql);
    expect(ids(await searchKrs("0000029741"))).toEqual(["pgk"]);
    expect(await searchKrs("0000000001")).toEqual([]);
  });
});
