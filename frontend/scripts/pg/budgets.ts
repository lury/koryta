/** The budgets of tests/perf/budgets.json and the check scripts/pg/bench-api.ts
 * runs against them. */

export type Timing = {
  step: number;
  name: string;
  as: string;
  method: string;
  status: number;
  bytes: number;
  cold: number;
  /** Median of the warm runs; for a write, its one run. */
  warm: number;
  max: number;
  /** Shared blocks touched, cold and warm (median); with BENCH_DATABASE_URL. */
  coldBlocks?: number;
  warmBlocks?: number;
};

/** A step's budget (tests/perf/budgets.json): the most it may take. */
export type Budget = {
  /** Median of the warm runs, ms; for a write, its one run. */
  warmMs?: number;
  /** The first request after a restart, ms. */
  coldMs?: number;
  /** The answer, bytes. */
  bytes?: number;
  /** Shared blocks the request's statements touched, warm (median). */
  blocks?: number;
};
export type Budgets = {
  /** What each GET may take when its step names no budget. */
  reads: Budget;
  /** What each write may take, the same. */
  writes: Budget;
  /** By step name, or by `name@role` for one role. */
  steps: Record<string, Budget & { why?: string }>;
};

/** The steps over their budget, one line each. */
export function overBudget(timings: Timing[], budgets: Budgets): string[] {
  const out: string[] = [];
  for (const t of timings) {
    const budget: Budget = {
      ...(t.method === "GET" ? budgets.reads : budgets.writes),
      ...budgets.steps[t.name],
      ...budgets.steps[`${t.name}@${t.as}`],
    };
    const checks: [string, number | undefined, number | undefined][] = [
      ["warm ms", t.warm, budget.warmMs],
      ["cold ms", t.cold, budget.coldMs],
      ["bytes", t.bytes, budget.bytes],
      ["blocks", t.warmBlocks, budget.blocks],
    ];
    for (const [what, value, limit] of checks) {
      if (value !== undefined && limit !== undefined && value > limit)
        out.push(
          `${String(t.step).padStart(3)} ${t.name}@${t.as}: ${what} ${Math.round(value)} > ${limit}`,
        );
    }
  }
  return out;
}
