import { describe, it, expect } from "vitest";
import {
  holdsRevision,
  INTERNAL_FIELDS,
  proposalId,
  sameStoredValue,
  sanitizeFirestoreData,
  withSeededNodeStats,
  withoutInternalFields,
} from "../../../server/utils/revisions";
import { revisionChangesNothingPg } from "../../../server/db/proposals";
import { skippedChangeFields } from "../../../shared/revisionChanges";

describe("sanitizeFirestoreData", () => {
  it("keeps a top-level array field an array", () => {
    // The whole point: `parties` is queried with array-contains-any, which
    // matches nothing against a map and does not raise.
    expect(sanitizeFirestoreData({ parties: ["PiS", "PSL"] })).toEqual({
      parties: ["PiS", "PSL"],
    });
  });

  it("keeps an empty array an array", () => {
    // `{}` would not match the "no party" filter either, which looks for
    // `parties == []`.
    expect(sanitizeFirestoreData({ parties: [] })).toEqual({ parties: [] });
  });

  it("keeps arrays nested inside objects arrays", () => {
    expect(sanitizeFirestoreData({ note: { sources: ["a", "b"] } })).toEqual({
      note: { sources: ["a", "b"] },
    });
  });

  it("rewrites an array directly inside an array as a map", () => {
    // Firestore has no array-of-arrays, so this one really cannot be stored.
    expect(sanitizeFirestoreData({ grid: [["a", "b"], ["c"]] })).toEqual({
      grid: [{ 0: "a", 1: "b" }, { 0: "c" }],
    });
  });

  it("keeps an array of objects, including their own arrays", () => {
    expect(
      sanitizeFirestoreData({
        sources: [{ url: "u", tags: ["x"] }],
      }),
    ).toEqual({ sources: [{ url: "u", tags: ["x"] }] });
  });

  it("drops undefined and null fields", () => {
    expect(sanitizeFirestoreData({ a: 1, b: undefined, c: null })).toEqual({
      a: 1,
    });
  });

  it("drops undefined and null array elements rather than leaving holes", () => {
    // Firestore rejects an undefined element outright.
    expect(sanitizeFirestoreData({ tags: ["a", null, "b"] })).toEqual({
      tags: ["a", "b"],
    });
  });

  it("leaves primitives alone", () => {
    expect(sanitizeFirestoreData({ n: 1, s: "x", b: false })).toEqual({
      n: 1,
      s: "x",
      b: false,
    });
  });

  // A Firestore value type is an object, but it is a value: taken apart into
  // its private fields it becomes a map, and a map is not a timestamp to sort
  // on, not a reference to follow, and not a `toDate()` anybody can call. Every
  // article node written through `ensureArticleNode` carried a `publishedDate`
  // decomposed this way. Told apart by prototype, so this covers the whole
  // family rather than the three the SDK happens to export today.
  class FakeTimestamp {
    constructor(
      readonly _seconds: number,
      readonly _nanoseconds: number,
    ) {}
    toDate() {
      return new Date(this._seconds * 1000);
    }
  }

  it("keeps a Firestore value type whole rather than storing its fields", () => {
    const stamp = new FakeTimestamp(1_700_000_000, 0);
    const result = sanitizeFirestoreData({ publishedDate: stamp }) as {
      publishedDate: FakeTimestamp;
    };
    expect(result.publishedDate).toBe(stamp);
    expect(result.publishedDate).toBeInstanceOf(FakeTimestamp);
  });

  it("keeps one nested inside an object and inside an array", () => {
    const stamp = new FakeTimestamp(1_700_000_000, 0);
    const result = sanitizeFirestoreData({
      meta: { fetchedAt: stamp },
      spells: [{ start: stamp }],
    }) as {
      meta: { fetchedAt: FakeTimestamp };
      spells: { start: FakeTimestamp }[];
    };
    expect(result.meta.fetchedAt).toBe(stamp);
    expect(result.spells[0]!.start).toBe(stamp);
  });

  it("still descends into a plain object that merely looks like one", () => {
    // The guard is about the prototype, not the field names - a map that came
    // off `doc.data()` with these keys is still a map to sanitize.
    expect(
      sanitizeFirestoreData({
        publishedDate: { _seconds: 1, _nanoseconds: 2, gone: undefined },
      }),
    ).toEqual({ publishedDate: { _seconds: 1, _nanoseconds: 2 } });
  });
});

describe("withSeededNodeStats", () => {
  it("seeds a facts count on a person", () => {
    // /eksploruj/tabela orders by it, and Firestore drops a document that
    // lacks the ordered field rather than sorting it last.
    const seeded = withSeededNodeStats({ type: "person", name: "A" });
    expect(seeded.stats).toEqual({
      nodeGroupSize: 0,
      isApproved: false,
      factsCount: 0,
    });
  });

  it("seeds none on a company", () => {
    // An extracted fact is matched to a person node and to nothing else, so
    // a zero here would be a field written onto every company and region to
    // state what is true of them by construction.
    const seeded = withSeededNodeStats({ type: "place", name: "Orlen" });
    expect(seeded.stats).toEqual({ nodeGroupSize: 0, isApproved: false });
  });

  it("leaves a count that has already been taken alone", () => {
    const seeded = withSeededNodeStats({
      type: "person",
      stats: { factsCount: 9 },
    });
    expect((seeded.stats as { factsCount: number }).factsCount).toBe(9);
  });
});

describe("withoutInternalFields", () => {
  it("drops the pointer to the revision the document currently says it by", () => {
    // Carrying it into a proposal would freeze a stale answer into it.
    expect(
      withoutInternalFields({
        type: "election",
        committee: "KW PiS",
        revision_id: { id: "old-rev" },
        stats: { people: 3 },
        visibility: true,
      }),
    ).toEqual({ type: "election", committee: "KW PiS" });
  });
});

describe("holdsRevision", () => {
  const candidacy = {
    source: "p",
    target: "r",
    type: "election",
    start_date: "2024-01-01",
  };

  it("holds the revision it was written from, whatever it owns besides", () => {
    expect(
      holdsRevision(
        {
          ...candidacy,
          published: true,
          revision_id: { path: "revisions/r1" },
          stats: { votes: 2 },
        },
        candidacy,
      ),
    ).toBe(true);
  });

  it("does not hold a proposal that adds a field", () => {
    // The committee proposals publishing used to mark approved.
    expect(
      holdsRevision(candidacy, { ...candidacy, committee: "KWW Nasza Gmina" }),
    ).toBe(false);
  });

  it("does not hold a proposal that changes a field", () => {
    expect(
      holdsRevision(candidacy, { ...candidacy, start_date: "2014-01-01" }),
    ).toBe(false);
  });

  it("does not hold a proposal that takes a field away", () => {
    // A contributor unticking a win: the null is dropped on the way to
    // Firestore, so the proposal is the candidacy without `elected`, and every
    // field it does state is still on the edge.
    expect(holdsRevision({ ...candidacy, elected: true }, candidacy)).toBe(
      false,
    );
  });

  it("does not hold a revision stating null for a field the document lacks", () => {
    expect(holdsRevision(candidacy, { ...candidacy, committee: null })).toBe(
      false,
    );
  });

  it("ignores the fields a revision should never have carried", () => {
    expect(
      holdsRevision(candidacy, {
        ...candidacy,
        revision_id: "revisions/elsewhere",
        published: false,
      }),
    ).toBe(true);
  });

  it("compares by value, whatever order the fields were assembled in", () => {
    expect(
      holdsRevision(
        { ...candidacy, references: [{ url: "a", title: "b" }] },
        { references: [{ title: "b", url: "a" }], ...candidacy },
      ),
    ).toBe(true);
  });
});

describe("proposalId", () => {
  it("does not depend on the order the content was assembled in", () => {
    // The proposal is built by spreading the stored edge and the payload
    // together, and property order there follows insertion.
    expect(proposalId("edge-1", { a: 1, b: 2 })).toBe(
      proposalId("edge-1", { b: 2, a: 1 }),
    );
  });

  it("keeps two different proposals about one edge apart", () => {
    expect(proposalId("edge-1", { committee: "KW PiS" })).not.toBe(
      proposalId("edge-1", { committee: "KW Nowa Lewica" }),
    );
  });

  it("keeps the same proposal about two edges apart", () => {
    expect(proposalId("edge-1", { committee: "KW PiS" })).not.toBe(
      proposalId("edge-2", { committee: "KW PiS" }),
    );
  });

  it("produces an id Firestore will accept", () => {
    const id = proposalId("edge_p_teryt1465_election_aBcDeFgHiJ", {
      committee: "KW PiS",
    });
    expect(id).not.toContain("/");
    expect(id.length).toBeLessThan(1500);
  });

  it("files one offer once, however the caller says it is worded", () => {
    // The ingest passes `edgeIdentity`, which folds the case and spacing PKW
    // varies. Without that, a re-scrape in a different case would file a second
    // proposal saying the same thing.
    expect(proposalId("edge-1", { committee: "KW PIS" }, "same-fact")).toBe(
      proposalId("edge-1", { committee: "Kw Pis" }, "same-fact"),
    );
  });
});

describe("the fields a document owns", () => {
  it("partitions a document the same way the diff does", () => {
    // `revisionChanges` skips the fields a document owns rather than states,
    // because a revision written before the ingest stripped them still carries
    // them inside its own `data` - `revision_id` among them, which decodes to a
    // DocumentReference with no readable rendering at all. The two lists have
    // to agree or those fields come back as changes on one side only.
    for (const field of INTERNAL_FIELDS) {
      expect(skippedChangeFields.has(field), `${field} is diffed`).toBe(true);
    }
  });
});

describe("sameStoredValue", () => {
  it("does not mind what order the keys are in", () => {
    // The one thing a stringify comparison gets wrong. A revision is built by
    // spreading a payload over the stored document, which moves every field the
    // payload restates to the end of the object.
    expect(sameStoredValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("does mind what order an array is in", () => {
    // `activity` is a list of PKD codes and `parties` a list of parties, and
    // the order they are stored in is what the page shows.
    expect(sameStoredValue(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("tells an absent field from one set to undefined", () => {
    expect(sameStoredValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it("compares nested maps and arrays by value", () => {
    expect(
      sameStoredValue(
        { stats: { nodeGroupSize: 2 }, categories: ["koleje"] },
        { stats: { nodeGroupSize: 2 }, categories: ["koleje"] },
      ),
    ).toBe(true);
    expect(
      sameStoredValue(
        { stats: { nodeGroupSize: 2 } },
        { stats: { nodeGroupSize: 3 } },
      ),
    ).toBe(false);
  });

  it("asks a Firestore value how it compares", () => {
    // A Timestamp or a DocumentReference is a class instance, so identity would
    // say two readings of the same document differ. Both carry `isEqual`.
    const stamp = (millis: number) => ({
      millis,
      isEqual(other: { millis: number }) {
        return other.millis === millis;
      },
    });
    expect(sameStoredValue(stamp(1), stamp(1))).toBe(true);
    expect(sameStoredValue(stamp(1), stamp(2))).toBe(false);
    // And a plain map is not one of them, whichever side it is on.
    expect(sameStoredValue(stamp(1), { millis: 1 })).toBe(false);
  });
});

describe("revisionChangesNothingPg", () => {
  /** A company as the ingest finds it: live, approved, counted. */
  const storedCompany = () => ({
    name: "PKP Szybka Kolej Miejska w Trójmieście",
    type: "place",
    krsNumber: "0000076705",
    activity: ["49.12.Z", "49.31.Z"],
    categories: ["koleje"],
    isPublic: true,
    published: true,
    revision_id: "revisions/rev-1",
    stats: { nodeGroupSize: 4, isApproved: true },
  });

  const approvedOptions = (stored: Record<string, unknown>) => ({
    automatic: true,
    approve: true,
    stored,
    published: true,
  });

  it("recognises a payload that restates what the node already says", () => {
    const stored = storedCompany();
    expect(
      revisionChangesNothingPg(
        "nodes",
        withoutInternalFields(stored),
        approvedOptions(stored),
      ),
    ).toBe(true);
  });

  it("does not mind the payload putting the fields in another order", () => {
    const stored = storedCompany();
    const reordered = {
      krsNumber: stored.krsNumber,
      categories: stored.categories,
      isPublic: stored.isPublic,
      activity: stored.activity,
      type: stored.type,
      name: stored.name,
    };
    expect(
      revisionChangesNothingPg("nodes", reordered, approvedOptions(stored)),
    ).toBe(true);
  });

  it("sees a field the payload has learned", () => {
    const stored = storedCompany();
    expect(
      revisionChangesNothingPg(
        "nodes",
        {
          ...withoutInternalFields(stored),
          categories: ["koleje", "szpitale"],
        },
        approvedOptions(stored),
      ),
    ).toBe(false);
  });

  it("sees a field the write would delete", () => {
    // The write is a `set`, so a revision that says less than the document does
    // is not a no-op: it drops the difference.
    const stored = storedCompany();
    const { isPublic: _dropped, ...without } = withoutInternalFields(stored);
    expect(
      revisionChangesNothingPg("nodes", without, approvedOptions(stored)),
    ).toBe(false);
  });

  it("never skips creating a document", () => {
    expect(
      revisionChangesNothingPg(
        "nodes",
        { name: "Nowa", type: "place" },
        {
          automatic: true,
          approve: true,
          published: true,
        },
      ),
    ).toBe(false);
  });

  it("writes a company that has no approved revision to point at", () => {
    // Approving is what gives the node its `revision_id`, so a node without one
    // needs the write even where it already says the right thing.
    const { revision_id: _none, ...stored } = storedCompany();
    expect(
      revisionChangesNothingPg(
        "nodes",
        withoutInternalFields(stored),
        approvedOptions(stored),
      ),
    ).toBe(false);
  });

  it("writes a company whose counters nothing has filled in", () => {
    // `withSeededNodeStats` would add them, and `/api/nodes` filters every
    // listing on `stats.isApproved` - a node missing it is on the site and in
    // no list that leads there, so the write is a repair.
    const { stats: _none, ...stored } = storedCompany();
    expect(
      revisionChangesNothingPg(
        "nodes",
        withoutInternalFields(stored),
        approvedOptions(stored),
      ),
    ).toBe(false);
  });

  it("writes when the caller is changing what the public can see", () => {
    const stored = storedCompany();
    expect(
      revisionChangesNothingPg("nodes", withoutInternalFields(stored), {
        ...approvedOptions(stored),
        published: false,
      }),
    ).toBe(false);
  });

  it("does not ask an edge for the counters only a node carries", () => {
    const stored = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      name: "Prezes",
      published: true,
      revision_id: "revisions/rev-1",
    };
    expect(
      revisionChangesNothingPg(
        "edges",
        withoutInternalFields(stored),
        approvedOptions(stored),
      ),
    ).toBe(true);
  });
});
