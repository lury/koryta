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
import { requireAdmin } from "~~/server/utils/auth";
import handler from "~~/server/api/edges/byNode.get";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** /api/edges/byNode on Postgres: the relations of one node for the publish
 * dialog, arranged as documents and read from their tables.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/edgesByNode.pg.test.ts
 */

let stored: StoredDocs = {};
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

vi.mock("~~/server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockGetValidatedQuery } = vi.hoisted(() => {
  const mockGetValidatedQuery = vi.fn();
  globalThis.getValidatedQuery = mockGetValidatedQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockGetValidatedQuery };
});

/** Makes the next request carry `query`, with Nitro's 400 for a query the
 * schema rejects. */
function request(query: Record<string, unknown>) {
  mockGetValidatedQuery.mockImplementation(
    async (_event: unknown, parse: (q: unknown) => unknown) => {
      try {
        return parse(query);
      } catch {
        throw { statusCode: 400, statusMessage: "Bad Request" };
      }
    },
  );
}

/** The queries the call sent to `table`. */
const queriesOf = (table: string) =>
  queries.filter((query) => new RegExp(`FROM ${table}\\b`).test(query.text));

type Relation = {
  id: string;
  direction: "outgoing" | "incoming";
  otherId: string;
  otherName: string | null;
  otherPublished: boolean;
  published: boolean;
  hasPendingRevision: boolean;
  publishable: boolean;
};

type Result = { relations: Relation[]; nodePublished: boolean };

const callHandler = async () => {
  await syncStored(sql, stored);
  queries.length = 0;
  return (handler as unknown as (event: unknown) => Promise<Result>)({});
};

/** The returned relations by id, for the assertions that do not care about
 * the order they came back in. */
function byId(result: Result): Record<string, Relation> {
  return Object.fromEntries(result.relations.map((r) => [r.id, r]));
}

/** A published node, which is the uninteresting end of most of these edges. */
function publishedNode(name: string) {
  return { name, published: true };
}

/** A job of node-1's, as the edge and the revision that wrote it both say. */
const employment = { source: "node-1", target: "node-2", type: "employed" };

describe.runIf(PG_TEST_DATABASE_URL)("api/edges/byNode on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("edges_by_node");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    stored["nodes/node-1"] = publishedNode("Jan Kowalski");
    request({ nodeId: "node-1" });
  });

  it("returns the relations the node points at and the ones pointing at it", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["nodes/node-3"] = publishedNode("Firma B");
    stored["edges/e-out"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
    };
    stored["edges/e-in"] = {
      source: "node-3",
      target: "node-1",
      type: "mentions",
    };

    const relations = byId(await callHandler());

    expect(Object.keys(relations).sort()).toEqual(["e-in", "e-out"]);
    expect(relations["e-out"]?.direction).toBe("outgoing");
    expect(relations["e-in"]?.direction).toBe("incoming");
  });

  it("describes the other end of the relation, whichever end that is", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["nodes/node-3"] = publishedNode("Gazeta");
    stored["edges/e-out"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
    };
    stored["edges/e-in"] = {
      source: "node-3",
      target: "node-1",
      type: "mentions",
    };

    const relations = byId(await callHandler());

    expect(relations["e-out"]).toMatchObject({
      otherId: "node-2",
      otherName: "Firma A",
      otherPublished: true,
    });
    expect(relations["e-in"]).toMatchObject({
      otherId: "node-3",
      otherName: "Gazeta",
      otherPublished: true,
    });
  });

  it("blocks a relation whose other end is still a draft", async () => {
    // The row is greyed out on this flag alone: publishing an edge into a page
    // nobody can open is the thing the invariant exists to prevent.
    stored["nodes/node-2"] = { name: "Szkic", published: false };
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      otherPublished: false,
      publishable: false,
    });
  });

  it("blocks a relation whose other end does not exist at all", async () => {
    // A dangling edge is worse than one pointing at a draft, so the missing
    // document has to read as unpublished rather than as unknown.
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-missing",
      type: "employed",
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      otherId: "node-missing",
      otherName: null,
      otherPublished: false,
      publishable: false,
    });
  });

  it("reports whether each relation is itself on the site", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-live"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: true,
    };
    stored["edges/e-draft"] = {
      source: "node-1",
      target: "node-2",
      type: "owns",
      published: false,
    };

    const relations = byId(await callHandler());

    expect(relations["e-live"]?.published).toBe(true);
    expect(relations["e-draft"]?.published).toBe(false);
  });

  it("flags an unpublished relation that still has a proposal waiting", async () => {
    // The dialog says so - which it can only do if the handler looked the
    // proposal up.
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: false,
    };
    stored["revisions/rev-1"] = { node_id: "e-1", status: "pending" };

    const relations = byId(await callHandler());

    expect(relations["e-1"]?.hasPendingRevision).toBe(true);
  });

  it("does not flag a relation whose proposals have all been answered", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: false,
    };
    stored["revisions/rev-1"] = { node_id: "e-1", status: "rejected" };

    const relations = byId(await callHandler());

    expect(relations["e-1"]?.hasPendingRevision).toBe(false);
  });

  it("does not flag a relation that already points at an approved proposal", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: false,
      revision_id: { path: "revisions/rev-approved" },
    };
    stored["revisions/rev-1"] = { node_id: "e-1", status: "pending" };

    const relations = byId(await callHandler());

    expect(relations["e-1"]?.hasPendingRevision).toBe(false);
  });

  it("does not go looking for proposals on a relation that is already live", async () => {
    // One revisions query per row is an N+1 the dialog cannot afford, and a
    // published edge has nothing outstanding for a reviewer to decide anyway.
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: true,
    };
    stored["revisions/rev-1"] = { node_id: "e-1", status: "pending" };

    const relations = byId(await callHandler());

    expect(relations["e-1"]?.hasPendingRevision).toBe(false);
    expect(queriesOf("revisions")).toEqual([]);
  });

  it("leaves out relations that were removed", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-gone"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      deleted: true,
    };
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "owns",
    };

    const result = await callHandler();

    expect(result.relations.map((r) => r.id)).toEqual(["e-1"]);
  });

  it("lists a relation from the node to itself once", async () => {
    // Both the source and the target query return it, and a reviewer seeing
    // the same row twice would tick it twice.
    stored["edges/e-self"] = {
      source: "node-1",
      target: "node-1",
      type: "connection",
    };

    const result = await callHandler();

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({
      id: "e-self",
      direction: "outgoing",
      otherId: "node-1",
      publishable: true,
    });
  });

  it("puts the relations that are not yet live first", async () => {
    // The dialog is a work queue, so what still needs a decision goes on top.
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-live"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: true,
    };
    stored["edges/e-draft"] = {
      source: "node-1",
      target: "node-2",
      type: "owns",
      published: false,
    };

    const result = await callHandler();

    expect(result.relations.map((r) => r.id)).toEqual(["e-draft", "e-live"]);
  });

  it("puts the relations that can be published before the ones blocked on a draft", async () => {
    // Alphabetically the blocked one would come first, so the order proves the
    // rule rather than the tie-break that follows it.
    stored["nodes/node-blocked"] = { name: "Alfa", published: false };
    stored["nodes/node-ready"] = publishedNode("Zeta");
    stored["edges/e-blocked"] = {
      source: "node-1",
      target: "node-blocked",
      type: "employed",
    };
    stored["edges/e-ready"] = {
      source: "node-1",
      target: "node-ready",
      type: "owns",
    };

    const result = await callHandler();

    expect(result.relations.map((r) => r.id)).toEqual(["e-ready", "e-blocked"]);
  });

  it("says when a candidacy was and for what office", async () => {
    // Every candidacy is named „kandydatura", so these are what tell a page's
    // runs apart - and what the dialog's two-places check groups them by.
    stored["nodes/teryt3003"] = publishedNode("Powiat gnieźnieński");
    stored["edges/run"] = {
      source: "node-1",
      target: "teryt3003",
      type: "election",
      name: "kandydatura",
      start_date: "2002-01-01",
      position: "Samorząd",
    };
    stored["edges/job"] = employment;
    stored["nodes/node-2"] = publishedNode("Firma A");

    const relations = byId(await callHandler());

    expect(relations["run"]).toMatchObject({
      startDate: "2002-01-01",
      position: "Samorząd",
      byElection: false,
    });
    expect(relations["job"]).toMatchObject({
      startDate: null,
      position: null,
      byElection: false,
    });
  });

  it("says when a candidacy was in a by-election", async () => {
    // A contest of its own, which the dialog's two-places check leaves out,
    // as the publication's hold does.
    stored["nodes/teryt3003"] = publishedNode("Powiat gnieźnieński");
    stored["edges/run"] = {
      source: "node-1",
      target: "teryt3003",
      type: "election",
      name: "kandydatura",
      start_date: "2016-01-01",
      position: "Rada gminy",
      by_election: true,
    };

    const relations = byId(await callHandler());

    expect(relations["run"]).toMatchObject({ byElection: true });
  });

  it("lists several runs in one place newest first", async () => {
    stored["nodes/teryt3003"] = publishedNode("Powiat gnieźnieński");
    for (const year of ["2006", "2018", "2002"]) {
      stored[`edges/run-${year}`] = {
        source: "node-1",
        target: "teryt3003",
        type: "election",
        start_date: `${year}-01-01`,
      };
    }

    const result = await callHandler();

    expect(result.relations.map((r) => r.id)).toEqual([
      "run-2018",
      "run-2006",
      "run-2002",
    ]);
  });

  it("reports whether the node itself is published", async () => {
    stored["nodes/node-1"] = { name: "Jan Kowalski", published: false };

    expect((await callHandler()).nodePublished).toBe(false);

    stored["nodes/node-1"] = publishedNode("Jan Kowalski");

    expect((await callHandler()).nodePublished).toBe(true);
  });

  it("reports a node that does not exist as unpublished", async () => {
    stored = {};

    const result = await callHandler();

    expect(result).toEqual({
      relations: [],
      nodePublished: false,
      nodeParties: [],
    });
  });

  it("names the parties a candidacy gives the page, and none for a job", async () => {
    // What the dialog shows beside a run in two places: the party a
    // namesake's run puts on the page.
    stored["nodes/teryt3003"] = publishedNode("Powiat gnieźnieński");
    stored["edges/run"] = {
      source: "node-1",
      target: "teryt3003",
      type: "election",
      start_date: "2024-01-01",
      party: "PiS",
      member_parties: ["PSL", 7],
      backing_parties: ["PiS", "Razem"],
    };
    stored["edges/bare"] = {
      source: "node-1",
      target: "teryt3003",
      type: "election",
      start_date: "2018-01-01",
      party: "",
    };
    stored["edges/job"] = { ...employment, party: "PO" };
    stored["nodes/node-2"] = publishedNode("Firma A");

    const relations = byId(await callHandler());

    expect(relations["run"]!.parties).toEqual(["PiS", "PSL", "Razem"]);
    expect(relations["bare"]!.parties).toEqual([]);
    expect(relations["job"]!.parties).toEqual([]);
  });

  it("returns the page's parties as stored", async () => {
    stored["nodes/node-1"] = {
      name: "Jan Kowalski",
      published: false,
      parties: ["PO", "PiS"],
    };

    expect((await callHandler()).nodeParties).toEqual(["PO", "PiS"]);

    stored["nodes/node-1"] = { name: "Jan Kowalski", parties: "PO" };

    expect((await callHandler()).nodeParties).toEqual(["PO"]);

    stored["nodes/node-1"] = { name: "Jan Kowalski" };

    expect((await callHandler()).nodeParties).toEqual([]);
  });

  it("is refused to everyone but an admin", async () => {
    // Which pages are still drafts is not something an anonymous caller has
    // any business enumerating.
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
    };

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 403 });
    expect(queries).toEqual([]);
  });

  it("names the revision publishing would approve, whatever its status", async () => {
    // What the reviewer needs to know is which version goes live, not whether
    // somebody happened to stamp it "pending". Reporting every unpointed
    // relation as a proposal awaiting a verdict said the same thing about all
    // of them and was wrong about most.
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = { ...employment };
    stored["revisions/rev-1"] = {
      node_id: "e-1",
      status: "approved",
      update_time: "2026-01-01T00:00:00.000Z",
      data: employment,
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      revisionToApprove: "rev-1",
      hasPendingRevision: false,
    });
  });

  it("still says so when a revision really is awaiting a verdict", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = { ...employment };
    stored["revisions/rev-1"] = {
      node_id: "e-1",
      status: "pending",
      update_time: "2026-01-01T00:00:00.000Z",
      data: employment,
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      revisionToApprove: "rev-1",
      hasPendingRevision: true,
    });
  });

  it("never offers to approve a proposal the relation does not hold", async () => {
    // Publishing leaves such a proposal waiting, so the dialog must not say
    // the newest revision will be approved: it is still waiting afterwards.
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "election",
      start_date: "2024-01-01",
    };
    stored["revisions/proposal_e-1_x"] = {
      node_id: "e-1",
      status: "pending",
      update_time: "2026-09-01T00:00:00.000Z",
      data: {
        source: "node-1",
        target: "node-2",
        type: "election",
        start_date: "2024-01-01",
        committee: "KWW Nasza Gmina",
      },
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      revisionToApprove: null,
      hasPendingRevision: true,
    });
  });

  it("has nothing to approve for a relation with no revision at all", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      revisionToApprove: null,
      hasPendingRevision: false,
    });
  });

  it("reads revisions for the whole batch rather than one relation at a time", async () => {
    // A node with fifty relations would otherwise cost fifty round trips just
    // to render the dialog.
    stored["nodes/node-2"] = publishedNode("Firma A");
    for (let i = 0; i < 5; i += 1) {
      stored[`edges/e-${i}`] = {
        source: "node-1",
        target: "node-2",
        type: "employed",
      };
    }

    await callHandler();

    expect(queriesOf("revisions")).toHaveLength(1);
  });

  it("refuses a request that names no node", async () => {
    request({});

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 400 });
  });

  describe("when the page itself is still a draft", () => {
    // The case the dialog is actually opened in. Judging a relation by the
    // whole both-ends-published rule here greys out every row, including the
    // ones that are about to become perfectly publishable, because the page
    // being published is one of the two ends and has not gone live yet.
    beforeEach(() => {
      stored["nodes/node-1"] = { name: "Jan Kowalski", published: false };
    });

    it("offers a relation whose other end is already live", async () => {
      stored["nodes/node-2"] = publishedNode("Firma A");
      stored["edges/e-1"] = {
        source: "node-1",
        target: "node-2",
        type: "employed",
      };

      const relations = byId(await callHandler());

      expect(relations["e-1"]).toMatchObject({
        otherPublished: true,
        publishable: true,
      });
    });

    it("still blocks a relation whose other end is a draft too", async () => {
      stored["nodes/node-2"] = { name: "Szkic", published: false };
      stored["edges/e-1"] = {
        source: "node-1",
        target: "node-2",
        type: "employed",
      };

      const relations = byId(await callHandler());

      expect(relations["e-1"]).toMatchObject({ publishable: false });
    });

    it("treats a self-edge as having nothing standing in its way", async () => {
      // Both ends are the page being published, so there is no far end to wait
      // on. Degenerate, but it must not read as blocked by itself.
      stored["edges/e-self"] = {
        source: "node-1",
        target: "node-1",
        type: "connection",
      };

      const relations = byId(await callHandler());

      expect(relations["e-self"]).toMatchObject({ publishable: true });
    });

    it("reports the page as the draft it is", async () => {
      const result = await callHandler();

      expect(result.nodePublished).toBe(false);
    });
  });
});
