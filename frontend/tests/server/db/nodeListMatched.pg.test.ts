import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { listNodes } from "~~/server/db/nodes";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** `listNodes` (/api/nodes) on Postgres: what `matched` names for a row.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/nodeListMatched.pg.test.ts
 */

const store = new Collections();
let sql: postgres.Sql;

describe.runIf(PG_TEST_DATABASE_URL)("listNodes", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("node_list_matched");
    const nodes = store.table("nodes");
    nodes.malopolska = {
      type: "region",
      name: "małopolskie",
      teryt: "12",
      published: true,
    };
    nodes.mazowsze = {
      type: "region",
      name: "mazowieckie",
      teryt: "14",
      published: true,
    };
    nodes.powiat = {
      type: "region",
      name: "Warszawa",
      teryt: "1465",
      published: true,
    };
    nodes.szpital = {
      type: "place",
      name: "Szpital Bródnowski",
      categories: ["szpitale"],
      published: true,
    };
    nodes.krakow = {
      type: "place",
      name: "Szpital w Krakowie",
      categories: ["szpitale"],
      published: true,
    };
    nodes.anna = { type: "person", name: "Anna Nowak", published: true };
    nodes.jan = { type: "person", name: "Jan Kowal", published: true };
    const edges = store.table("edges");
    edges.seat = {
      type: "seat",
      source: "powiat",
      target: "szpital",
      published: true,
    };
    edges.seatK = {
      type: "seat",
      source: "malopolska",
      target: "krakow",
      published: true,
    };
    edges.anna = {
      type: "employed",
      source: "anna",
      target: "szpital",
      published: true,
      start_date: "2020-01-01",
    };
    edges.jan = {
      type: "employed",
      source: "jan",
      target: "krakow",
      published: true,
      start_date: "2020-01-01",
    };
    await store.sync(sql);
    await sql`SELECT refresh_node_stats()`;
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });

  it("names both the sector's places and the regions of a teryt filter", async () => {
    const list = await listNodes(
      { type: "person", category: "szpitale", teryt: "14" },
      false,
    );
    expect(list).not.toBe("empty");
    if (list === "empty") return;
    expect(list.rows.map((row) => row.id)).toEqual(["anna"]);
    expect([...(list.targetIds ?? [])].sort()).toEqual([
      "mazowsze",
      "powiat",
      "szpital",
    ]);
  });

  it("names the sector's places alone without one", async () => {
    const list = await listNodes(
      { type: "person", category: "szpitale" },
      false,
    );
    if (list === "empty") throw new Error("empty");
    expect(list.rows.map((row) => row.id).sort()).toEqual(["anna", "jan"]);
    expect([...(list.targetIds ?? [])].sort()).toEqual(["krakow", "szpital"]);
  });
});
