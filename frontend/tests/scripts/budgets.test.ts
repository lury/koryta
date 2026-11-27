import { describe, expect, it } from "vitest";
import {
  overBudget,
  type Budgets,
  type Timing,
} from "../../scripts/pg/budgets";

const timing = (over: Partial<Timing>): Timing => ({
  step: 1,
  name: "nodes person page 1",
  as: "anon",
  method: "GET",
  status: 200,
  bytes: 1000,
  cold: 300,
  warm: 50,
  max: 300,
  warmBlocks: 100,
  ...over,
});

const budgets: Budgets = {
  reads: { warmMs: 200, coldMs: 1000, bytes: 500_000, blocks: 10_000 },
  writes: { warmMs: 1000 },
  steps: {
    "stats hospitals": { warmMs: 400, bytes: 12_000_000, why: "one document" },
    "nodes person page 1@admin": { warmMs: 100 },
  },
};

describe("overBudget", () => {
  it("passes a step within the defaults", () => {
    expect(overBudget([timing({})], budgets)).toEqual([]);
  });

  it("names every limit a read is over", () => {
    expect(
      overBudget(
        [timing({ warm: 250, cold: 1200, bytes: 600_000, warmBlocks: 20_000 })],
        budgets,
      ),
    ).toEqual([
      "  1 nodes person page 1@anon: warm ms 250 > 200",
      "  1 nodes person page 1@anon: cold ms 1200 > 1000",
      "  1 nodes person page 1@anon: bytes 600000 > 500000",
      "  1 nodes person page 1@anon: blocks 20000 > 10000",
    ]);
  });

  it("holds a write to the write defaults", () => {
    expect(
      overBudget(
        [timing({ method: "POST", name: "merge", warm: 1500, cold: 1500 })],
        budgets,
      ),
    ).toEqual(["  1 merge@anon: warm ms 1500 > 1000"]);
  });

  it("takes a step's own budget, and a role's over it", () => {
    expect(
      overBudget(
        [timing({ name: "stats hospitals", warm: 300, bytes: 11_000_000 })],
        budgets,
      ),
    ).toEqual([]);
    expect(overBudget([timing({ as: "admin", warm: 150 })], budgets)).toEqual([
      "  1 nodes person page 1@admin: warm ms 150 > 100",
    ]);
  });
});
