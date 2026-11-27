import { describe, expect, it } from "vitest";
import { touchedBy } from "~~/server/db/writeEffects";

const sets = (changes: Parameters<typeof touchedBy>[0]) => {
  const t = touchedBy(changes);
  return {
    nodes: [...t.nodes].sort(),
    wide: [...t.wide].sort(),
    ends: [...t.ends].sort(),
    changed: [...t.changed].sort(),
    docs: [...t.docs].sort(),
  };
};

describe("touchedBy", () => {
  it("widens a moved seat to the company, not to the regions", () => {
    expect(
      sets([
        {
          collection: "edges",
          id: "e1",
          before: { type: "seat", source: "regionA", target: "company" },
          after: { type: "seat", source: "regionB", target: "company" },
        },
      ]),
    ).toEqual({
      nodes: ["company", "regionA", "regionB"],
      wide: ["company"],
      ends: ["company", "regionA", "regionB"],
      changed: [],
      docs: ["company"],
    });
  });

  it("widens a new owner edge to the company it owns", () => {
    expect(
      sets([
        {
          collection: "edges",
          id: "e2",
          before: undefined,
          after: { type: "owns", source: "parent", target: "child" },
        },
      ]).wide,
    ).toEqual(["child"]);
  });

  it("widens both targets when an owner edge is pointed elsewhere", () => {
    expect(
      sets([
        {
          collection: "edges",
          id: "e3",
          before: { type: "owns", source: "parent", target: "childA" },
          after: { type: "owns", source: "parent", target: "childB" },
        },
      ]).wide,
    ).toEqual(["childA", "childB"]);
  });

  it("widens nothing for a post", () => {
    expect(
      sets([
        {
          collection: "edges",
          id: "e4",
          before: undefined,
          after: { type: "employed", source: "person", target: "company" },
        },
      ]),
    ).toEqual({
      nodes: ["company", "person"],
      wide: [],
      ends: ["company", "person"],
      changed: [],
      // Neither document changed: the colleagues' lines stay as they are.
      docs: [],
    });
  });

  it("names a written node's document as changed", () => {
    expect(
      sets([
        {
          collection: "nodes",
          id: "person",
          before: { type: "person", published: true },
          after: { type: "person", published: false },
        },
      ]).docs,
    ).toEqual(["person"]);
  });

  it("widens a place whose sector changes", () => {
    expect(
      sets([
        {
          collection: "nodes",
          id: "place",
          before: { type: "place", categories: [] },
          after: { type: "place", categories: ["szpitale"] },
        },
      ]).wide,
    ).toEqual(["place"]);
  });
});
