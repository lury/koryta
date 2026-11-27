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
import { editorialTx, type Data } from "~~/server/db/editorial";
import {
  applyRevisionPg,
  createRevisionPg,
  type RevisionTarget,
} from "~~/server/db/revisionWrites";
import { proposeRevisionPg } from "~~/server/db/proposals";
import { proposalId, withoutInternalFields } from "~~/server/utils/revisions";
import type { Revision } from "~~/shared/model";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { syncStored, type StoredDocs } from "./storedDocs";
import type { LoggedQuery } from "./queryLog";

/** The revision statements on Postgres (server/db/revisionWrites.ts and
 * proposals.ts): a revision filed and written onto its target, a revision
 * approved over what the target holds, a proposal filed without touching
 * it. The pure rules they share are tests/server/utils/revisions.test.ts's.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \\
 *     npx vitest run tests/server/db/revisionStatements.pg.test.ts
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
    sql = await openTestDatabase("revision_statements");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
}

const row = async (table: string, id: string) =>
  (
    await sql<{ data: Data }[]>`
      SELECT data FROM ${sql(table)} WHERE id = ${id}`
  )[0]?.data;
const rows = async (table: string) =>
  sql<{ id: string; data: Data }[]>`
    SELECT id, data FROM ${sql(table)} ORDER BY id`;
/** The audit rows in the order they were filed. */
const audit = async () =>
  (
    await sql<{ data: Data }[]>`
      SELECT data FROM audit ORDER BY data ->> 'at', ctid`
  ).map((r) => r.data);

/** A node as its write left it, without what the write's own effects lay on
 * it in the same transaction (writeEffects.ts): the `revisions` summary and
 * the queue tier. */
function asWritten(doc: Data): Data {
  const { revisions: _summary, ...rest } = doc;
  if (rest.stats && typeof rest.stats === "object") {
    const { queueTier: _tier, ...stats } = rest.stats as Data;
    rest.stats = stats;
  }
  return rest;
}

const node = (id: string): RevisionTarget => ({ collection: "nodes", id });
const edge = (id: string): RevisionTarget => ({ collection: "edges", id });

/** `createRevisionPg` in a transaction of its own; the revision filed and
 * the target as written. */
async function create(
  target: RevisionTarget,
  data: Data,
  options: Parameters<typeof createRevisionPg>[5] = {},
  user = { uid: "test-user" },
) {
  await arrange({});
  const { revisionId } = await editorialTx((tx, log) =>
    createRevisionPg(tx, log, user, target, data, options),
  );
  return {
    revisionId,
    revision: (await row("revisions", revisionId))!,
    written: asWritten((await row(target.collection, target.id))!),
  };
}

describe.runIf(PG_TEST_DATABASE_URL)("revision statements on Postgres", () => {
  useDatabase();

  describe("createRevisionPg", () => {
    it("should create a revision and NOT update head when updateHead=false", async () => {
      const data = { name: "New Title", type: "place" };

      const { revision, written } = await create(node("node-1"), data);

      expect(revision).toMatchObject({
        node_id: "node-1",
        data,
        update_user: "test-user",
      });
      // Without approve/published the target document is the data, plus the
      // counters every node has to carry to be found at all - see
      // `withSeededNodeStats`.
      expect(written).toEqual({
        ...data,
        stats: { nodeGroupSize: 0, isApproved: false },
      });
    });

    it("should set revision_id on the target but not in the revision data when approving", async () => {
      const { revisionId, revision, written } = await create(
        node("node-1"),
        { name: "New Title", type: "place" },
        { approve: true },
      );

      expect(revision.data).not.toHaveProperty("revision_id");
      expect(written.revision_id).toBe(`revisions/${revisionId}`);
    });

    it("should write the published flag onto the target document", async () => {
      const { revision, written } = await create(
        node("node-1"),
        { name: "New Title", type: "place" },
        { approve: true, published: false },
      );

      expect(revision.data).not.toHaveProperty("published");
      expect(written.published).toBe(false);
    });

    it("records which collection the revision is for", async () => {
      // `node_id` holds the target's id whether the target is a node or an
      // edge, so without this a reviewer applying an edge revision writes it
      // onto a node that does not exist.
      const { revision, written } = await create(edge("edge-1"), {
        source: "node-1",
        target: "node-2",
        type: "employed",
      });

      expect(revision).toMatchObject({
        node_id: "edge-1",
        collection: "edges",
      });
      // `stats.nodeGroupSize` is a node's search ranking; an edge has no name
      // to be found by and nothing reads a counter on one.
      expect(written).not.toHaveProperty("stats");
    });

    it("does in the write what the triggers did after it", async () => {
      // The node's `revisions` summary and its derived stats move in the
      // transaction that files the revision, as onRevisionWritten and the
      // recount did after it on Firestore.
      const { revisionId } = await create(
        node("node-1"),
        { name: "Nowa Osoba", type: "person" },
        { approve: true, published: true },
      );

      expect((await row("nodes", "node-1"))!.revisions).toMatchObject({
        latest_id: revisionId,
        total: 1,
      });
      const [stats] = await sql<{ is_approved: boolean }[]>`
        SELECT is_approved FROM node_stats WHERE id = 'node-1'`;
      expect(stats?.is_approved).toBe(true);
    });

    it("records that a human made the change, not only that a pipeline did", async () => {
      // Written only when true, a human proposal carried nothing at all, and
      // an equality on the field missed every relation a reader added.
      const { revision } = await create(
        node("node-1"),
        { name: "Jan Kowalski", type: "person" },
        {},
        { uid: "human" },
      );

      expect(revision).toMatchObject({ update_automatic: false });
    });

    it("still marks a pipeline write as automatic", async () => {
      const { revision } = await create(
        node("node-2"),
        { name: "Jan Kowalski", type: "person" },
        { automatic: true },
        { uid: "pipeline" },
      );

      expect(revision).toMatchObject({ update_automatic: true });
    });

    describe("updating a document that already exists", () => {
      /** A published person as the export has them: the data a revision
       * states, and the fields the node owns and no revision carries. */
      const stored = {
        name: "Krystian Probierz",
        type: "person",
        published: true,
        revision_id: "revisions/old-rev",
        votes: { interesting: { total: 3, "reader-a": 3 } },
        stats: {
          isApproved: true,
          notesCount: 2,
          factsCount: 6,
          nodeGroupSize: 4,
          edges: { all: {}, approved: {} },
        },
      };

      /** What the node was written as. */
      async function targetWrite(
        options: Parameters<typeof createRevisionPg>[5],
      ) {
        return (
          await create(
            node("node-1"),
            { name: "Krystian Probierz", type: "person", parties: ["PiS"] },
            options,
          )
        ).written;
      }

      it("keeps the stats the listings filter on", async () => {
        // The listings filter on `stats.isApproved`, and a node missing it is
        // on the site and in no list that leads there.
        expect((await targetWrite({ approve: true, stored })).stats).toEqual(
          stored.stats,
        );
      });

      it("keeps the votes cast on the document", async () => {
        expect((await targetWrite({ approve: true, stored })).votes).toEqual(
          stored.votes,
        );
      });

      it("keeps the page's visibility without being told it", async () => {
        // The caller says what changed, not who may see it.
        expect((await targetWrite({ approve: true, stored })).published).toBe(
          true,
        );
      });

      it("lets the caller override the stored visibility", async () => {
        // Publishing or hiding a document is exactly this decision.
        expect(
          (await targetWrite({ approve: true, stored, published: false }))
            .published,
        ).toBe(false);
      });

      it("does not let a revision restore a stale count over the live one", async () => {
        // Revisions written before the internal fields were stripped out carry
        // a snapshot of them. The document owns those fields; the revision
        // does not get to speak for them.
        const { written } = await create(
          node("node-1"),
          {
            name: "Krystian Probierz",
            type: "person",
            stats: { notesCount: 99 },
          },
          { approve: true, stored },
        );
        expect(written.stats).toEqual(stored.stats);
      });

      it("keeps a removed page removed", async () => {
        // An approved removal is a decision, and a scraper re-run is not a
        // review of it. `pageIsPublic` reads `deleted` too, so losing it would
        // put the page back up.
        const removed = {
          ...stored,
          deleted: true,
          delete_reason: "duplicate",
        };
        const written = await targetWrite({ approve: true, stored: removed });
        expect(written.deleted).toBe(true);
        expect(written.delete_reason).toBe("duplicate");
      });

      it("carries nothing when there is no stored document to carry from", async () => {
        // A document being created owns nothing yet, beyond the counters
        // seeded for it so that it can be found.
        expect(await targetWrite({ approve: true, published: true })).toEqual({
          name: "Krystian Probierz",
          type: "person",
          parties: ["PiS"],
          revision_id: expect.stringMatching(/^revisions\//),
          published: true,
          stats: { nodeGroupSize: 0, isApproved: true, factsCount: 0 },
        });
      });

      it("seeds the counters that decide whether a new node can be found", async () => {
        // /api/search orders by `stats.nodeGroupSize` and the table by the
        // facts count; zero says "not counted yet" until the recount.
        const created = await targetWrite({
          automatic: true,
          published: false,
        });
        expect(created.stats).toEqual({
          nodeGroupSize: 0,
          isApproved: false,
          factsCount: 0,
        });
      });

      it("fills in a counter an existing document is missing", async () => {
        // The nodes written before this was seeded keep arriving here on every
        // re-ingest; repairing them in passing is free.
        const incomplete = {
          ...stored,
          stats: { isApproved: true, notesCount: 2 },
        };
        expect(
          (await targetWrite({ approve: true, stored: incomplete })).stats,
        ).toEqual({
          isApproved: true,
          notesCount: 2,
          nodeGroupSize: 0,
          factsCount: 0,
        });
      });

      it("still states the change itself", async () => {
        // The carry-over is of what the node owns, not of what it said.
        expect((await targetWrite({ approve: true, stored })).parties).toEqual([
          "PiS",
        ]);
      });
    });

    it("agrees with revisionChangesNothingPg, which stands in for it", async () => {
      // Where the check says nothing would change, the write it skipped
      // really would have set the document back to exactly what it holds -
      // bar the pointer to the new revision.
      const stored = {
        name: "PKP Szybka Kolej Miejska w Trójmieście",
        type: "place",
        krsNumber: "0000076705",
        activity: ["49.12.Z", "49.31.Z"],
        categories: ["koleje"],
        isPublic: true,
        published: true,
        revision_id: "revisions/rev-1",
        stats: { nodeGroupSize: 4, isApproved: true },
      };
      const { written } = await create(
        node("node-1"),
        withoutInternalFields(stored),
        {
          automatic: true,
          approve: true,
          stored,
          published: true,
        },
      );

      const { revision_id: _new, ...rest } = written;
      const { revision_id: _old, ...was } = stored;
      expect(rest).toEqual(was);
    });
  });

  describe("applyRevisionPg", () => {
    const user = { uid: "reviewer" };

    /** Approves revision `rev-2` of `node-1`, stating `data`, over a node
     * holding `stored`; the node as written. */
    async function approveOver(
      stored: Data,
      data: Data,
      publish?: boolean,
    ): Promise<Data> {
      const revision = {
        node_id: "node-1",
        collection: "nodes",
        data: { name: "Krystian Probierz", type: "person", ...data },
        status: "pending",
        update_user: "author",
        update_time: "2026-01-01T00:00:00.000Z",
      };
      await arrange({
        "nodes/node-1": {
          name: "Krystian Probierz",
          type: "person",
          ...stored,
        },
        "revisions/rev-2": revision,
      });
      await editorialTx((tx, log) =>
        applyRevisionPg(
          tx,
          log,
          "rev-2",
          revision as unknown as Revision,
          user,
          publish,
        ),
      );
      return asWritten((await row("nodes", "node-1"))!);
    }

    it("keeps the counters and votes the node owns", async () => {
      // The same carry `createRevisionPg` makes, through the same function -
      // the two writing the same document by different rules is how `stats`
      // came to be dropped by one of them.
      const written = await approveOver(
        {
          stats: { isApproved: true, notesCount: 2 },
          votes: { interesting: { total: 3, "reader-a": 3 } },
        },
        {},
      );
      expect(written.stats).toMatchObject({ isApproved: true, notesCount: 2 });
      expect(written.votes).toEqual({
        interesting: { total: 3, "reader-a": 3 },
      });
    });

    it("points the node at the revision being approved", async () => {
      const written = await approveOver({}, {});
      expect(written.revision_id).toBe("revisions/rev-2");
      expect(await row("revisions", "rev-2")).toMatchObject({
        status: "approved",
        review_user: "reviewer",
      });
    });

    it("does not change who can see the page unless told to", async () => {
      expect((await approveOver({ published: true }, {})).published).toBe(true);
      expect((await approveOver({ published: false }, {})).published).toBe(
        false,
      );
    });

    it("publishes when told to", async () => {
      expect(
        (await approveOver({ published: false }, {}, true)).published,
      ).toBe(true);
    });

    describe("filing a change of visibility", () => {
      // Approving with `publish` puts a page live as surely as
      // /api/nodes/publish does, and the publication count and /aktywnosc
      // read only `publish` rows.

      it("files the publication after the approval, with the revision", async () => {
        await approveOver({ published: false }, {}, true);

        expect(await audit()).toEqual([
          expect.objectContaining({ action: "approve", revision_id: "rev-2" }),
          expect.objectContaining({
            action: "publish",
            collection: "nodes",
            target_id: "node-1",
            revision_id: "rev-2",
            user: "reviewer",
          }),
        ]);
      });

      it("files a hiding as an unpublication", async () => {
        await approveOver({ published: true }, {}, false);

        expect(await audit()).toEqual([
          expect.objectContaining({ action: "approve" }),
          expect.objectContaining({
            action: "unpublish",
            target_id: "node-1",
            revision_id: "rev-2",
          }),
        ]);
      });

      it("files nothing more when the page already stood that way", async () => {
        // Re-approving a live page with "zatwierdź i opublikuj" is not a
        // second publication of it.
        await approveOver({ published: true }, {}, true);
        expect((await audit()).map((entry) => entry.action)).toEqual([
          "approve",
        ]);

        await approveOver({}, {}, false);
        expect((await audit()).map((entry) => entry.action)).toEqual([
          "approve",
        ]);
      });

      it("files nothing more when not told about visibility", async () => {
        // /api/nodes/publish approves this way and files its own publication.
        await approveOver({ published: false }, {});
        expect(await audit()).toHaveLength(1);
      });
    });

    it("applies a removal, which states `deleted` in its own data", async () => {
      const written = await approveOver(
        { published: true },
        { deleted: true, delete_reason: "duplicate" },
      );
      expect(written.deleted).toBe(true);
      expect(written.delete_reason).toBe("duplicate");
    });

    it("never publishes the page a removal deletes", async () => {
      // "Zatwierdź i opublikuj" on a removal used to file `approve` +
      // `publish`, which /aktywnosc folded into "opublikował/a".
      const written = await approveOver(
        { published: false },
        { deleted: true, delete_reason: "duplicate" },
        true,
      );
      expect(written.published).toBe(false);
      expect((await audit()).map((entry) => entry.action)).toEqual(["approve"]);
    });

    it("never hides the page a removal deletes either", async () => {
      // The removal is what takes it down; an `unpublish` beside it would be
      // a second decision nobody made.
      const written = await approveOver(
        { published: true },
        { deleted: true, delete_reason: "duplicate" },
        false,
      );
      expect(written.published).toBe(true);
      expect(await audit()).toHaveLength(1);
    });

    it("does not resurrect a removed page by approving an ordinary edit", async () => {
      // A removal is a decision on the record; a later content edit is not a
      // review of it.
      const written = await approveOver(
        { deleted: true, delete_reason: "duplicate" },
        {},
      );
      expect(written.deleted).toBe(true);
    });
  });

  describe("proposeRevisionPg", () => {
    const pipeline = { uid: "pipeline-people-import" };
    const target = edge("edge-1");
    const data = { source: "p", target: "r", type: "election", party: "PiS" };
    /** What the pipeline files a candidacy's proposal under, see `proposalId`. */
    const key = "same-candidacy";
    const address = proposalId("edge-1", data, key);

    /** The revisions as the call finds them. */
    let standing: StoredDocs;

    async function propose(
      options: { automatic?: boolean; key?: string } = { automatic: true, key },
      user = pipeline,
      proposed: Data = data,
      to = target,
    ) {
      await arrange({
        "edges/edge-1": { ...data, party: "PO" },
        ...standing,
      });
      return editorialTx((tx, log) =>
        proposeRevisionPg(tx, log, user, to, proposed, options),
      );
    }
    const revisions = async () => (await rows("revisions")).map((r) => r.id);

    /** A proposal of `data` already filed at the pipeline's address. */
    function filed(fields: Data) {
      standing[`revisions/${address}`] = {
        node_id: "edge-1",
        collection: "edges",
        data,
        update_time: "2026-09-01T00:00:00.000Z",
        update_user: pipeline.uid,
        update_automatic: true,
        status: "pending",
        ...fields,
      };
    }

    beforeEach(() => {
      standing = {};
    });

    it("files a new proposal and leaves the live document alone", async () => {
      const result = await propose();

      expect(result.outcome).toBe("created");
      expect(await revisions()).toEqual([address]);
      expect(await row("revisions", address)).toMatchObject({
        node_id: "edge-1",
        data,
        update_user: "pipeline-people-import",
        update_automatic: true,
        status: "pending",
        collection: "edges",
      });
      expect(await row("edges", "edge-1")).toEqual({ ...data, party: "PO" });
    });

    it("says which collection the target is in", async () => {
      // `node_id` is the target's id whatever the target is, so this is the
      // only thing that makes "the pending changes to edges" a query.
      const result = await propose(undefined, pipeline, data, node("node-1"));

      expect(await row("revisions", result.revisionId)).toMatchObject({
        collection: "nodes",
      });
    });

    it("addresses the pipeline's proposal by what it proposes", async () => {
      // With a fresh id per run the pipeline would add a revision per
      // candidacy per night, forever.
      expect((await propose()).revisionId).toBe(address);
    });

    it("writes nothing when a waiting proposal already says this", async () => {
      // What a night re-sending a person mostly does. Rewriting it anyway
      // moved `update_time`, which the review queue is ordered by.
      filed({});

      const result = await propose();

      expect(result.outcome).toBe("unchanged");
      expect(await row("revisions", address)).toEqual(
        standing[`revisions/${address}`],
      );
    });

    it("moves only the content and its time when a waiting proposal said something else", async () => {
      filed({ data: { ...data, party: "PO" } });
      const before = standing[`revisions/${address}`]!;

      const result = await propose();

      expect(result.outcome).toBe("refreshed");
      expect(await revisions()).toEqual([address]);
      const after = (await row("revisions", address))!;
      expect(after.data).toEqual(data);
      expect(after.update_time).not.toBe(before.update_time);
      const { data: _d, update_time: _t, ...rest } = after;
      const { data: _bd, update_time: _bt, ...was } = before;
      expect(rest).toEqual(was);
    });

    it("leaves an approved proposal as the reviewer left it", async () => {
      filed({
        status: "approved",
        review_user: "reviewer",
        review_time: "2026-09-02T00:00:00.000Z",
      });

      const result = await propose();

      expect(result.outcome).toBe("decided");
      expect(await row("revisions", address)).toEqual(
        standing[`revisions/${address}`],
      );
    });

    it("leaves a rejected proposal rejected, reason and all", async () => {
      filed({
        status: "rejected",
        review_user: "reviewer",
        reject_reason: "inna osoba",
      });

      const result = await propose();

      expect(result.outcome).toBe("decided");
      expect(await revisions()).toEqual([address]);
      expect(await row("revisions", address)).toEqual(
        standing[`revisions/${address}`],
      );
    });

    it("reads a proposal stored before statuses as still waiting", async () => {
      filed({ status: undefined });

      expect((await propose()).outcome).toBe("unchanged");
    });

    describe("a person's proposal", () => {
      const anna = { uid: "anna" };
      const piotr = { uid: "piotr" };

      it("is filed under their uid, so two people proposing one fix are two proposals", async () => {
        const first = await propose({}, anna);
        standing[`revisions/${first.revisionId}`] = await row(
          "revisions",
          first.revisionId,
        );
        const second = await propose({}, piotr);

        expect(first.revisionId).toBe(proposalId("edge-1_anna", data));
        expect(second.revisionId).toBe(proposalId("edge-1_piotr", data));
        expect(await row("revisions", first.revisionId)).toMatchObject({
          update_user: "anna",
          update_automatic: false,
        });
      });

      it("comes back to them unwritten while it is still waiting", async () => {
        standing[`revisions/${proposalId("edge-1_anna", data)}`] = {
          node_id: "edge-1",
          data,
          status: "pending",
          update_user: "anna",
        };

        const result = await propose({}, anna);

        expect(result).toMatchObject({ outcome: "unchanged" });
        expect(result.revisionId).toBe(proposalId("edge-1_anna", data));
        expect(await revisions()).toEqual([proposalId("edge-1_anna", data)]);
      });

      it("asked again after a verdict is a second ask, filed beside the first", async () => {
        // The way /api/revisions/create treats a node proposal made again:
        // the verdict stays on the record it was given to.
        const first = proposalId("edge-1_anna", data);
        standing[`revisions/${first}`] = {
          node_id: "edge-1",
          data,
          status: "rejected",
          reject_reason: "brak źródła",
          update_user: "anna",
        };

        const result = await propose({}, anna);

        expect(result).toMatchObject({ outcome: "created" });
        expect(result.revisionId).not.toBe(first);
        expect((await revisions()).sort()).toEqual(
          [first, result.revisionId].sort(),
        );
        expect(await row("revisions", first)).toEqual(
          standing[`revisions/${first}`],
        );
      });
    });
  });
});
