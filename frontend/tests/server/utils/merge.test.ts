import { describe, it, expect } from "vitest";
import {
  carriedFields,
  countDispositions,
  votesToMove,
  mergeRefusal,
  planEdgeMoves,
  type MergeEdgePlan,
} from "../../../server/utils/merge";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.createError = (err: any) => err;

/** A stored relation in the shape `planEdgeMoves` reads it: an id and the
 * document behind it. */
function edgeDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

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

describe("planEdgeMoves", () => {
  it("moves a spell the survivor has never heard of", async () => {
    const edges = planEdgeMoves(
      [edgeDoc("d1", employed("dup", "firma"))],
      [],
      "dup",
      "surv",
    );

    expect(edges).toEqual([
      {
        edge_id: "d1",
        type: "employed",
        role: "source",
        disposition: "moved",
      },
    ]);
  });

  it("collapses a spell the survivor already states, naming the one it kept", async () => {
    // 452 of the 524 collisions the 170 duplicate pairs would produce are this
    // case: both pages carry the same board seat because both were ingested
    // from the same register entry under two spellings of one name.
    const edges = planEdgeMoves(
      [edgeDoc("d1", employed("dup", "firma"))],
      [edgeDoc("s1", employed("surv", "firma"))],
      "dup",
      "surv",
    );

    expect(edges).toEqual([
      {
        edge_id: "d1",
        type: "employed",
        role: "source",
        disposition: "collapsed",
        duplicate_of: "s1",
      },
    ]);
  });

  it("never collapses a candidacy, because identical fields are not one fact there", async () => {
    // `identicalMeansSame: false` for `election`, and this is the assertion
    // that holds the merge to it. The office collapses into "Samorząd", the
    // gmina TERYT is truncated to its powiat and the run-off round is thrown
    // away before the ingest sees any of it, so two identical documents are
    // routinely two real candidacies. 72 of the 524 collisions are these, and
    // removing one of them would delete a fact nobody could get back.
    const edges = planEdgeMoves(
      [edgeDoc("d1", election("dup", "powiat"))],
      [edgeDoc("s1", election("surv", "powiat"))],
      "dup",
      "surv",
    );

    expect(edges).toEqual([
      {
        edge_id: "d1",
        type: "election",
        role: "source",
        disposition: "review",
        duplicate_of: "s1",
      },
    ]);
    expect(countDispositions(edges).collapsed).toBe(0);
  });

  it("counts two look-alike candidacies as two, rather than folding the second into the first", async () => {
    // The duplicate's two are still two after the move, so both are reported
    // against the survivor's one rather than the second being read as a repeat
    // of the first - which is what would happen if the plan recorded only
    // whether the survivor held the identity at all.
    const edges = planEdgeMoves(
      [
        edgeDoc("d1", election("dup", "powiat")),
        edgeDoc("d2", election("dup", "powiat")),
      ],
      [edgeDoc("s1", election("surv", "powiat"))],
      "dup",
      "surv",
    );

    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => edge.disposition)).toEqual(["review", "review"]);
    // Both point at the survivor's relation, not at each other: d2 is not a
    // duplicate of d1, they came off one page together.
    expect(edges.map((edge) => edge.duplicate_of)).toEqual(["s1", "s1"]);
    expect(countDispositions(edges)).toEqual({
      moved: 0,
      collapsed: 0,
      enriched: 0,
      review: 2,
      self: 0,
    });
  });

  it("drops a relation whose two ends were both the duplicate", async () => {
    // A loop is not a fact about anybody, and the merge is what would create
    // it.
    const edges = planEdgeMoves(
      [edgeDoc("d1", employed("dup", "dup"))],
      [],
      "dup",
      "surv",
    );

    expect(edges).toEqual([
      { edge_id: "d1", type: "employed", role: "both", disposition: "self" },
    ]);
  });

  it("drops a relation between the two pages being merged", async () => {
    // The other way a loop appears: the duplicate and the survivor are already
    // tied to each other, so re-pointing one end lands on the other.
    const edges = planEdgeMoves(
      [edgeDoc("d1", employed("dup", "surv"))],
      [],
      "dup",
      "surv",
    );

    expect(edges).toMatchObject([{ edge_id: "d1", disposition: "self" }]);
  });

  it("leaves a relation that was already removed where it is", async () => {
    // It asserts nothing, so moving it would only give the survivor a second
    // dead copy - and the reason it went was recorded against the page it went
    // from.
    const edges = planEdgeMoves(
      [edgeDoc("d1", { ...employed("dup", "firma"), deleted: true })],
      [],
      "dup",
      "surv",
    );

    expect(edges).toEqual([]);
  });

  it("does not count a removed relation on the survivor as holding anything", async () => {
    // Otherwise a spell the survivor deleted would swallow the live one the
    // duplicate carries.
    const edges = planEdgeMoves(
      [edgeDoc("d1", employed("dup", "firma"))],
      [edgeDoc("s1", { ...employed("surv", "firma"), deleted: true })],
      "dup",
      "surv",
    );

    expect(edges).toMatchObject([{ edge_id: "d1", disposition: "moved" }]);
  });

  it("moves a relation that names the duplicate as its target", async () => {
    // 9 of the 2044 relations the 170 pairs would move are inbound - an
    // article naming the person, mostly - and the role is what tells the write
    // which end to rewrite.
    const edges = planEdgeMoves(
      [edgeDoc("d1", { type: "mentions", source: "artykul", target: "dup" })],
      [],
      "dup",
      "surv",
    );

    expect(edges).toEqual([
      {
        edge_id: "d1",
        type: "mentions",
        role: "target",
        disposition: "moved",
      },
    ]);
  });

  it("collapses an inbound relation the survivor already has", async () => {
    // `mentions` is a state edge: an article naming one person twice names
    // them once.
    const edges = planEdgeMoves(
      [edgeDoc("d1", { type: "mentions", source: "artykul", target: "dup" })],
      [edgeDoc("s1", { type: "mentions", source: "artykul", target: "surv" })],
      "dup",
      "surv",
    );

    expect(edges).toMatchObject([
      { edge_id: "d1", disposition: "collapsed", duplicate_of: "s1" },
    ]);
  });

  it("plans in a stable order, so a dry run predicts the run that follows it", async () => {
    const edges = planEdgeMoves(
      [
        edgeDoc("d9", employed("dup", "firma", "2019-01-01")),
        edgeDoc("d1", employed("dup", "firma", "2021-01-01")),
      ],
      [],
      "dup",
      "surv",
    );

    expect(edges.map((edge) => edge.edge_id)).toEqual(["d1", "d9"]);
  });

  it("retires a candidacy the survivor already states more fully", async () => {
    // The bug this was reported for. `TY8bMoaheJqzINdOTIoJ` held three
    // candidacies with no party and no committee; `XGPwmZjJII22uoMWvZWz` held
    // the same three with both. `party` and `committee` are discriminators, so
    // the poorer copy hashes to a different identity and used to land beside
    // the richer one - giving the merged page two of every candidacy, one of
    // them blank.
    const bare = {
      type: "election",
      source: "dup",
      target: "teryt1465",
      position: "Samorząd",
      start_date: "2002-01-01",
    };
    const full = {
      ...bare,
      source: "keep",
      party: "SLD",
      committee: "Koalicyjny KW Sojusz Lewicy Demokratycznej",
    };

    const edges = planEdgeMoves(
      [edgeDoc("bare", bare)],
      [edgeDoc("full", full)],
      "dup",
      "keep",
    );

    expect(edges).toEqual([
      {
        edge_id: "bare",
        type: "election",
        role: "source",
        disposition: "collapsed",
        duplicate_of: "full",
      },
    ]);
  });

  it("fills in the survivor's candidacy from a fuller one arriving", async () => {
    // The same fact the other way round, which the survivor rule makes
    // possible: the page that knows more about the person is not always the
    // page that knows more about a given candidacy.
    const bare = {
      type: "election",
      source: "keep",
      target: "teryt1465",
      position: "Samorząd",
      start_date: "2002-01-01",
    };
    const full = {
      ...bare,
      source: "dup",
      party: "SLD",
      committee: "Koalicyjny KW Sojusz Lewicy Demokratycznej",
    };

    const edges = planEdgeMoves(
      [edgeDoc("full", full)],
      [edgeDoc("bare", bare)],
      "dup",
      "keep",
    );

    expect(edges[0]?.disposition).toBe("enriched");
    expect(edges[0]?.duplicate_of).toBe("bare");
    expect(edges[0]?.enriches_into).toMatchObject({
      party: "SLD",
      committee: "Koalicyjny KW Sojusz Lewicy Demokratycznej",
      start_date: "2002-01-01",
    });
  });

  it("does not fold two of the duplicate's candidacies onto one of the survivor's", async () => {
    // Two bare candidacies against one full one are still two facts. Claiming
    // the survivor's copy one for one is what stops the second being silently
    // absorbed by the first.
    const bare = {
      type: "election",
      source: "dup",
      target: "teryt1465",
      position: "Samorząd",
      start_date: "2002-01-01",
    };
    const full = {
      ...bare,
      source: "keep",
      party: "SLD",
      committee: "KW SLD",
    };

    const edges = planEdgeMoves(
      [edgeDoc("bare1", bare), edgeDoc("bare2", bare)],
      [edgeDoc("full", full)],
      "dup",
      "keep",
    );

    expect(edges.map((e) => e.disposition)).toEqual(["collapsed", "moved"]);
  });

  it("leaves a candidacy that contradicts the survivor's alone", async () => {
    // A Sejm bid is not a better-informed Samorząd one, however much else lines
    // up, so it moves across as its own fact.
    const sejm = {
      type: "election",
      source: "dup",
      target: "teryt1465",
      position: "Sejm",
      start_date: "2002-01-01",
    };
    const samorzad = {
      type: "election",
      source: "keep",
      target: "teryt1465",
      position: "Samorząd",
      start_date: "2002-01-01",
      party: "SLD",
    };

    const edges = planEdgeMoves(
      [edgeDoc("sejm", sejm)],
      [edgeDoc("samorzad", samorzad)],
      "dup",
      "keep",
    );

    expect(edges[0]?.disposition).toBe("moved");
  });
});

describe("countDispositions", () => {
  it("counts every verdict, including the ones nothing reached", async () => {
    const edges: MergeEdgePlan[] = [
      { edge_id: "a", type: "employed", role: "source", disposition: "moved" },
      { edge_id: "b", type: "employed", role: "target", disposition: "moved" },
      {
        edge_id: "c",
        type: "employed",
        role: "source",
        disposition: "collapsed",
      },
    ];

    expect(countDispositions(edges)).toEqual({
      moved: 2,
      collapsed: 1,
      enriched: 0,
      review: 0,
      self: 0,
    });
  });
});

/** A snapshot as `mergeRefusal` reads one. */
function nodeSnap(data: Record<string, unknown> | undefined) {
  return data === undefined
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ exists: false, data: () => undefined } as any)
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ exists: true, data: () => data } as any);
}

describe("mergeRefusal", () => {
  const person = nodeSnap({ type: "person", name: "X" });

  it("allows two pages of one kind", async () => {
    expect(
      mergeRefusal(
        { duplicate_id: "a", survivor_id: "b" },
        person,
        nodeSnap({ type: "person", name: "Y" }),
      ),
    ).toBeUndefined();
  });

  it("refuses merging a page with itself", async () => {
    // Reachable without a typo: the survivor is resolved through its own
    // merges first, so naming a page that was merged into the duplicate lands
    // here.
    expect(
      mergeRefusal({ duplicate_id: "a", survivor_id: "a" }, person, person),
    ).toMatch(/nią samą/);
  });

  it("refuses an id that names no page", async () => {
    expect(
      mergeRefusal(
        { duplicate_id: "a", survivor_id: "b" },
        nodeSnap(undefined),
        person,
      ),
    ).toContain("a");
    expect(
      mergeRefusal(
        { duplicate_id: "a", survivor_id: "b" },
        person,
        nodeSnap(undefined),
      ),
    ).toContain("b");
  });

  it("refuses to fold a person into a company", async () => {
    // The types decide what a page means; a merge across them would put a
    // person's employments on a company's page as its own.
    const refusal = mergeRefusal(
      { duplicate_id: "a", survivor_id: "b" },
      person,
      nodeSnap({ type: "company" }),
    );

    expect(refusal).toContain("person");
    expect(refusal).toContain("company");
  });

  it("refuses a duplicate that has already been merged away", async () => {
    // Its relations are on the survivor now, so a second merge would move
    // nothing and leave a chain nothing follows.
    expect(
      mergeRefusal(
        { duplicate_id: "a", survivor_id: "b" },
        nodeSnap({ type: "person", merged_into: "c" }),
        person,
      ),
    ).toContain("c");
  });
});

describe("carriedFields", () => {
  it("unions the parties rather than keeping the survivor's half", () => {
    // The case that made this necessary. "Paweł Jerzy Obermeyer" was created in
    // June with one party; "Paweł Obermeyer" got the August upload with three.
    // Whichever survives, the page should end up with all of them.
    expect(
      carriedFields(
        { parties: ["PSL"], type: "person" },
        { parties: ["PSL", "Polska 2050", "SLD"], type: "person" },
      ),
    ).toEqual({});

    expect(
      carriedFields(
        { parties: ["PSL", "Polska 2050", "SLD"], type: "person" },
        { parties: ["PSL"], type: "person" },
      ),
    ).toEqual({ parties: ["PSL", "Polska 2050", "SLD"] });
  });

  it("reads a party list stored as a numbered-key map", () => {
    // Nodes written through `sanitizeFirestoreData` before 2026-07-28 hold
    // `{"0": "PiS"}` where an array belongs, and `array-contains` matches
    // nothing against a map without raising - so a plain spread would silently
    // drop the parties this exists to save.
    expect(
      carriedFields(
        { parties: { 0: "PiS", 1: "PSL" }, type: "person" },
        { parties: ["PiS"], type: "person" },
      ),
    ).toEqual({ parties: ["PSL", "PiS"].sort() });
  });

  it("puts „Inne” after the named parties it carries", () => {
    // Chips are drawn in stored order; by name alone the grey one would lead.
    expect(
      carriedFields(
        { parties: ["PiS"], type: "person" },
        { parties: ["Inne"], type: "person" },
      ),
    ).toEqual({ parties: ["PiS", "Inne"] });
  });

  it("fills in a field the survivor has nothing for", () => {
    expect(
      carriedFields(
        {
          wikipedia: "https://pl.wikipedia.org/wiki/X",
          birthDate: "1965-04-01",
        },
        { birthDate: "1965-04-01" },
      ),
    ).toEqual({ wikipedia: "https://pl.wikipedia.org/wiki/X" });
  });

  it("never overwrites something the survivor already says", () => {
    // A merge is not the place to overrule whoever entered the stored value.
    expect(
      carriedFields(
        { content: "z duplikatu", wikipedia: "https://example.test/dup" },
        { content: "z ocalałej", wikipedia: "https://example.test/keep" },
      ),
    ).toEqual({});
  });

  it("does not carry the name, which would undo the choice of survivor", () => {
    expect(
      carriedFields(
        { name: "Andrzej Marcin Golimont" },
        { name: "Andrzej Golimont" },
      ),
    ).toEqual({});
  });

  it("does not carry the bookkeeping a page owns", () => {
    expect(
      carriedFields(
        {
          published: true,
          revision_id: "r1",
          stats: { notesCount: 3 },
          votes: { interesting: 5 },
          deleted: true,
          nameChunksLower: ["a"],
        },
        {},
      ),
    ).toEqual({});
  });
});

describe("votesToMove", () => {
  it("re-files a human vote the survivor has none of", () => {
    expect(
      votesToMove([{ id: "dup_alice", user: "alice" }], [], "keep"),
    ).toEqual([{ from_id: "dup_alice", to_id: "keep_alice", user: "alice" }]);
  });

  it("leaves a model's vote for the next scoring run to recreate", () => {
    // Six models account for 535 of the 565 votes on the 171 duplicate pages,
    // and every one of them is rewritten on the next run. Carrying them would
    // put a stale score on the survivor and briefly make `stats.votes.models`
    // read as two models' worth of one.
    expect(
      votesToMove(
        [
          { id: "dup_pipeline-pagerank", user: "pipeline-pagerank" },
          { id: "dup_pipeline", user: "pipeline" },
        ],
        [],
        "keep",
      ),
    ).toEqual([]);
  });

  it("does not move a vote by somebody who already voted on the survivor", () => {
    // The document id is `${nodeId}_${userUid}`, so the two would collide. The
    // vote on the page that survives is the one about the page a reader sees.
    expect(
      votesToMove(
        [{ id: "dup_alice", user: "alice" }],
        [{ user: "alice" }],
        "keep",
      ),
    ).toEqual([]);
  });

  it("moves the others when only one voter has voted twice", () => {
    expect(
      votesToMove(
        [
          { id: "dup_alice", user: "alice" },
          { id: "dup_bob", user: "bob" },
        ],
        [{ user: "alice" }],
        "keep",
      ).map((v) => v.user),
    ).toEqual(["bob"]);
  });
});
