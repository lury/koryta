import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type postgres from "postgres";
import handler from "~~/server/api/stats/homeTimeline.get";
import type { HomeTimelineResponse } from "~~/server/api/stats/homeTimeline.get";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored } from "./storedDocs";

/** /api/stats/homeTimeline on Postgres: which posts it counts and where it
 * seats their employers, over rows arranged per test.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/homeTimeline.pg.test.ts
 */

let sql: postgres.Sql;
let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};

vi.mock("~~/server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
}));
vi.hoisted(() => {
  // The function itself, not nitro's cache of it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = ((fn: any) => fn) as any;
});

const call = async () => {
  await syncStored(sql, {
    ...Object.fromEntries(
      Object.entries(nodes).map(([id, data]) => [`nodes/${id}`, data]),
    ),
    ...Object.fromEntries(
      Object.entries(edges).map(([id, data]) => [`edges/${id}`, data]),
    ),
  });
  return (handler as unknown as () => Promise<HomeTimelineResponse>)();
};

const post = (source: string, target: string, extra = {}) => ({
  type: "employed",
  source,
  target,
  published: true,
  start_date: "2024-01-15",
  ...extra,
});
const seat = (source: string, target: string, extra = {}) => ({
  type: "seat",
  source,
  target,
  published: true,
  ...extra,
});
const keys = (r: HomeTimelineResponse, g: "party" | "region" | "category") =>
  r.groupings[g].map((s) => [s.key, s.label]);

describe.runIf(PG_TEST_DATABASE_URL)(
  "api/stats/homeTimeline on Postgres",
  () => {
    beforeAll(async () => {
      sql = await openTestDatabase("home_timeline");
    }, 120_000);
    afterAll(async () => {
      await closeTestDatabase(sql);
    });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-09T10:00:00Z"));
      nodes = {
        anna: {
          type: "person",
          name: "Anna",
          published: true,
          parties: ["PiS"],
        },
        jan: {
          type: "person",
          name: "Jan",
          published: true,
          parties: { 0: "PiS" },
        },
        draft: { type: "person", name: "Szkic", published: false },
        gone: {
          type: "person",
          name: "Usunięta",
          published: true,
          deleted: true,
        },
        orlen: {
          type: "place",
          name: "Orlen",
          published: true,
          categories: ["energetyka"],
        },
        hidden: { type: "place", name: "Ukryta", published: false },
        woj14: { type: "region", name: "mazowieckie", teryt: "14" },
        woj12: { type: "region", name: "Województwo Małopolskie", teryt: "12" },
        powiat: { type: "region", name: "Powiat płocki", teryt: "1419" },
        gmina: { type: "region", name: "Gmina Kraków", teryt: "1261011" },
      };
      edges = {};
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("counts published posts between published pages only", async () => {
      edges.a = post("anna", "orlen");
      edges.b = post("draft", "orlen");
      edges.c = post("gone", "orlen");
      edges.d = post("jan", "hidden");
      edges.e = post("jan", "orlen", { published: false });
      edges.f = post("jan", "orlen", { deleted: true });
      edges.g = post("jan", "orlen", { start_date: null });
      const r = await call();
      expect(r.posts).toBe(1);
      expect(keys(r, "party")).toEqual([["PiS", "PiS"]]);
      expect(keys(r, "category")).toEqual([["energetyka", expect.any(String)]]);
      expect(r.coverage.party).toEqual({ posts: 1, people: 1 });
    });

    it("reads parties stored as an object", async () => {
      edges.a = post("jan", "orlen");
      expect(keys(await call(), "party")).toEqual([["PiS", "PiS"]]);
    });

    it("seats an employer by its most specific published seat", async () => {
      edges.a = post("anna", "orlen");
      edges.s1 = seat("woj12", "orlen");
      edges.s2 = seat("powiat", "orlen");
      // Not a seat anybody published, nor one still standing.
      edges.s3 = seat("gmina", "orlen", { published: false });
      edges.s4 = seat("gmina", "orlen", { deleted: true });
      const r = await call();
      expect(keys(r, "region")).toEqual([["14", "Województwo mazowieckie"]]);
      expect(r.coverage.region).toEqual({ posts: 1, people: 1 });
    });

    it("breaks a tie between equally specific seats by region id", async () => {
      nodes.powiatB = {
        type: "region",
        name: "Powiat krakowski",
        teryt: "1206",
      };
      edges.a = post("anna", "orlen");
      edges.s1 = seat("powiatB", "orlen");
      edges.s2 = seat("powiat", "orlen");
      expect(keys(await call(), "region")).toEqual([
        ["14", "Województwo mazowieckie"],
      ]);
    });

    it("names a województwo without its region node after the seat", async () => {
      delete nodes.woj14;
      edges.a = post("anna", "orlen");
      edges.s = seat("powiat", "orlen");
      expect(keys(await call(), "region")).toEqual([["14", "Powiat płocki"]]);
    });

    it("leaves an employer with no seat out of the regions", async () => {
      edges.a = post("anna", "orlen");
      const r = await call();
      expect(r.groupings.region).toEqual([]);
      expect(r.coverage.region).toEqual({ posts: 0, people: 0 });
    });
  },
);
