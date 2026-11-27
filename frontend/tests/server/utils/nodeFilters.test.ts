import { describe, it, expect } from "vitest";
import { matchedTargets } from "../../../server/utils/nodeFilters";

describe("matchedTargets", () => {
  /** A person, with what each scope says they point at. */
  const somebody = (
    id: string,
    all: {
      targetNodeIds?: string[];
      currentlyEmployedTargetNodeIds?: string[];
    },
    approved = all,
  ) => ({ id, stats: { edges: { all, approved } } });

  it("gives each person the ids that let them through", () => {
    const nodes = [
      somebody("a", { targetNodeIds: ["mesko", "mpk", "teryt26"] }),
      somebody("b", { targetNodeIds: ["mpk"] }),
    ];
    expect(matchedTargets(nodes, ["mesko", "pgz"], "all")).toEqual({
      a: ["mesko"],
    });
  });

  it("reads the scope the filter read", () => {
    const nodes = [
      somebody(
        "a",
        { targetNodeIds: ["mesko", "pgz"] },
        { targetNodeIds: ["pgz"] },
      ),
    ];
    expect(matchedTargets(nodes, ["mesko", "pgz"], "approved")).toEqual({
      a: ["pgz"],
    });
  });

  it("counts only the posts held now under `selected`, as the filter does", () => {
    const nodes = [
      somebody("a", {
        targetNodeIds: ["telesystem", "mesko"],
        currentlyEmployedTargetNodeIds: ["mesko"],
      }),
    ];
    expect(
      matchedTargets(nodes, ["telesystem", "mesko"], "all", "selected"),
    ).toEqual({ a: ["mesko"] });
  });

  it("copes with a person whose stats hold no arrays", () => {
    expect(matchedTargets([{ id: "a" }], ["mesko"], "all")).toEqual({});
  });
});
