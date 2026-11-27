/**
 * The demo's one-shot start (compose.coolify.yaml, service `migrate`):
 * migrates DATABASE_URL, then, into an empty database only, loads data.
 *
 * SEED_MODE   none (default) | seed | public
 *             seed:   the synthetic seed-large database at SEED_SCALE
 *             public: the public copy of koryta.pl in SEED_PUBLIC_DIR
 *                     (nodes-*.jsonl.zst, edges.jsonl.zst), topped up with
 *                     synthetic drafts to SEED_SCALE times production's size
 * SEED_SCALE  1
 * SEED_FORCE  true to load into a database that already has nodes (upserts)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { connectOptions } from "../../server/db/client";
import { migrate } from "../../server/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const mode = process.env.SEED_MODE ?? "none";
if (!["none", "seed", "public"].includes(mode)) {
  console.error(`SEED_MODE=${mode}: expected none, seed or public`);
  process.exit(1);
}

const sql = postgres(url, { ...connectOptions(), max: 1, onnotice: () => {} });
let nodes: number;
try {
  const applied = await migrate(sql);
  console.log(
    applied.length ? `applied: ${applied.join(", ")}` : "schema up to date",
  );
  const [row] = await sql<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM nodes`;
  nodes = row?.n ?? 0;
} finally {
  await sql.end();
}

// The census /api/stats/database reads is written by the nightly recount;
// refresh it here so a fresh deployment does not show zeros until night.
async function refreshCensus(): Promise<void> {
  const db = postgres(url!, {
    ...connectOptions(),
    max: 1,
    onnotice: () => {},
  });
  try {
    await db`SELECT refresh_database_counts()`;
  } finally {
    await db.end();
  }
}

if (mode === "none") process.exit(0);
if (nodes > 0 && process.env.SEED_FORCE !== "true") {
  console.log(
    `${nodes} nodes already stored, not seeding (SEED_FORCE=true to)`,
  );
  await refreshCensus();
  process.exit(0);
}

const out = mkdtempSync(join(tmpdir(), "seed-"));
const generate = [
  "scripts/seed-large.ts",
  "--scale",
  process.env.SEED_SCALE ?? "1",
  "--out",
  out,
];
if (mode === "public") {
  // The public copy has no regions; TERYT's, with production's ids, so that
  // the teryt filters find its people.
  generate.push(
    "--base",
    process.env.SEED_PUBLIC_DIR ?? "/seed/public",
    "--regions",
    "scripts/pg/teryt-regions.jsonl",
  );
}
const run = (args: string[]) =>
  execFileSync("npx", ["tsx", ...args], { stdio: "inherit" });
run(generate);
run(["scripts/pg/load-seed.ts", "--dir", out]);
await refreshCensus();
