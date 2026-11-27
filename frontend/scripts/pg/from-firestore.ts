/**
 * Copies Firestore into Postgres, idempotently, and reports what it did.
 *
 *   # the emulator, e.g. with production's export (npm run emulators:prod-data)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 DATABASE_URL=... \
 *     npx tsx scripts/pg/from-firestore.ts --project koryta-pl
 *   # a real project, with application default credentials
 *   DATABASE_URL=... npx tsx scripts/pg/from-firestore.ts --project koryta-pl --ops
 *
 * --ops       also `agent-tasks` (schema ops)
 * --prune     delete rows whose document is gone from Firestore
 * --only a,b  just these collections
 * --report f  write the full report (with every nulled date) as JSON
 *
 * Exit code 0 when every collection's Firestore count, documents read and
 * Postgres rows agree and a re-read sample matches; 2 otherwise.
 */
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { connectOptions } from "../../server/db/client";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { migrate } from "../../server/db/migrate";
import { migrateFromFirestore } from "./fromFirestore";
import { topIssues } from "../../server/db/load";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const projectId = arg("project") ?? process.env.GCLOUD_PROJECT ?? "koryta-pl";
const app = initializeApp({ projectId });
const sql = postgres(url, { ...connectOptions(), max: 2, onnotice: () => {} });

try {
  await migrate(sql);
  const report = await migrateFromFirestore(
    sql,
    getFirestore(app, "koryta-pl"),
    {
      ops: flag("ops") ? getFirestore(app, "agent-tasks") : undefined,
      prune: flag("prune"),
      only: arg("only")?.split(","),
      log: (line) => console.log(line),
    },
  );
  for (const [name, c] of Object.entries(report.collections)) {
    for (const [issue, n] of topIssues(c.issues, 5))
      console.log(`  ${name}: ${n} × ${issue}`);
  }
  console.log("fixes:", report.normalize.fixes);
  console.log("not copied:", report.dropped);
  console.log(
    `${report.ok ? "OK" : "MISMATCH"} in ${report.seconds.toFixed(0)} s`,
  );
  const out = arg("report");
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 2;
} finally {
  await sql.end();
}
