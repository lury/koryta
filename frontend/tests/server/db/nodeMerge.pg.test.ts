import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { editorialTx } from "~~/server/db/editorial";
import { applyNodeMergePg, resolveMergedNodePg } from "~~/server/db/nodeMerge";
import type { MergePlan } from "~~/server/utils/merge";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** The two steps of a merge that touch the store, on Postgres: following
 * `merged_into` to the page a reader lands on (resolveMergedNodePg), and
 * carrying out a plan (applyNodeMergePg). What the plan says is
 * tests/server/utils/merge.test.ts's.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/nodeMerge.pg.test.ts
 */

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);
});

let sql: postgres.Sql;

const { queries } = vi.hoisted(() => ({ queries: [] as LoggedQuery[] }));
// Every query the handler sends, logged: which tables a call read.
vi.mock("~~/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/db/client")>();
  const { logQueries } =
    await vi.importActual<typeof import("./queryLog")>("./queryLog");
  // Statements inside a transaction are logged too.
  const logged = (sql: ReturnType<typeof actual.useDb>) =>
    new Proxy(logQueries(sql, queries), {
      get(target, key, receiver) {
        if (key !== "begin") return Reflect.get(target, key, receiver);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (...args: any[]) => {
          const fn = args.pop();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (sql.begin as any)(...args, (tx: any) =>
            fn(logQueries(tx, queries)),
          );
        };
      },
    });
  return { ...actual, useDb: () => logged(actual.useDb()) };
});

/** Writes `stored` to the tables and starts the query log afresh. */
async function arrange(stored: StoredDocs) {
  await syncStored(sql, stored);
  queries.length = 0;
}

/** Opens this file's database; run inside the describe. */
function useDatabase() {
  beforeAll(async () => {
    sql = await openTestDatabase("node_merge");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}

type Data = Record<string, unknown>;

const rows = async (table: string) =>
  sql<{ id: string; data: Data }[]>`
    SELECT id, data FROM ${sql(table)} ORDER BY id`;

/** A spell of employment, the ordinary `identicalMeansSame: true` case. */
function employed(source: string, target: string, start = "2020-01-01") {
  return {
    type: "employed",
    source,
    target,
    name: "Prezes zarządu",
    start_date: start,
  };
}

/** A candidacy - the one type where identical fields prove nothing. */
function election(source: string, target: string) {
  return {
    type: "election",
    source,
    target,
    position: "Samorząd",
    start_date: "2024",
    party: "PiS",
    committee: "KW Prawo i Sprawiedliwość",
    term: "2024-2029",
  };
}

describe.runIf(PG_TEST_DATABASE_URL)("merging pages on Postgres", () => {
  useDatabase();

  describe("resolveMergedNodePg", () => {
    const nodes = (docs: Record<string, Data>) =>
      arrange(
        Object.fromEntries(
          Object.entries(docs).map(([id, data]) => [
            `nodes/${id}`,
            { type: "person", ...data },
          ]),
        ),
      );

    it("answers with the page itself when it was never merged, at one read", async () => {
      await nodes({ a: { name: "Andrzej Golimont" } });

      const resolved = await resolveMergedNodePg(sql, "a");

      expect(resolved.id).toBe("a");
      expect(resolved.data).toMatchObject({ name: "Andrzej Golimont" });
    });

    it("follows a merged page to the one that survived it", async () => {
      await nodes({
        a: { name: "Andrzej Golimont", merged_into: "b" },
        b: { name: "Andrzej Marcin Golimont" },
      });

      const resolved = await resolveMergedNodePg(sql, "a");

      expect(resolved.id).toBe("b");
      expect(resolved.data).toMatchObject({ name: "Andrzej Marcin Golimont" });
    });

    it("follows a chain to the end of it", async () => {
      // Merges are resolved on the way in, so a chain should not form - but
      // two admins merging in opposite directions can build one, and a reader
      // landing half way along it would see a page that says nothing.
      await nodes({
        a: { merged_into: "b" },
        b: { merged_into: "c" },
        c: { name: "the page that stayed" },
      });

      expect((await resolveMergedNodePg(sql, "a")).id).toBe("c");
    });

    it("stops on a cycle rather than hanging the page load", async () => {
      // Two pages merged into each other is a bug in whatever wrote the
      // second pointer; the page it was reached from is still a better answer
      // than a request that never returns.
      await nodes({ a: { merged_into: "b" }, b: { merged_into: "a" } });

      const resolved = await resolveMergedNodePg(sql, "a");

      expect(["a", "b"]).toContain(resolved.id);
    });

    it("gives back the id it could not find, with no document", async () => {
      await nodes({ a: { merged_into: "gone" } });

      const resolved = await resolveMergedNodePg(sql, "a");

      expect(resolved.id).toBe("gone");
      expect(resolved.data).toBeUndefined();
    });
  });

  describe("applyNodeMergePg", () => {
    const plan: MergePlan = {
      duplicate_id: "dup",
      survivor_id: "surv",
      votes: [],
      carried: {},
      edges: [
        {
          edge_id: "out",
          type: "employed",
          role: "source",
          disposition: "moved",
        },
        {
          edge_id: "in",
          type: "mentions",
          role: "target",
          disposition: "moved",
        },
        {
          edge_id: "same",
          type: "employed",
          role: "source",
          disposition: "collapsed",
          duplicate_of: "s1",
        },
        {
          edge_id: "kandydatura",
          type: "election",
          role: "source",
          disposition: "review",
          duplicate_of: "s2",
        },
        {
          edge_id: "loop",
          type: "employed",
          role: "both",
          disposition: "self",
        },
      ],
      counts: { moved: 2, collapsed: 1, review: 1, self: 1 },
    } as MergePlan;

    const edges: Record<string, Data> = {
      out: employed("dup", "firma"),
      in: { type: "mentions", source: "artykul", target: "dup" },
      same: { ...employed("dup", "firma"), published: true, stats: { c: 1 } },
      kandydatura: election("dup", "powiat"),
      loop: employed("dup", "dup"),
    };

    async function apply(
      reason = "Jedna osoba, dwie strony",
      what: MergePlan = plan,
      present: Record<string, Data> = edges,
    ) {
      await arrange({
        "nodes/dup": {
          type: "person",
          name: "Andrzej Golimont",
          published: true,
        },
        "nodes/surv": {
          type: "person",
          name: "Andrzej M. Golimont",
          published: true,
        },
        "nodes/firma": { type: "place", name: "Firma", published: true },
        "nodes/powiat": { type: "region", name: "Powiat", published: true },
        "nodes/artykul": { type: "article", name: "Artykuł", published: true },
        ...Object.fromEntries(
          Object.entries(present).map(([id, data]) => [`edges/${id}`, data]),
        ),
      });
      await editorialTx((tx, log) =>
        applyNodeMergePg(tx, log, { uid: "admin-uid" }, what, reason),
      );
    }
    const edge = async (id: string) =>
      (await rows("edges")).find((row) => row.id === id)?.data;

    it("re-points the moved relation at the survivor, and only the end that named the duplicate", async () => {
      await apply();

      expect(await edge("out")).toMatchObject({
        source: "surv",
        target: "firma",
      });
      expect(await edge("in")).toMatchObject({
        source: "artykul",
        target: "surv",
      });
    });

    it("moves a relation held for review rather than removing it", async () => {
      // A candidacy the survivor appears to state already is still kept: the
      // report is what a human reads, and nothing is thrown away on it.
      await apply();

      expect(await edge("kandydatura")).toMatchObject({ source: "surv" });
      expect((await edge("kandydatura"))?.deleted).toBeUndefined();
    });

    it("removes a collapsed relation with a revision saying why", async () => {
      // The half of the merge most likely to have been wrong, so it goes the
      // way /api/edges/delete removes one - soft, reasoned, and approved as
      // written, because an admin merging two pages is the review of what it
      // removes.
      await apply();

      expect(await edge("same")).toMatchObject({
        deleted: true,
        delete_reason: expect.stringContaining("s1"),
      });
      expect(
        (await rows("revisions"))
          .map((row) => row.data)
          .filter((revision) => revision.node_id === "same"),
      ).toEqual([
        expect.objectContaining({
          collection: "edges",
          status: "approved",
          review_user: "admin-uid",
          data: expect.objectContaining({ deleted: true }),
        }),
      ]);
    });

    it("keeps the counters the collapsed relation's document owns", async () => {
      // The revision replaces the document; anything it does not carry is
      // dropped unless it is layered back on.
      await apply();

      expect(await edge("same")).toMatchObject({ stats: { c: 1 } });
    });

    it("says a loop went because it led to itself, not because something else said it", async () => {
      await apply();

      expect(await edge("loop")).toMatchObject({
        deleted: true,
        delete_reason: expect.stringContaining("samo do siebie"),
      });
    });

    it("puts the duplicate to rest pointing at the survivor", async () => {
      // The document stays: its url still resolves, its votes and revisions
      // still have something to hang off, and `pageIsPublic` reads `deleted`
      // already - so it leaves the public site without anything learning a new
      // rule.
      await apply("Jedna osoba, dwie strony");

      expect(
        (await rows("nodes")).find((row) => row.id === "dup")?.data,
      ).toMatchObject({
        deleted: true,
        delete_reason: "Jedna osoba, dwie strony",
        merged_into: "surv",
        published: false,
      });
    });

    it("files the merge naming both pages and every relation it touched", async () => {
      // This entry is what an undo would need: nothing else records which
      // relations were on which page before the merge.
      await apply();

      expect((await rows("audit")).map((row) => row.data)).toEqual([
        expect.objectContaining({
          action: "merge",
          collection: "nodes",
          target_id: "dup",
          user: "admin-uid",
          reason: "Jedna osoba, dwie strony",
          merge: expect.objectContaining({
            into: "surv",
            moved: ["out", "in", "kandydatura"],
            collapsed: ["same", "loop"],
          }),
        }),
      ]);
    });

    it("skips a relation that has gone since the plan was made", async () => {
      // The plan is read before the transaction; an edge deleted in between
      // would otherwise be written back into existence by the removal
      // revision.
      await apply("Powód", { ...plan, edges: [plan.edges[0]!] }, {});

      expect(await rows("edges")).toEqual([]);
      expect(await rows("revisions")).toEqual([]);
      expect(
        (await rows("nodes")).find((row) => row.id === "dup")?.data,
      ).toMatchObject({ merged_into: "surv" });
    });
  });
});
