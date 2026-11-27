/**
 * /api/stats/computeNodes on Postgres, from the command line: refreshes the
 * derived views and writes the batch fields (server/db/batch.ts).
 *
 *   DATABASE_URL=... npx tsx scripts/pg/recount.ts [--times N]
 */
import postgres from "postgres";
import { connectOptions } from "../../server/db/client";
import { recountBatch } from "../../server/db/batch";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const i = process.argv.indexOf("--times");
const times = i === -1 ? 1 : Number(process.argv[i + 1]);
const sql = postgres(url, { ...connectOptions(), max: 2, onnotice: () => {} });
try {
  for (let run = 0; run < times; run++) {
    console.log(JSON.stringify(await recountBatch(sql)));
  }
} finally {
  await sql.end();
}
