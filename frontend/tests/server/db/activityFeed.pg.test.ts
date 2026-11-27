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
import { buildActivityFeed } from "~~/server/utils/activityFeed";
import { resetFeedTargetCache } from "~~/server/utils/feedTargets";
import * as feedDb from "~~/server/db/activityFeed";
import { collectionTables } from "~~/server/db/collections";
import { describeFeedBatch, type RawFeedBatch } from "~~/shared/activityFeed";
import { DECLARATION_ACTOR } from "~~/shared/declarations";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** The activity feed's scans and reads on Postgres (server/db/activityFeed.ts
 * under server/utils/activityFeed.ts and feedTargets.ts).
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/activityFeed.pg.test.ts
 */

// Every read passes through to the SQL, logged.
vi.mock("~~/server/db/activityFeed", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~~/server/db/activityFeed")>();
  return {
    ...actual,
    scanVotesPg: vi.fn(actual.scanVotesPg),
    scanNotesPg: vi.fn(actual.scanNotesPg),
    scanAuditPg: vi.fn(actual.scanAuditPg),
    scanHumanRevisionsPg: vi.fn(actual.scanHumanRevisionsPg),
    scanAuthorRevisionsPg: vi.fn(actual.scanAuthorRevisionsPg),
    readFieldsPg: vi.fn(actual.readFieldsPg),
    newestRevisionsOfPg: vi.fn(actual.newestRevisionsOfPg),
  };
});

type Doc = Record<string, unknown>;
const spied = vi.mocked(feedDb);

let sql: postgres.Sql;

/** Every table emptied, then `seed` written to it in one statement each. */
async function store(seed: Record<string, Record<string, Doc>>) {
  await sql.unsafe(`TRUNCATE ${Object.values(collectionTables).join(", ")}`);
  for (const [name, docs] of Object.entries(seed)) {
    const table = collectionTables[name as keyof typeof collectionTables];
    const rows = Object.entries(docs).map(([id, data]) => ({ id, data }));
    if (rows.length === 0) continue;
    await sql`INSERT INTO ${sql(table)} (id, data)
      SELECT x.id, x.data FROM jsonb_to_recordset(${sql.json(rows as never)}) AS x(id text, data jsonb)`;
  }
}

/** What was read by id: the collection, the ids, the fields. */
const readsOf = () =>
  spied.readFieldsPg.mock.calls.map(([collection, ids, fieldMask]) => ({
    collection,
    ids: [...ids],
    fieldMask: [...fieldMask],
  }));

/** A Firestore Timestamp as the migration stores it: its ISO string. */
const stamp = (iso: string) => new Date(iso).toISOString();

const SINCE = "2026-09-15T00:00:00.000Z";
const UNTIL = "2026-09-22T00:00:00.000Z";
const WINDOW = { sinceIso: SINCE, untilIso: UNTIL, newAdminUids: [] };

/** An instant on 2026-09-20, the window's second-to-last day. */
const at = (time: string) => `2026-09-20T${time}.000Z`;

const NODES: Record<string, Doc> = {
  p1: { name: "Jan Kowalski", type: "person" },
  p2: { name: "Anna Nowak", type: "person" },
  p3: { name: "Piotr Wiśniewski", type: "person" },
  c1: { name: "PKP SA", type: "place" },
};
const EDGES: Record<string, Doc> = {
  e1: { source: "p1", target: "c1", type: "employed" },
  e2: { source: "p2", target: "c1", type: "employed" },
  e3: { source: "p3", target: "c1", type: "employed" },
  e4: { source: "p1", target: "p2", type: "connection" },
};

async function feed(
  seed: Record<string, Record<string, Doc>>,
  newAdminUids: string[] = [],
) {
  await store({ nodes: NODES, edges: EDGES, ...seed });
  const result = await buildActivityFeed({ ...WINDOW, newAdminUids });
  return { ...result, reads: readsOf() };
}

/** The batches as "uid kind count", for a test that is only about which
 * batches there are. */
const lines = (batches: RawFeedBatch[]) =>
  batches.map((batch) => `${batch.uid} ${batch.kind} ${batch.count}`);

describe.runIf(PG_TEST_DATABASE_URL)("buildActivityFeed on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("activity_feed");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    resetFeedTargetCache();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("votes", () => {
    it("lists a person's votes on pages and facts", async () => {
      const { batches } = await feed({
        votes: {
          p1_anna: {
            userUid: "anna",
            nodeId: "p1",
            categoryVotes: { interesting: 3 },
            updatedAt: at("10:00:00"),
          },
          f1_anna: {
            userUid: "anna",
            extractionId: "f1",
            categoryVotes: { correct: 1 },
            updatedAt: at("10:01:00"),
          },
        },
        extractions: {
          f1: { personNodeName: "Jan Kowalski", organization: "PKP SA" },
        },
      });

      expect(batches).toEqual([
        {
          uid: "anna",
          kind: "vote",
          firstAt: at("10:00:00"),
          lastAt: at("10:01:00"),
          count: 2,
          objects: { person: 1, fact: 1 },
          alongEdges: 0,
          targets: [
            {
              id: "f1",
              type: "fact",
              name: "Jan Kowalski · PKP SA",
              href: "/ekstrakcje/kategoryzacja?fact=f1",
            },
            {
              id: "p1",
              type: "person",
              name: "Jan Kowalski",
              href: "/osoba/jan-kowalski-p1",
            },
          ],
          moreTargets: 0,
        },
      ]);
    });

    it("skips a vote taken back, and keeps a comment on its own", async () => {
      const { batches } = await feed({
        votes: {
          zeroed: {
            userUid: "anna",
            nodeId: "p1",
            categoryVotes: { interesting: 0 },
            updatedAt: at("10:00:00"),
          },
          empty: {
            userUid: "anna",
            nodeId: "p2",
            categoryVotes: {},
            updatedAt: at("10:00:00"),
          },
          blank: {
            userUid: "anna",
            nodeId: "p3",
            categoryVotes: {},
            comment: "  ",
            updatedAt: at("10:00:00"),
          },
          commented: {
            userUid: "anna",
            extractionId: "f1",
            categoryVotes: {},
            comment: "zła osoba",
            updatedAt: at("10:00:00"),
          },
        },
        extractions: { f1: { person: "Jan Kowalski" } },
      });

      expect(
        batches.flatMap((batch) => batch.targets.map((t) => t.id)),
      ).toEqual(["f1"]);
    });

    it("skips robots and votes with nobody behind them", async () => {
      const vote = (userUid: unknown) => ({
        userUid,
        nodeId: "p1",
        categoryVotes: { interesting: 1 },
        updatedAt: at("10:00:00"),
      });
      const { batches } = await feed({
        votes: {
          a: vote("pipeline-pagerank"),
          b: vote("migration:merge-duplicate-people"),
          c: vote(""),
          d: vote(undefined),
          e: vote("anna"),
        },
      });

      expect(lines(batches)).toEqual(["anna vote 1"]);
    });

    it("skips an instant that sorts inside the window but is not in it", async () => {
      const vote = (nodeId: string, updatedAt: string) => ({
        userUid: "anna",
        nodeId,
        categoryVotes: { interesting: 1 },
        updatedAt,
      });
      const { batches } = await feed({
        votes: {
          before: vote("p1", "2026-09-14T23:59:59.999Z"),
          atUntil: vote("p1", UNTIL),
          future: vote("p1", "9999-01-01T00:00:00.000Z"),
          // Both sort between the bounds as strings. One does not parse, the
          // other is past the end of the window once its offset is applied.
          garbage: vote("p1", "2026-09-20Tgarbage"),
          offset: vote("p1", "2026-09-21T23:30:00.000-05:00"),
          first: vote("p2", SINCE),
          inside: vote("p3", "2026-09-21T23:59:59Z"),
        },
      });

      expect(
        batches.flatMap((batch) => batch.targets.map((t) => t.id)).sort(),
      ).toEqual(["p2", "p3"]);
      expect(batches[0]?.lastAt).toBe("2026-09-21T23:59:59.000Z");
    });

    it("drops a vote on an id that cannot name a document, and nothing else", async () => {
      const vote = (target: Doc) => ({
        userUid: "anna",
        categoryVotes: { interesting: 1 },
        updatedAt: at("10:00:00"),
        ...target,
      });
      const { batches, reads } = await feed({
        votes: {
          a: vote({ nodeId: "p1/votes/x" }),
          b: vote({ nodeId: "__name__" }),
          c: vote({ extractionId: ".." }),
          d: vote({ nodeId: 42 }),
          e: vote({ nodeId: "p1" }),
        },
      });

      expect(
        batches.flatMap((batch) => batch.targets.map((t) => t.id)),
      ).toEqual(["p1"]);
      expect(reads.flatMap((read) => read.ids)).toEqual(["p1"]);
    });

    it("reports a scan that hit its cap", async () => {
      const votes: Record<string, Doc> = {};
      for (let i = 0; i < 20_000; i++) {
        votes[`v${i}`] = {
          userUid: "anna",
          nodeId: "p1",
          categoryVotes: { interesting: 1 },
          updatedAt: at("10:00:00"),
        };
      }

      const { truncated } = await feed({ votes });

      expect(truncated).toEqual(["votes"]);
    });
  });

  describe("notes", () => {
    it("lists one note per document, dated by its last save", async () => {
      const { batches } = await feed({
        notes: {
          // Written long ago, edited today: `saveNote` moves `updatedAt` on
          // every save.
          p1_anna: {
            userUid: "anna",
            nodeId: "p1",
            createdAt: stamp("2026-08-01T10:00:00Z"),
            updatedAt: stamp(at("10:00:00")),
            sources: [{ note: "a" }],
          },
          // Written today: the first save stamps both.
          p2_anna: {
            userUid: "anna",
            nodeId: "p2",
            createdAt: stamp(at("10:05:00")),
            updatedAt: stamp(at("10:05:00")),
            sources: [{ note: "b" }, { note: "c" }],
          },
          emptied: {
            userUid: "anna",
            nodeId: "p3",
            updatedAt: stamp(at("10:06:00")),
            sources: [],
          },
        },
      });

      expect(batches).toMatchObject([
        {
          kind: "note",
          count: 2,
          firstAt: at("10:00:00"),
          lastAt: at("10:05:00"),
        },
      ]);
      // One scan, on `updatedAt`.
      expect(spied.scanNotesPg.mock.calls.map((call) => call[0])).toEqual([
        { sinceIso: SINCE, untilIso: UNTIL },
      ]);
    });

    it("reads only the pages its line lists, and counts the rest by id", async () => {
      const nodes: Record<string, Doc> = { ...NODES };
      const notes: Record<string, Doc> = {};
      const note = (nodeId: string, time: string): Doc => ({
        userUid: "anna",
        nodeId,
        updatedAt: stamp(at(time)),
        sources: [{ note: "x" }],
      });
      for (let i = 0; i <= 10; i++) {
        nodes[`n${i}`] = { name: `Osoba ${i}`, type: "person" };
        notes[`n${i}_anna`] = note(
          `n${i}`,
          `10:${String(i).padStart(2, "0")}:00`,
        );
      }
      // The newest: listed, so read - and dropped, as there is nothing to name.
      notes.ghost1_anna = note("ghost1", "10:30:00");
      // Past the twelve a note line lists: counted, never read.
      notes.ghost2_anna = note("ghost2", "09:30:00");
      // Cannot name a document at all: not even counted.
      notes.bad_anna = note("a/b", "09:00:00");

      const { batches, reads } = await feed({ nodes, notes });

      expect(batches).toHaveLength(1);
      expect(batches[0]).toMatchObject({
        kind: "note",
        count: 12,
        firstAt: at("09:30:00"),
        lastAt: at("10:10:00"),
        moreTargets: 1,
      });
      expect(batches[0]?.targets.map((target) => target.id)).toEqual(
        Array.from({ length: 11 }, (_, i) => `n${10 - i}`),
      );
      const read = reads.flatMap((one) => one.ids);
      expect(read).toContain("ghost1");
      expect(read).not.toContain("ghost2");
      expect(read).not.toContain("a/b");
      expect(
        spied.newestRevisionsOfPg.mock.calls.map((call) => call[0]),
      ).toEqual([["ghost1"]]);
    });
  });

  describe("revisions", () => {
    const revision = (overrides: Doc): Doc => ({
      update_user: "admin",
      update_time: stamp(at("10:00:00")),
      update_automatic: false,
      status: "pending",
      collection: "nodes",
      node_id: "p1",
      data: { name: "Jan Kowalski", type: "person" },
      ...overrides,
    });
    /** Written and approved by its author in one commit: the same instant, as
     * two distinct Timestamp objects. */
    const direct = (overrides: Doc): Doc =>
      revision({
        status: "approved",
        review_user: "admin",
        review_time: stamp(at("10:00:00")),
        ...overrides,
      });
    const edgeData = (source: string, target: string) => ({
      source,
      target,
      type: "employed",
    });

    it("reads only human revisions, on the index the queue already uses", async () => {
      const { batches } = await feed({
        revisions: {
          human: revision({}),
          robot: revision({ update_automatic: true, node_id: "p2" }),
          // No flag: older than any window the feed offers.
          unflagged: revision({ update_automatic: undefined, node_id: "p3" }),
        },
      });

      expect(lines(batches)).toEqual(["admin proposal 1"]);
      expect(spied.scanHumanRevisionsPg).toHaveBeenCalledOnce();
    });

    it("calls a write its author approved in the same instant an edit", async () => {
      const { batches } = await feed({
        revisions: {
          r1: direct({
            collection: "edges",
            node_id: "e1",
            data: edgeData("p1", "c1"),
          }),
        },
      });

      expect(batches).toMatchObject([
        {
          uid: "admin",
          kind: "edit",
          count: 1,
          objects: { edge: 1 },
          targets: [
            { id: "e1", name: "Jan Kowalski → PKP SA", revisionId: "r1" },
          ],
        },
      ]);
    });

    it("calls anything else a proposal, flagged when its author approved it later", async () => {
      const { batches } = await feed({
        revisions: {
          pending: revision({ update_user: "anna", node_id: "p1" }),
          own: revision({
            update_user: "anna",
            node_id: "p2",
            status: "approved",
            review_user: "anna",
            review_time: stamp(at("11:00:00")),
          }),
          reviewed: revision({
            update_user: "anna",
            node_id: "p3",
            status: "approved",
            review_user: "admin",
            review_time: stamp(at("10:00:00")),
          }),
        },
      });

      expect(batches).toHaveLength(1);
      expect(batches[0]).toMatchObject({
        uid: "anna",
        kind: "proposal",
        count: 3,
      });
      expect(
        Object.fromEntries(
          batches[0]!.targets.map((target) => [
            target.id,
            target.selfApproved ?? false,
          ]),
        ),
      ).toEqual({ p1: false, p2: true, p3: false });
    });

    it("drops the article node a crawl opens for itself", async () => {
      const { batches } = await feed({
        revisions: {
          a1: direct({
            update_user: "anna",
            review_user: "anna",
            node_id: "a1",
            data: { name: "Tytuł", type: "article" },
          }),
        },
      });

      expect(batches).toEqual([]);
    });

    it("drops an edge removal's own revision, which its delete row names", async () => {
      const { batches } = await feed({
        revisions: {
          rdel: direct({
            collection: "edges",
            node_id: "e1",
            data: { ...edgeData("p1", "c1"), deleted: true },
          }),
        },
        audit: {
          d1: {
            user: "admin",
            at: at("10:00:00").replace(".000Z", ".004Z"),
            action: "delete",
            collection: "edges",
            target_id: "e1",
            revision_id: "rdel",
            reason: "błędne",
          },
        },
      });

      expect(batches).toMatchObject([
        {
          kind: "delete",
          count: 1,
          targets: [{ id: "e1", reason: "błędne", revisionId: "rdel" }],
        },
      ]);
    });

    it("drops what a merge wrote, and keeps an edit next to it that it did not", async () => {
      const { batches } = await feed({
        nodes: {
          ...NODES,
          dup: {
            name: "J. Kowalski",
            type: "person",
            deleted: true,
            merged_into: "p1",
          },
        },
        revisions: {
          collapsed: direct({
            collection: "edges",
            node_id: "e2",
            data: { ...edgeData("p2", "c1"), deleted: true },
          }),
          enriched: direct({
            collection: "edges",
            node_id: "e3",
            data: edgeData("p3", "c1"),
          }),
          survivor: direct({ node_id: "p1" }),
          // Tidying a relation just before the merge: not part of it.
          unrelated: direct({
            collection: "edges",
            node_id: "e4",
            data: { source: "p1", target: "p2", type: "connection" },
            update_time: stamp(at("09:59:58")),
            review_time: stamp(at("09:59:58")),
          }),
        },
        audit: {
          m1: {
            user: "admin",
            at: at("10:00:00").replace(".000Z", ".010Z"),
            action: "merge",
            collection: "nodes",
            target_id: "dup",
            reason: "ta sama osoba",
            merge: {
              into: "p1",
              moved: ["e1"],
              collapsed: ["e2"],
              enriched: ["e3"],
            },
          },
        },
      });

      expect(lines(batches)).toEqual(["admin merge 1", "admin edit 1"]);
      expect(batches[0]?.targets).toEqual([
        {
          id: "p1",
          type: "person",
          name: "Jan Kowalski",
          href: "/osoba/jan-kowalski-p1",
          reason: "ta sama osoba",
        },
      ]);
      expect(batches[1]?.targets.map((target) => target.id)).toEqual(["e4"]);
    });

    it("keeps an edit of a relation a merge later enriched or collapsed", async () => {
      // The dry run flags two relations for review; the administrator fixes
      // their dates, then merges. The merge names the same two relations, and
      // only the time tells its writes from the fixes.
      const { batches } = await feed({
        nodes: {
          ...NODES,
          dup: {
            name: "J. Kowalski",
            type: "person",
            deleted: true,
            merged_into: "p1",
          },
        },
        revisions: {
          fixedE2: direct({
            collection: "edges",
            node_id: "e2",
            data: edgeData("p2", "c1"),
            update_time: stamp(at("09:59:20")),
            review_time: stamp(at("09:59:20")),
          }),
          fixedE3: direct({
            collection: "edges",
            node_id: "e3",
            data: edgeData("p3", "c1"),
            update_time: stamp(at("09:59:20")),
            review_time: stamp(at("09:59:20")),
          }),
          collapsed: direct({
            collection: "edges",
            node_id: "e2",
            data: { ...edgeData("p2", "c1"), deleted: true },
          }),
          enriched: direct({
            collection: "edges",
            node_id: "e3",
            data: edgeData("p3", "c1"),
          }),
        },
        audit: {
          m1: {
            user: "admin",
            at: at("10:00:00").replace(".000Z", ".010Z"),
            action: "merge",
            collection: "nodes",
            target_id: "dup",
            merge: {
              into: "p1",
              moved: [],
              collapsed: ["e2"],
              enriched: ["e3"],
            },
          },
        },
      });

      expect(lines(batches)).toEqual(["admin merge 1", "admin edit 2"]);
      expect(
        batches[1]?.targets.map((target) => [target.id, target.revisionId]),
      ).toEqual([
        ["e3", "fixedE3"],
        ["e2", "fixedE2"],
      ]);
    });

    it("drops the person a split created, which its split row names", async () => {
      const { batches } = await feed({
        nodes: { ...NODES, born: { name: "Jan Kowalski (2)", type: "person" } },
        revisions: {
          creation: direct({
            node_id: "born",
            data: { name: "Jan Kowalski (2)", type: "person" },
          }),
        },
        audit: {
          s1: {
            user: "admin",
            at: at("10:00:01"),
            action: "split",
            collection: "nodes",
            target_id: "p1",
            reason: "dwie osoby",
            merge: { into: "born", moved: ["e1"], collapsed: [] },
          },
        },
      });

      expect(lines(batches)).toEqual(["admin split 1"]);
      expect(batches[0]?.targets[0]).toMatchObject({
        id: "p1",
        reason: "dwie osoby",
      });
    });

    it("keeps an edit that a row by somebody else, or a minute later, names", async () => {
      const { batches } = await feed({
        revisions: {
          r1: direct({
            collection: "edges",
            node_id: "e1",
            data: edgeData("p1", "c1"),
          }),
          r2: direct({
            collection: "edges",
            node_id: "e2",
            data: edgeData("p2", "c1"),
          }),
        },
        audit: {
          other: {
            user: "someone",
            at: at("10:00:01"),
            action: "delete",
            collection: "edges",
            target_id: "e1",
            revision_id: "r1",
          },
          late: {
            user: "admin",
            at: at("10:01:01"),
            action: "delete",
            collection: "edges",
            target_id: "e2",
            revision_id: "r2",
          },
        },
      });

      expect(lines(batches)).toEqual([
        "admin delete 1",
        "someone delete 1",
        "admin edit 2",
      ]);
    });

    it("tells a split from marking a page for one", async () => {
      const { batches } = await feed({
        audit: {
          mark: {
            user: "admin",
            at: at("10:00:00"),
            action: "split",
            collection: "nodes",
            target_id: "p1",
            reason: "dwie osoby",
          },
          done: {
            user: "admin",
            at: at("10:05:00"),
            action: "split",
            collection: "nodes",
            target_id: "p2",
            merge: { into: "p3", moved: [], collapsed: [] },
          },
        },
      });

      expect(lines(batches)).toEqual(["admin split 1", "admin splitMark 1"]);
      expect(describeFeedBatch(batches[1]!)).toBe(
        "oznaczył/a 1 osobę do rozdzielenia",
      );
    });
  });

  describe("audit", () => {
    const proposedEdge = {
      update_user: "admin",
      update_time: stamp("2026-09-19T08:00:00Z"),
      update_automatic: false,
      status: "approved",
      review_user: "admin",
      review_time: stamp(at("10:00:00")),
      collection: "edges",
      node_id: "e1",
      data: { source: "p1", target: "c1", type: "employed" },
    };

    it("reads an approval and a publication naming one revision as one publication", async () => {
      const { batches } = await feed({
        revisions: { rv1: proposedEdge },
        audit: {
          a: {
            user: "admin",
            at: at("10:00:00"),
            action: "approve",
            collection: "edges",
            target_id: "e1",
            revision_id: "rv1",
          },
          p: {
            user: "admin",
            at: at("10:00:00"),
            action: "publish",
            collection: "edges",
            target_id: "e1",
            revision_id: "rv1",
          },
        },
      });

      // The revision was proposed the day before, so the same admin also has
      // a proposal line; the approval is gone into the publication.
      expect(lines(batches)).toEqual(["admin publish 1", "admin proposal 1"]);
      expect(batches[0]?.targets).toEqual([
        {
          id: "e1",
          type: "edge",
          name: "Jan Kowalski → PKP SA",
          href: "/osoba/jan-kowalski-p1",
          revisionId: "rv1",
          selfApproved: true,
        },
      ]);
    });

    it("folds a page's approval into its publication within ten seconds", async () => {
      const { batches, reads } = await feed({
        revisions: {
          rv2: {
            update_user: "admin",
            update_time: stamp("2026-09-01T08:00:00Z"),
            update_automatic: false,
            collection: "nodes",
            node_id: "p1",
            data: { name: "Jan Kowalski", type: "person" },
          },
        },
        audit: {
          a: {
            user: "admin",
            at: at("10:00:00"),
            action: "approve",
            collection: "nodes",
            target_id: "p1",
            revision_id: "rv2",
          },
          p: {
            user: "admin",
            at: at("10:00:03"),
            action: "publish",
            collection: "nodes",
            target_id: "p1",
          },
        },
      });

      expect(lines(batches)).toEqual(["admin publish 1"]);
      expect(batches[0]?.targets[0]).toMatchObject({
        id: "p1",
        revisionId: "rv2",
        selfApproved: true,
      });
      // Proposed before the window, so read for the flag, and with a mask.
      expect(reads.find((read) => read.collection === "revisions")).toEqual({
        collection: "revisions",
        ids: ["rv2"],
        fieldMask: expect.arrayContaining([
          "update_user",
          "update_automatic",
          "data.deleted",
        ]),
      });
    });

    it("keeps an approval eleven seconds before a publication apart", async () => {
      const { batches } = await feed({
        audit: {
          a: {
            user: "admin",
            at: at("10:00:00"),
            action: "approve",
            collection: "nodes",
            target_id: "p1",
            revision_id: "rv2",
          },
          p: {
            user: "admin",
            at: at("10:00:11"),
            action: "publish",
            collection: "nodes",
            target_id: "p1",
          },
        },
      });

      expect(lines(batches)).toEqual(["admin publish 1", "admin approve 1"]);
    });

    it("does not fold across people or pages", async () => {
      const { batches } = await feed({
        audit: {
          a1: {
            user: "admin",
            at: at("10:00:00"),
            action: "approve",
            collection: "nodes",
            target_id: "p1",
            revision_id: "x1",
          },
          p1: {
            user: "other",
            at: at("10:00:01"),
            action: "publish",
            collection: "nodes",
            target_id: "p1",
          },
          a2: {
            user: "admin",
            at: at("10:00:00"),
            action: "approve",
            collection: "edges",
            target_id: "e1",
            revision_id: "x2",
          },
          p2: {
            user: "admin",
            at: at("10:00:00"),
            action: "publish",
            collection: "edges",
            target_id: "e2",
            revision_id: "x2",
          },
        },
      });

      expect(lines(batches)).toEqual([
        "other publish 1",
        "admin approve 2",
        "admin publish 1",
      ]);
    });

    it("names the admin who pressed „Opublikuj z kolejki”, and the automation for what it published on its own", async () => {
      const { batches } = await feed({
        audit: {
          // The import's revision, approved by the automation on the way up.
          a: {
            user: DECLARATION_ACTOR,
            at: at("10:00:00"),
            action: "approve",
            collection: "nodes",
            target_id: "p1",
            revision_id: "x1",
          },
          pressed: {
            user: DECLARATION_ACTOR,
            pressed_by: "admin",
            at: at("10:00:00"),
            action: "publish",
            collection: "nodes",
            target_id: "p1",
          },
          own: {
            user: DECLARATION_ACTOR,
            at: at("11:00:00"),
            action: "publish",
            collection: "nodes",
            target_id: "p2",
          },
        },
      });

      // A kind of its own, so it is never filed with the administrators'
      // decisions; its approval of the import's revision stays out.
      expect(lines(batches)).toEqual([
        `${DECLARATION_ACTOR} autoPublish 1`,
        "admin publish 1",
      ]);
      expect(batches[0]?.targets).toEqual([
        expect.objectContaining({ id: "p2", type: "person" }),
      ]);
      expect(batches[1]?.targets).toEqual([
        expect.objectContaining({ id: "p1", type: "person" }),
      ]);
    });

    it("lists none of the automation's other rows: its approvals and the relations it put up", async () => {
      const { batches } = await feed({
        audit: {
          a: {
            user: DECLARATION_ACTOR,
            at: at("10:00:00"),
            action: "approve",
            collection: "edges",
            target_id: "e1",
            revision_id: "x1",
          },
          e: {
            user: DECLARATION_ACTOR,
            at: at("10:00:00"),
            action: "publish",
            collection: "edges",
            target_id: "e1",
          },
          h: {
            user: DECLARATION_ACTOR,
            at: at("10:00:01"),
            action: "unpublish",
            collection: "nodes",
            target_id: "p1",
          },
        },
      });

      expect(batches).toEqual([]);
    });

    it("does not call approving the ingest's revision approving one's own", async () => {
      // The owner's pipeline uploads under the owner's uid.
      const { batches, reads } = await feed({
        revisions: {
          ing: {
            update_user: "admin",
            update_time: stamp("2026-09-01T00:00:00Z"),
            update_automatic: true,
            collection: "nodes",
            node_id: "p1",
            data: { name: "Jan Kowalski", type: "person" },
          },
        },
        audit: {
          a: {
            user: "admin",
            at: at("10:00:00"),
            action: "approve",
            collection: "nodes",
            target_id: "p1",
            revision_id: "ing",
          },
        },
      });

      expect(lines(batches)).toEqual(["admin approve 1"]);
      expect(batches[0]?.targets[0]?.revisionId).toBe("ing");
      expect(batches[0]?.targets[0]?.selfApproved).toBeUndefined();
      expect(reads.some((read) => read.ids.includes("ing"))).toBe(true);
    });

    it("calls approving a removal a deletion", async () => {
      const { batches } = await feed({
        revisions: {
          rm: {
            update_user: "anna",
            update_time: stamp(at("09:00:00")),
            update_automatic: false,
            status: "approved",
            review_user: "admin",
            review_time: stamp(at("10:00:00")),
            collection: "nodes",
            node_id: "p2",
            data: {
              name: "Anna Nowak",
              type: "person",
              deleted: true,
              delete_reason: "nie jest osobą publiczną",
            },
          },
        },
        audit: {
          a: {
            user: "admin",
            at: at("10:00:00"),
            action: "approve",
            collection: "nodes",
            target_id: "p2",
            revision_id: "rm",
          },
        },
      });

      expect(lines(batches)).toEqual(["admin delete 1", "anna proposal 1"]);
      expect(batches[0]?.targets[0]).toMatchObject({
        id: "p2",
        reason: "nie jest osobą publiczną",
        revisionId: "rm",
      });
      expect(batches[0]?.targets[0]?.selfApproved).toBeUndefined();
      expect(describeFeedBatch(batches[0]!)).toBe("usunął/usunęła 1 osobę");
    });

    it("calls publishing a removal a deletion, however the approval folded into it", async () => {
      // "Zatwierdź i opublikuj" on a removal: the approval folds into the
      // publication before any revision is read.
      const removal = (overrides: Doc): Doc => ({
        update_time: stamp("2026-09-01T08:00:00Z"),
        update_automatic: false,
        status: "approved",
        review_user: "admin",
        collection: "nodes",
        ...overrides,
      });
      const { batches } = await feed({
        revisions: {
          rm: removal({
            update_user: "anna",
            node_id: "p2",
            data: {
              name: "Anna Nowak",
              type: "person",
              deleted: true,
              delete_reason: "nie jest osobą publiczną",
            },
          }),
          own: removal({
            update_user: "admin",
            node_id: "p3",
            data: {
              name: "Piotr Wiśniewski",
              type: "person",
              deleted: true,
              delete_reason: "duplikat",
            },
          }),
        },
        audit: {
          // From the queue: both rows name the revision.
          a1: {
            user: "admin",
            at: at("10:00:00"),
            action: "approve",
            collection: "nodes",
            target_id: "p2",
            revision_id: "rm",
          },
          p1: {
            user: "admin",
            at: at("10:00:00"),
            action: "publish",
            collection: "nodes",
            target_id: "p2",
            revision_id: "rm",
          },
          // Paired by page and time: the publish row names no revision.
          a2: {
            user: "admin",
            at: at("10:30:00"),
            action: "approve",
            collection: "nodes",
            target_id: "p3",
            revision_id: "own",
          },
          p2: {
            user: "admin",
            at: at("10:30:02"),
            action: "publish",
            collection: "nodes",
            target_id: "p3",
          },
        },
      });

      expect(lines(batches)).toEqual(["admin delete 2"]);
      expect(batches[0]?.targets).toMatchObject([
        {
          id: "p3",
          reason: "duplikat",
          revisionId: "own",
          selfApproved: true,
        },
        { id: "p2", reason: "nie jest osobą publiczną", revisionId: "rm" },
      ]);
      expect(batches[0]?.targets[1]?.selfApproved).toBeUndefined();
      expect(describeFeedBatch(batches[0]!)).toBe("usunął/usunęła 2 osoby");
    });

    it("reads the revisions of the rows left after folding, once each, 300 at a time", async () => {
      const audit: Record<string, Doc> = {};
      const nodes: Record<string, Doc> = { ...NODES };
      for (let i = 0; i < 301; i++) {
        nodes[`n${i}`] = { name: `Osoba ${i}`, type: "person" };
        audit[`a${i}`] = {
          user: "admin",
          at: at("10:00:00"),
          action: "approve",
          collection: "nodes",
          target_id: `n${i}`,
          revision_id: `r${i}`,
        };
      }
      // Re-approving the same revision is a second row, not a second read.
      audit.again = { ...audit.a0, at: at("10:00:05") };
      // The approval folds into the publication, whose revision it is: read
      // once, for the publication.
      audit.approved = {
        user: "admin",
        at: at("10:00:00"),
        action: "approve",
        collection: "edges",
        target_id: "e1",
        revision_id: "both",
      };
      audit.published = {
        user: "admin",
        at: at("10:00:00"),
        action: "publish",
        collection: "edges",
        target_id: "e1",
        revision_id: "both",
      };
      // What the scan already brought is not read again.
      const revisions = {
        scanned: {
          update_user: "anna",
          update_time: stamp(at("09:00:00")),
          update_automatic: false,
          status: "approved",
          review_user: "admin",
          review_time: stamp(at("10:00:00")),
          collection: "nodes",
          node_id: "p1",
          data: { name: "Jan Kowalski", type: "person" },
        },
      };
      audit.fromScan = {
        user: "admin",
        at: at("10:00:00"),
        action: "approve",
        collection: "nodes",
        target_id: "p1",
        revision_id: "scanned",
      };

      const { reads } = await feed({ nodes, audit, revisions });

      const revisionReads = reads.filter(
        (read) => read.collection === "revisions",
      );
      expect(
        revisionReads.map((read) => read.ids.length).sort((a, b) => a - b),
      ).toEqual([2, 300]);
      const ids = revisionReads.flatMap((read) => read.ids);
      expect(ids).toHaveLength(302);
      expect(new Set(ids).size).toBe(302);
      expect(ids).toContain("both");
      expect(ids).not.toContain("scanned");
    });

    it("leaves out an action it does not know", async () => {
      const { batches } = await feed({
        audit: {
          r: {
            user: "admin",
            at: at("10:00:00"),
            action: "restore",
            collection: "edges",
            target_id: "e1",
          },
        },
      });

      expect(batches).toEqual([]);
    });

    it("shows a merge on the page that survived, counted by its duplicates", async () => {
      const { batches } = await feed({
        nodes: {
          ...NODES,
          // Merged again later: the line still names the page it was merged
          // into at the time.
          p1: { ...NODES.p1, merged_into: "p3" },
          dupA: {
            name: "J. Kowalski",
            type: "person",
            deleted: true,
            merged_into: "p1",
          },
          dupB: {
            name: "Kowalski J.",
            type: "person",
            deleted: true,
            merged_into: "p1",
          },
        },
        audit: {
          m1: {
            user: "admin",
            at: at("10:00:00"),
            action: "merge",
            collection: "nodes",
            target_id: "dupA",
            merge: { into: "p1", moved: [], collapsed: [] },
          },
          m2: {
            user: "admin",
            at: at("10:05:00"),
            action: "merge",
            collection: "nodes",
            target_id: "dupB",
            merge: { into: "p1", moved: [], collapsed: [] },
          },
        },
      });

      expect(batches).toMatchObject([
        { kind: "merge", count: 2, objects: { person: 1 } },
      ]);
      expect(batches[0]?.targets.map((target) => target.id)).toEqual(["p1"]);
      expect(describeFeedBatch(batches[0]!)).toBe("scalił/a 2 duplikaty");
    });
  });

  describe("imports", () => {
    const upload = (update_user: string, overrides: Doc = {}): Doc => ({
      update_user,
      update_time: stamp(at("10:00:00")),
      update_automatic: true,
      status: "approved",
      collection: "nodes",
      node_id: "p1",
      data: { name: "Jan Kowalski", type: "person" },
      ...overrides,
    });

    it("reads nothing for them while nobody is on trial", async () => {
      const { batches } = await feed({
        revisions: { u1: upload("trial") },
      });

      expect(batches).toEqual([]);
      expect(spied.scanAuthorRevisionsPg).not.toHaveBeenCalled();
    });

    it("lists what an administrator on trial uploaded", async () => {
      const { batches } = await feed(
        {
          revisions: {
            u1: upload("trial"),
            u2: upload("trial", { node_id: "p2" }),
            mine: upload("owner"),
          },
        },
        ["trial"],
      );

      expect(batches).toMatchObject([
        { uid: "trial", kind: "import", count: 2, objects: { person: 2 } },
      ]);
      expect(spied.scanAuthorRevisionsPg.mock.calls[0]?.slice(0, 2)).toEqual([
        { sinceIso: SINCE, untilIso: UNTIL },
        ["trial"],
      ]);
    });

    /** `count` uploads of a person each, one second apart from `from`. */
    const bulk = (prefix: string, count: number, from: string) => {
      const nodes: Record<string, Doc> = {};
      const revisions: Record<string, Doc> = {};
      for (let i = 0; i < count; i++) {
        const id = `${prefix}${i}`;
        nodes[id] = { name: `Osoba ${id}`, type: "person" };
        revisions[`r_${id}`] = upload("trial", {
          node_id: id,
          data: { name: `Osoba ${id}`, type: "person" },
          update_time: stamp(
            new Date(Date.parse(from) + i * 1000).toISOString(),
          ),
        });
      }
      return { nodes, revisions };
    };

    it("reads only the targets an upload's line lists, per sitting", async () => {
      // 300 people in one sitting, and 60 in another four hours earlier.
      const late = bulk("n", 300, at("10:00:00"));
      const early = bulk("m", 60, at("06:00:00"));

      const { batches, reads, truncated } = await feed(
        {
          nodes: { ...NODES, ...late.nodes, ...early.nodes },
          revisions: { ...late.revisions, ...early.revisions },
        },
        ["trial"],
      );

      expect(truncated).toEqual([]);
      expect(
        batches.map((batch) => [
          batch.kind,
          batch.count,
          batch.targets.length,
          batch.moreTargets,
        ]),
      ).toEqual([
        ["import", 300, 50, 250],
        ["import", 60, 50, 10],
      ]);
      expect(batches[0]?.targets[0]?.id).toBe("n299");
      expect(batches[0]?.targets[49]?.id).toBe("n250");
      // The fifty newest of each sitting, and nothing else.
      const read = reads.flatMap((one) => one.ids);
      expect(read).toHaveLength(100);
      expect(new Set(read)).toEqual(
        new Set([
          ...Array.from({ length: 50 }, (_, i) => `n${250 + i}`),
          ...Array.from({ length: 50 }, (_, i) => `m${10 + i}`),
        ]),
      );
    });

    it("counts an upload up to a thousand revisions, and says so", async () => {
      const { revisions } = bulk("n", 1_001, at("10:00:00"));

      const { batches, truncated } = await feed({ revisions }, ["trial"]);

      expect(truncated).toEqual(["imports"]);
      expect(batches).toMatchObject([{ kind: "import", count: 1_000 }]);
      expect(spied.scanAuthorRevisionsPg.mock.calls[0]?.[3]).toBe(1_000);
    });

    it("asks for at most 30 people, and says so", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const uids = Array.from({ length: 35 }, (_, i) => `trial${i}`);

      await feed({}, uids);

      expect(spied.scanAuthorRevisionsPg.mock.calls[0]?.[1]).toEqual(
        uids.slice(0, 30),
      );
      expect(warn).toHaveBeenCalledOnce();
    });
  });

  describe("targets", () => {
    it("links a vote on a merged duplicate to the page that survived", async () => {
      const { batches } = await feed({
        nodes: {
          ...NODES,
          dupA: {
            name: "J. Kowalski",
            type: "person",
            deleted: true,
            merged_into: "dupB",
          },
          dupB: {
            name: "Kowalski J.",
            type: "person",
            deleted: true,
            merged_into: "p1",
          },
        },
        votes: {
          v: {
            userUid: "anna",
            nodeId: "dupA",
            categoryVotes: { interesting: 2 },
            updatedAt: at("10:00:00"),
          },
        },
      });

      expect(batches[0]?.targets).toEqual([
        {
          id: "p1",
          type: "person",
          name: "Jan Kowalski",
          href: "/osoba/jan-kowalski-p1",
        },
      ]);
    });

    it("drops the events of a read that failed, and not the feed", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const actual = spied.readFieldsPg.getMockImplementation()!;
      spied.readFieldsPg.mockImplementation((collection, ...rest) =>
        collection === "extractions"
          ? Promise.reject(new Error("unavailable"))
          : actual(collection, ...rest),
      );
      const { batches } = await feed({
        extractions: {
          f1: { person: "X", fact_type: "employment", articleUrl: "x" },
        },
        votes: {
          a: {
            userUid: "anna",
            extractionId: "f1",
            categoryVotes: { correct: 1 },
            updatedAt: at("10:00:00"),
          },
          b: {
            userUid: "anna",
            nodeId: "p1",
            categoryVotes: { interesting: 1 },
            updatedAt: at("10:00:00"),
          },
        },
      });

      spied.readFieldsPg.mockImplementation(actual);

      expect(
        batches.flatMap((batch) => batch.targets.map((t) => t.id)),
      ).toEqual(["p1"]);
    });
  });

  it("refuses a window that is not one", async () => {
    await expect(
      buildActivityFeed({
        sinceIso: "wczoraj",
        untilIso: UNTIL,
        newAdminUids: [],
      }),
    ).rejects.toThrow("not a window");
  });
});
