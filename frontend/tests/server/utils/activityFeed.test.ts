import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  batchFeedEvents,
  feedInstant,
  foldAuditRows,
  type FeedAuditRow,
  type FeedEvent,
} from "../../../server/utils/activityFeed";
import {
  countedFeedKinds,
  describeFeedBatch,
  feedKinds,
  type FeedTargetType,
  type RawFeedBatch,
} from "~~/shared/activityFeed";

/** What a Timestamp read back from Firestore looks like to the code: a fresh
 * object each time, even for the same instant. */
const stamp = (iso: string) => ({ toDate: () => new Date(iso) });

const SINCE = "2026-09-15T00:00:00.000Z";
const UNTIL = "2026-09-22T00:00:00.000Z";
/** An instant on 2026-09-20, the window's second-to-last day. */
const at = (time: string) => `2026-09-20T${time}.000Z`;

/** The batches as "uid kind count", for a test that is only about which
 * batches there are. */
const lines = (batches: RawFeedBatch[]) =>
  batches.map((batch) => `${batch.uid} ${batch.kind} ${batch.count}`);

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("feedInstant", () => {
  const window = { sinceIso: SINCE, untilIso: UNTIL };

  it("reads a string or a Timestamp inside the window as a canonical instant", () => {
    expect(feedInstant("2026-09-20T10:00:00Z", window)).toBe(at("10:00:00"));
    expect(feedInstant(stamp(at("10:00:00")), window)).toBe(at("10:00:00"));
    expect(feedInstant(SINCE, window)).toBe(SINCE);
  });

  it("refuses anything outside the window, or not an instant at all", () => {
    for (const value of [
      "2026-09-14T23:59:59.999Z",
      UNTIL,
      "9999-01-01T00:00:00.000Z",
      "2026-09-21T23:30:00.000-05:00",
      "2026-09-20Tgarbage",
      "",
      42,
      null,
      undefined,
    ]) {
      expect([value, feedInstant(value, window)]).toEqual([value, null]);
    }
  });
});

describe("batchFeedEvents", () => {
  let n = 0;
  const event = (
    overrides: Partial<Omit<FeedEvent, "target">> & {
      target?: string;
      type?: FeedTargetType;
    } = {},
  ): FeedEvent => {
    const { target = "p1", type = "person", ...rest } = overrides;
    const collection =
      type === "edge" ? "edges" : type === "fact" ? "extractions" : "nodes";
    return {
      uid: "anna",
      kind: "vote",
      at: at("10:00:00"),
      unit: `unit-${n++}`,
      ...rest,
      target: {
        collection,
        id: target,
        type,
        name: `Name ${target}`,
        href: `/x/${target}`,
      },
    };
  };

  it("keeps one person's actions in one batch while each follows the last within the gap", () => {
    const batches = batchFeedEvents([
      event({ at: at("10:00:00"), target: "a" }),
      event({ at: at("11:30:00"), target: "b" }),
      event({ at: at("13:29:00"), target: "c" }),
      // 2 h 1 min after the last one: a new sitting.
      event({ at: at("15:30:00"), target: "d" }),
    ]);

    expect(
      batches.map((batch) => [batch.firstAt, batch.lastAt, batch.count]),
    ).toEqual([
      [at("15:30:00"), at("15:30:00"), 1],
      [at("10:00:00"), at("13:29:00"), 3],
    ]);
  });

  it("keeps an action exactly the gap after the last in the same batch", () => {
    const batches = batchFeedEvents([
      event({ at: at("10:00:00"), target: "a" }),
      event({ at: at("12:00:00"), target: "b" }),
    ]);

    expect(batches).toHaveLength(1);
  });

  it("does not break a batch for other kinds done in between", () => {
    const batches = batchFeedEvents([
      event({ at: at("10:00:00"), target: "a" }),
      event({ at: at("10:30:00"), kind: "publish", target: "b" }),
      event({ at: at("11:00:00"), target: "c" }),
    ]);

    expect(lines(batches)).toEqual(["anna vote 2", "anna publish 1"]);
  });

  it("keeps each person's batches apart", () => {
    const batches = batchFeedEvents([
      event({ uid: "anna", target: "a" }),
      event({ uid: "jan", target: "a" }),
    ]);

    expect(lines(batches)).toEqual(["anna vote 1", "jan vote 1"]);
  });

  it("lists each target once, newest first, and counts targets by type", () => {
    const [batch] = batchFeedEvents([
      event({ at: at("10:00:00"), target: "p1" }),
      event({ at: at("10:05:00"), target: "f1", type: "fact" }),
      event({ at: at("10:10:00"), target: "p2" }),
      event({ at: at("10:15:00"), target: "p1" }),
    ]);

    expect(batch?.targets.map((target) => target.id)).toEqual([
      "p1",
      "p2",
      "f1",
    ]);
    expect(batch?.count).toBe(3);
    expect(batch?.objects).toEqual({ person: 2, fact: 1 });
  });

  it("tells a page and a fact with the same id apart", () => {
    const [batch] = batchFeedEvents([
      event({ target: "x" }),
      event({ target: "x", type: "fact" }),
    ]);

    expect(batch?.count).toBe(2);
  });

  it("lists 12 targets of a voting session and 50 of a decision", () => {
    const votes = Array.from({ length: 15 }, (_, i) =>
      event({ target: `p${i}`, at: at(`10:${String(i).padStart(2, "0")}:00`) }),
    );
    const publications = Array.from({ length: 60 }, (_, i) =>
      event({ kind: "publish", target: `q${i}` }),
    );

    const [vote] = batchFeedEvents(votes);
    const [publish] = batchFeedEvents(publications);

    expect(vote).toMatchObject({ count: 15, moreTargets: 3 });
    expect(vote?.targets).toHaveLength(12);
    expect(vote?.objects).toEqual({ person: 15 });
    expect(vote?.targets[0]?.id).toBe("p14");
    expect(publish).toMatchObject({ count: 60, moreTargets: 10 });
    expect(publish?.targets).toHaveLength(50);
  });

  it("counts proposals, not the pages they were on", () => {
    const [batch] = batchFeedEvents([
      event({
        kind: "proposal",
        unit: "r1",
        revisionId: "r1",
        at: at("10:00:00"),
      }),
      event({
        kind: "proposal",
        unit: "r2",
        revisionId: "r2",
        at: at("10:01:00"),
      }),
      event({
        kind: "proposal",
        unit: "r3",
        revisionId: "r3",
        at: at("10:02:00"),
      }),
    ]);

    expect(batch).toMatchObject({ count: 3, objects: { person: 1 } });
    expect(batch?.targets).toHaveLength(1);
    expect(batch?.targets[0]?.revisionId).toBe("r3");
  });

  it("keeps what each target's events said of it", () => {
    const [batch] = batchFeedEvents([
      event({
        kind: "reject",
        unit: "r1",
        reason: "bez źródła",
        selfApproved: true,
        at: at("10:00:00"),
      }),
      event({
        kind: "reject",
        unit: "r2",
        reason: "duplikat",
        at: at("10:01:00"),
      }),
      event({
        kind: "reject",
        unit: "r3",
        revisionId: "r3",
        at: at("10:02:00"),
      }),
    ]);

    expect(batch?.targets).toEqual([
      {
        id: "p1",
        type: "person",
        name: "Name p1",
        href: "/x/p1",
        revisionId: "r3",
        selfApproved: true,
        reason: "duplikat",
      },
    ]);
  });

  it("counts the relations published with their pages beside them, unlisted", () => {
    const [batch] = batchFeedEvents([
      event({ kind: "publish", target: "p1" }),
      event({ kind: "publish", target: "e1", type: "edge" }),
      event({ kind: "publish", target: "e2", type: "edge" }),
      event({ kind: "publish", target: "p2" }),
      event({ kind: "publish", target: "e3", type: "edge" }),
    ]);

    expect(batch).toMatchObject({
      count: 2,
      objects: { person: 2 },
      alongEdges: 3,
      moreTargets: 0,
    });
    expect(batch?.targets.map((target) => target.type)).toEqual([
      "person",
      "person",
    ]);
    expect(describeFeedBatch(batch!)).toBe(
      "opublikował/a 2 osoby razem z 3 powiązaniami",
    );
  });

  it("lists a relation published with pages when its publisher proposed it", () => {
    // A new administrator adds a relation to an ingest-made person, then
    // publishes both: the relation is theirs, and must not fold away unseen.
    const [batch] = batchFeedEvents([
      event({ kind: "publish", target: "p1", at: at("10:00:00") }),
      event({
        kind: "publish",
        target: "e1",
        type: "edge",
        selfApproved: true,
        revisionId: "r1",
        at: at("10:01:00"),
      }),
      event({
        kind: "publish",
        target: "e2",
        type: "edge",
        at: at("10:02:00"),
      }),
    ]);

    expect(batch).toMatchObject({
      count: 2,
      objects: { person: 1, edge: 1 },
      alongEdges: 1,
      moreTargets: 0,
    });
    expect(batch?.targets).toEqual([
      {
        id: "e1",
        type: "edge",
        name: "Name e1",
        href: "/x/e1",
        revisionId: "r1",
        selfApproved: true,
      },
      { id: "p1", type: "person", name: "Name p1", href: "/x/p1" },
    ]);
    expect(describeFeedBatch(batch!)).toBe(
      "opublikował/a 1 osobę i 1 powiązanie razem z 1 powiązaniem",
    );
  });

  it("counts a target left unread, and lists only what was read", () => {
    const unread = (id: string, time: string): FeedEvent => ({
      ...event({ kind: "proposal", at: at(time) }),
      target: { collection: "nodes", id, type: "person", unread: true },
    });
    const [batch] = batchFeedEvents([
      unread("p9", "10:00:00"),
      event({ kind: "proposal", target: "p1", at: at("10:01:00") }),
      event({ kind: "proposal", target: "p2", at: at("10:02:00") }),
      // The same page again, left unread this time: what was read of it
      // stands.
      unread("p1", "10:03:00"),
    ]);

    expect(batch).toMatchObject({
      count: 4,
      objects: { person: 3 },
      moreTargets: 1,
    });
    expect(batch?.targets.map((target) => [target.id, target.name])).toEqual([
      ["p1", "Name p1"],
      ["p2", "Name p2"],
    ]);
  });

  it("lists relations published on their own", () => {
    const [batch] = batchFeedEvents([
      event({ kind: "unpublish", target: "e1", type: "edge" }),
      event({ kind: "unpublish", target: "e2", type: "edge" }),
    ]);

    expect(batch).toMatchObject({
      count: 2,
      objects: { edge: 2 },
      alongEdges: 0,
    });
    expect(batch?.targets).toHaveLength(2);
  });

  it("does not fold relations into anything but a publication", () => {
    const [batch] = batchFeedEvents([
      event({ kind: "delete", target: "p1" }),
      event({ kind: "delete", target: "e1", type: "edge" }),
    ]);

    expect(batch).toMatchObject({
      count: 2,
      objects: { person: 1, edge: 1 },
      alongEdges: 0,
    });
  });

  it("orders batches newest first, then by person and kind", () => {
    const batches = batchFeedEvents([
      event({ uid: "zofia", at: at("09:00:00") }),
      event({ uid: "jan", kind: "note", at: at("12:00:00") }),
      event({ uid: "jan", kind: "approve", at: at("12:00:00") }),
      event({ uid: "anna", kind: "note", at: at("12:00:00") }),
    ]);

    expect(batches.map((batch) => `${batch.uid} ${batch.kind}`)).toEqual([
      "anna note",
      "jan approve",
      "jan note",
      "zofia vote",
    ]);
  });

  it("counts documents for exactly the kinds whose sentence has a counted noun", () => {
    // The sentence prints `count` for these and the per-type objects for the
    // rest; the two lists must not drift apart.
    for (const kind of feedKinds) {
      const sentence = describeFeedBatch({
        kind,
        count: 7,
        objects: { person: 3 },
        alongEdges: 0,
      });
      expect([kind, sentence.includes("7")]).toEqual([
        kind,
        countedFeedKinds.has(kind),
      ]);
    }
  });
});

// ---------------------------------------------------------------------------

describe("foldAuditRows", () => {
  const row = (overrides: Partial<FeedAuditRow>): FeedAuditRow => {
    const time = overrides.at ?? at("10:00:00");
    return {
      id: "row",
      uid: "admin",
      action: "approve",
      collection: "nodes",
      targetId: "p1",
      ...overrides,
      at: time,
      ms: Date.parse(time),
    };
  };

  it("moves a page's approval onto its publication", () => {
    const folded = foldAuditRows([
      row({ id: "a", revisionId: "r1" }),
      row({ id: "p", action: "publish", at: at("10:00:04") }),
    ]);

    expect(folded).toEqual([
      expect.objectContaining({ id: "p", action: "publish", revisionId: "r1" }),
    ]);
  });

  it("leaves the rows it did not fold as they were", () => {
    const rows = [row({ id: "a", revisionId: "r1" })];

    expect(foldAuditRows(rows)).toEqual(rows);
  });
});
