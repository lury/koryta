/**
 * Loads the files `npm run seed:large -- --out <dir>` writes - one
 * `<collection>.jsonl.zst` (or `.jsonl`) per collection, each line
 * `{"id", ...document}` - into Postgres, then recomputes the derived stats.
 * Dev, the demo and the benchmarks run on the same deterministic data as the
 * emulator, recounted the way /api/stats/computeNodes recounts them.
 *
 *   DATABASE_URL=... npx tsx scripts/pg/load-seed.ts --dir <dir> [--wipe]
 */
import postgres from "postgres";
import { connectOptions } from "../../server/db/client";
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createZstdDecompress } from "node:zlib";
import { collectionTables, type Collection } from "../../server/db/collections";
import { TableLoader, topIssues } from "../../server/db/load";
import { migrate } from "../../server/db/migrate";
import { recountBatch } from "../../server/db/batch";
import { emptyReport } from "../../server/db/normalize";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

export async function* readJsonl(
  path: string,
): AsyncGenerator<Record<string, unknown>> {
  const file = createReadStream(path);
  const input = path.endsWith(".zst")
    ? file.pipe(createZstdDecompress())
    : file;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (line.trim()) yield JSON.parse(line);
  }
}

/** `<collection>.jsonl.zst` or `.jsonl` under `dir`, whichever is there. */
function collectionFile(dir: string, collection: string): string | undefined {
  for (const name of [`${collection}.jsonl.zst`, `${collection}.jsonl`]) {
    if (existsSync(join(dir, name))) return join(dir, name);
  }
  return undefined;
}

async function main() {
  const dir = arg("dir");
  const url = process.env.DATABASE_URL;
  if (!dir || !url) {
    console.error("usage: DATABASE_URL=... load-seed.ts --dir <dir> [--wipe]");
    process.exit(1);
  }
  const sql = postgres(url, {
    ...connectOptions(),
    max: 2,
    onnotice: () => {},
  });
  try {
    await migrate(sql);
    const present = readdirSync(dir);
    const collections = (Object.keys(collectionTables) as Collection[]).filter(
      (c) => collectionFile(dir, c),
    );
    const unknown = present.filter(
      (f) =>
        /\.jsonl(\.zst)?$/.test(f) &&
        !collections.some((c) => f.startsWith(`${c}.jsonl`)),
    );
    if (unknown.length) console.warn("no table for:", unknown.join(", "));
    if (process.argv.includes("--wipe")) {
      for (const c of Object.keys(collectionTables) as Collection[]) {
        await sql`TRUNCATE ${sql(collectionTables[c])}`;
      }
    }
    const normalizeReport = emptyReport();
    for (const collection of collections) {
      const started = performance.now();
      const loader = new TableLoader(
        sql,
        collection,
        collectionTables[collection],
        normalizeReport,
      );
      for await (const row of readJsonl(collectionFile(dir, collection)!)) {
        // A seed line is `{id, ...document}`; an export line
        // (export-jsonl.ts) `{id, data}`, which keeps a stored `id` field.
        const exported =
          Object.keys(row).length === 2 &&
          typeof row.data === "object" &&
          row.data !== null;
        await loader.add(
          String(row.id),
          exported ? (row.data as Record<string, unknown>) : row,
        );
      }
      await loader.flush();
      const { issues, invalidExamples: _, ...counts } = loader.report;
      console.log(
        collection,
        counts,
        `${((performance.now() - started) / 1000).toFixed(1)} s`,
      );
      for (const [issue, n] of topIssues(issues, 5))
        console.log("  ", n, issue);
    }
    console.log("fixes:", normalizeReport.fixes);
    // Planned with the statistics autovacuum took halfway through the load,
    // the recount's search lines ran past ten minutes on x1; 0.2 s after this.
    const analyzed = performance.now();
    await sql`ANALYZE`;
    console.log(
      `analyze: ${((performance.now() - analyzed) / 1000).toFixed(1)} s`,
    );
    // The views and the batch fields (queueTier, revisions, nodeGroupSize,
    // searchLine), which a seed carries none of.
    const batch = await recountBatch(sql);
    console.log("recount:", JSON.stringify(batch));
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
