/**
 * Times the golden scenario (tests/golden/scenario.ts) against a running
 * server: every GET as the scenario's visitor, user and admin, cold (the
 * first request, run right after the app and Postgres start) and warm (the
 * median of `--runs` more, each with its own `_bench` parameter so that the
 * response cache does not answer them), then each write once, in order, and
 * a company seated in the busiest region and unseated again.
 * With BENCH_DATABASE_URL, pg_stat_statements is reset first, each request
 * is charged the shared blocks its statements read or hit (pages, ~8 kB
 * each; the server's own background queries count too), and the top
 * statements are reported at the end. With `--budgets <file>`
 * (tests/perf/budgets.json) a step over its budget fails the run.
 *
 *   BENCH_URL=http://127.0.0.1:3000 BENCH_AUTH_URL=http://127.0.0.1:9099 \
 *     [BENCH_DATABASE_URL=postgres://...] npx tsx scripts/pg/bench-api.ts \
 *     [--runs 8] [--out result.json] [--no-writes] [--budgets file.json]
 *
 * The writes change the database: run it on a copy.
 */
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import {
  scenario,
  withIds,
  type Ctx,
  type Step,
} from "../../tests/golden/scenario";
import { send, tokens as signIn } from "../golden/client";
import { overBudget, type Budgets, type Timing } from "./budgets";

const BASE = process.env.BENCH_URL ?? "http://127.0.0.1:3000";
const AUTH = process.env.BENCH_AUTH_URL ?? "http://127.0.0.1:9099";
const DB = process.env.BENCH_DATABASE_URL;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const RUNS = Number(arg("runs") ?? 8);
const OUT = arg("out");
const WRITES = !process.argv.includes("--no-writes");
const BUDGETS = arg("budgets");

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** The first index of the writes: everything before it only reads. */
const firstWrite = scenario.findIndex((s) => (s.method ?? "GET") !== "GET");

/** A company seated in the region with the most companies, and the seat
 * removed again: the two writes of a seat moved by an editor or by the
 * ingest of a changed register entry. */
function seatMove(ctx: Ctx): Step[] {
  return [
    {
      name: "seat move: biggest region",
      path: "/api/nodes",
      query: { type: "region", limit: "1000", sortBy: "name" },
      save: (b) => {
        const regions = withIds(b).filter((o) => o.type === "region");
        const big = regions.find((o) => o.teryt === "1465011") ?? regions[0];
        ctx.seatTo = big?.id as string | undefined;
      },
    },
    {
      name: "seat move: create",
      as: "admin",
      method: "POST",
      path: "/api/edges/create",
      body: () => ({ type: "seat", source: ctx.seatTo, target: ctx.c0 }),
      save: (b) => {
        ctx.seatEdge = (b as { id?: string }).id;
      },
    },
    {
      name: "seat move: delete",
      as: "admin",
      method: "POST",
      path: "/api/edges/delete",
      body: () => ({ edge_id: ctx.seatEdge, reason: "Przeniesiona siedziba" }),
    },
  ];
}

/** Waits up to two minutes for the server to answer again. */
async function serverBack(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(`${BASE}/api/me`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`${BASE} did not come back`);
}

async function main() {
  const sql = DB ? postgres(DB, { max: 1, onnotice: () => {} }) : undefined;
  if (sql) {
    // Needs `shared_preload_libraries = pg_stat_statements` on the server.
    await sql`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`;
    await sql`SELECT pg_stat_statements_reset()`;
  }
  const tokens = await signIn(AUTH);
  const ctx: Ctx = {};
  const timings: Timing[] = [];

  /** Shared blocks every statement of this database has touched so far. */
  const blocksSoFar = async () => {
    if (!sql) return 0;
    const [row] = await sql<{ b: number }[]>`
      SELECT coalesce(sum(shared_blks_hit + shared_blks_read), 0)::float8 AS b
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    return row!.b;
  };
  type Sent = Awaited<ReturnType<typeof send>> & { blocks?: number };
  /** `send`, charged the blocks its statements touched. */
  async function measured(
    step: Step,
    extra: Record<string, string> = {},
  ): Promise<Sent> {
    const before = await blocksSoFar();
    const started = performance.now();
    let sent: Sent;
    try {
      sent = await send(BASE, step, ctx, tokens, extra);
    } catch (error) {
      // The server went away mid-request (out of memory, most often): the
      // step is recorded as status 0 and the run waits for it to be back.
      console.log(`  ${step.name}: ${String(error)}`);
      sent = {
        method: step.method ?? "GET",
        path: "",
        body: undefined,
        status: 0,
        ms: performance.now() - started,
        bytes: 0,
        answer: undefined,
      };
      await serverBack();
    }
    return sql ? { ...sent, blocks: (await blocksSoFar()) - before } : sent;
  }
  function record(i: number, step: Step, first: Sent, again: Sent[]) {
    const warm = again.map((a) => a.ms);
    const blocks = again.flatMap((a) =>
      a.blocks === undefined ? [] : [a.blocks],
    );
    const t: Timing = {
      step: i,
      name: step.name,
      as: step.as ?? "anon",
      method: first.method,
      status: first.status,
      bytes: first.bytes,
      cold: first.ms,
      warm: warm.length ? median(warm) : first.ms,
      max: Math.max(first.ms, ...warm),
      ...(first.blocks === undefined
        ? {}
        : {
            coldBlocks: first.blocks,
            warmBlocks: blocks.length ? median(blocks) : first.blocks,
          }),
    };
    timings.push(t);
    console.log(
      `${String(i).padStart(3)} ${t.method.padEnd(6)} ${t.as.padEnd(5)} ${t.status} ` +
        `cold ${Math.round(t.cold)} warm ${Math.round(t.warm)} ms ${t.bytes} B` +
        (t.warmBlocks === undefined ? "" : ` ${Math.round(t.warmBlocks)} blk`) +
        `  ${t.name}`,
    );
  }
  /** `RUNS` more of a GET, its `save` left out: the first answer's ids stay. */
  async function repeat(step: Step): Promise<Sent[]> {
    const warm: Sent[] = [];
    if ((step.method ?? "GET") !== "GET") return warm;
    for (let r = 0; r < RUNS; r++) {
      warm.push(
        await measured({ ...step, save: undefined }, { _bench: String(r) }),
      );
    }
    return warm;
  }

  // Cold: every read once, in order, before any is repeated.
  const reads = scenario.slice(0, firstWrite);
  const colds: Sent[] = [];
  for (const [i, step] of reads.entries()) {
    const first = await measured(step);
    colds.push(first);
    console.log(
      `cold ${String(i).padStart(3)} ${first.status} ${Math.round(first.ms)} ms  ${step.name}@${step.as ?? "anon"}`,
    );
  }
  for (const [i, step] of reads.entries()) {
    record(i, step, colds[i]!, await repeat(step));
  }
  if (WRITES) {
    for (const [j, step] of scenario.slice(firstWrite).entries()) {
      const first = await measured(step);
      record(firstWrite + j, step, first, await repeat(step));
    }
    for (const [j, step] of seatMove(ctx).entries()) {
      record(scenario.length + j, step, await measured(step), []);
    }
  }

  let statements: Record<string, unknown>[] = [];
  if (sql) {
    statements = await sql`
      SELECT calls::int, round(total_exec_time)::int AS total_ms,
        round(mean_exec_time::numeric, 1)::float AS mean_ms,
        round(max_exec_time)::int AS max_ms, rows::bigint AS rows,
        shared_blks_hit::bigint AS hit, shared_blks_read::bigint AS read,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 300) AS query
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY total_exec_time DESC LIMIT 25`;
    console.log("\npg_stat_statements, by total time:");
    for (const s of statements) {
      console.log(
        `${String(s.total_ms).padStart(8)} ms total ${String(s.calls).padStart(5)} calls ` +
          `mean ${s.mean_ms} max ${s.max_ms}  ${s.query}`,
      );
    }
    await sql.end();
  }
  if (OUT) {
    writeFileSync(
      OUT,
      JSON.stringify({ base: BASE, runs: RUNS, timings, statements }, null, 1),
    );
  }
  if (BUDGETS) {
    const over = overBudget(
      timings,
      JSON.parse(readFileSync(BUDGETS, "utf8")) as Budgets,
    );
    console.log(
      over.length
        ? `\n${over.length} over budget:\n  ${over.join("\n  ")}`
        : "\nevery step within budget",
    );
    if (over.length) process.exitCode = 1;
  }
}

await main();
