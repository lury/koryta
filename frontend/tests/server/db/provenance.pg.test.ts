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
import { importedOrReviewedPg } from "~~/server/db/provenance";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import type { LoggedQuery } from "./queryLog";

/** Which unpublished documents a logged out reader may glimpse: an import's
 * or a reviewer's, read from the revisions on Postgres.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/provenance.pg.test.ts
 */

const { queries } = vi.hoisted(() => ({ queries: [] as LoggedQuery[] }));
vi.mock("~~/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~~/server/db/client")>();
  const { logQueries } =
    await vi.importActual<typeof import("./queryLog")>("./queryLog");
  return { ...actual, useDb: () => logQueries(actual.useDb(), queries) };
});

const store = new Collections();
let sql: postgres.Sql;

/** Revisions of `nodeId`, the first `minutes` apart from 10:00. */
function history(nodeId: string, revisions: Record<string, unknown>[]) {
  revisions.forEach((revision, i) => {
    store.table("revisions")[`${nodeId}-r${i}`] = {
      node_id: nodeId,
      update_time: new Date(Date.UTC(2026, 10, 20, 10, i)).toISOString(),
      ...revision,
    };
  });
}

describe.runIf(PG_TEST_DATABASE_URL)("importedOrReviewedPg", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("provenance");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    store.clear();
    queries.length = 0;
  });

  it("takes a document an import wrote first", async () => {
    history("imported", [
      { update_automatic: true },
      // A contributor's pending edit since changes nothing about who wrote
      // the document.
      { update_automatic: false, status: "pending" },
    ]);
    await store.sync(sql);
    expect(await importedOrReviewedPg([{ id: "imported" }])).toEqual(
      new Set(["imported"]),
    );
  });

  it("refuses a document a contributor created", async () => {
    history("proposed", [{ update_automatic: false, status: "pending" }]);
    history("older", [{ update_user: "uid-of-somebody" }]);
    await store.sync(sql);
    expect(
      await importedOrReviewedPg([{ id: "proposed" }, { id: "older" }]),
    ).toEqual(new Set());
  });

  it("refuses a document with no history to answer from", async () => {
    await store.sync(sql);
    expect(await importedOrReviewedPg([{ id: "legacy" }])).toEqual(new Set());
  });

  it("takes a reviewed document without reading its history", async () => {
    history("approved", [{ update_automatic: false }]);
    await store.sync(sql);
    queries.length = 0;
    expect(
      await importedOrReviewedPg([
        { id: "approved", revision_id: "revisions/r1" },
      ]),
    ).toEqual(new Set(["approved"]));
    expect(queries).toEqual([]);
  });

  it("reads each document once, every one in one query", async () => {
    history("a", [{ update_automatic: true }]);
    history("b", [{ update_automatic: false }]);
    await store.sync(sql);
    queries.length = 0;
    expect(
      await importedOrReviewedPg([{ id: "a" }, { id: "a" }, { id: "b" }, {}]),
    ).toEqual(new Set(["a"]));
    expect(queries).toHaveLength(1);
    expect(queries[0]!.args[0]).toEqual(["a", "b"]);
  });
});
