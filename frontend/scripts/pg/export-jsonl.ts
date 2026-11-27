/**
 * The nightly export, from Postgres: what `scheduledFirestoreExport`
 * (functions/src/index.ts) writes to gs://koryta-pl-crawled/hostname=koryta.pl,
 * as one `<collection>.jsonl.zst` per collection, each line
 * `{"id": <document id>, "data": <document>}`, and `export.json` written last,
 * as Firestore writes its `.overall_export_metadata` last. The pipelines read
 * it with KORYTA_EXPORT (data/pipelines `scrapers/koryta/pg_export.py`), and
 * `load-seed.ts --dir` loads it back.
 *
 *   DATABASE_URL=... npx tsx scripts/pg/export-jsonl.ts --out <dir> [--all]
 *
 * Writes `<dir>/date=<ISO timestamp>/`, and prints that directory. `--all`
 * takes every table rather than the collections the Firestore export names.
 */
import postgres from "postgres";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createZstdCompress } from "node:zlib";
import { collectionTables, type Collection } from "../../server/db/collections";

/** The collections the Firestore export takes (`collectionIds`). */
export const EXPORTED: Collection[] = [
  "comments",
  "edges",
  "nodes",
  "notes",
  "revisions",
  "stats",
  "votes",
  "extractions",
  "feedback",
  "audit",
  "declarationCandidacies",
  "declarationExtracts",
  "declarationPublications",
  "declarationAnswers",
  "declarationLinks",
];

/** Rows per cursor fetch. */
const CHUNK = 2000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** One collection to `<dir>/<collection>.jsonl.zst`, in id order. The stored
 * document as the site serves it from the table, `nameChunksLower` and all:
 * the derived `stats` of a node are the batch fields the recount wrote, with
 * the views' part laid over them, as the Firestore document carried them. */
async function exportCollection(
  sql: postgres.Sql,
  collection: Collection,
  dir: string,
): Promise<number> {
  const table = sql(collectionTables[collection]);
  const doc =
    collection === "nodes"
      ? sql`CASE WHEN s.stats IS NULL THEN n.data ELSE n.data || jsonb_build_object('stats',
          CASE WHEN jsonb_typeof(n.data -> 'stats') = 'object' THEN n.data -> 'stats' ELSE '{}' END
          || s.stats) END`
      : sql`n.data`;
  const joined =
    collection === "nodes" ? sql`LEFT JOIN node_stats s ON s.id = n.id` : sql``;
  let rows = 0;
  async function* lines() {
    const cursor = sql<{ line: string }[]>`
      SELECT json_build_object('id', n.id, 'data', ${doc})::text AS line
      FROM ${table} n ${joined} ORDER BY n.id`.cursor(CHUNK);
    for await (const batch of cursor) {
      rows += batch.length;
      yield batch.map((r) => r.line).join("\n") + "\n";
    }
  }
  const out = createWriteStream(join(dir, `${collection}.jsonl.zst`));
  await pipeline(Readable.from(lines()), createZstdCompress(), out);
  return rows;
}

async function main() {
  const root = arg("out");
  const url = process.env.DATABASE_URL;
  if (!root || !url) {
    console.error(
      "usage: DATABASE_URL=... export-jsonl.ts --out <dir> [--all]",
    );
    process.exit(1);
  }
  const exportedAt = new Date().toISOString();
  const dir = join(root, `date=${exportedAt}`);
  mkdirSync(dir, { recursive: true });
  const collections = process.argv.includes("--all")
    ? (Object.keys(collectionTables) as Collection[])
    : EXPORTED;
  // One snapshot for every collection, as Firestore's export is one moment.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const counts: Record<string, number> = {};
  const started = performance.now();
  try {
    await sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
      for (const collection of collections) {
        const t = performance.now();
        counts[collection] = await exportCollection(
          tx as unknown as postgres.Sql,
          collection,
          dir,
        );
        console.error(
          `${collection}: ${counts[collection]} in ${((performance.now() - t) / 1000).toFixed(1)} s`,
        );
      }
    });
  } finally {
    await sql.end();
  }
  const manifest = {
    exportedAt,
    format: "jsonl.zst",
    line: '{"id": <document id>, "data": <document>}',
    collections: counts,
    ms: Math.round(performance.now() - started),
  };
  const done = createWriteStream(join(dir, "export.json"));
  done.end(JSON.stringify(manifest, null, 2) + "\n");
  await once(done, "finish");
  console.log(dir);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
