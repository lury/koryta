/**
 * Times the Postgres /api/nodes list (server/db/nodes.ts) on whatever
 * DATABASE_URL holds, for the paths 03-sql-hotspots ranked hottest: the
 * median of 10 after one warm-up, per query and reader.
 *
 *   DATABASE_URL=... npx tsx scripts/pg/bench-nodes.ts [--json out.json]
 */
import { writeFileSync } from "node:fs";
import { closeDb } from "../../server/db/client";
import { listNodes, type NodeListQuery } from "../../server/db/nodes";

const queries: [string, NodeListQuery][] = [
  ["page 1", { type: "person", limit: 10 }],
  ["page 51", { type: "person", limit: 10, page: 51 }],
  ["województwo", { type: "person", teryt: "14", limit: 10 }],
  [
    "województwo by latest post",
    {
      type: "person",
      teryt: "14",
      sortBy: "latestEmploymentStart",
      sortDesc: "true",
      limit: 10,
    },
  ],
  ["sector", { type: "person", category: "szpitale", limit: 10 }],
  [
    "sector, current posts, not voted (queue)",
    {
      type: "person",
      category: "szpitale",
      currentlyEmployed: "selected",
      hideVoted: "no_votes",
      visibility: "private",
      limit: 10,
    },
  ],
  ["company seat", { type: "person", companyTeryt: "14", limit: 10 }],
  [
    "party and election",
    { type: "person", parties: "PiS", election: "local-2024", limit: 10 },
  ],
  [
    "by score",
    {
      type: "person",
      sortBy: "stats.votes.interesting",
      sortDesc: "true",
      limit: 10,
    },
  ],
  ["whole list", { type: "person", limit: 100000 }],
];

const results: Record<string, unknown>[] = [];
for (const [name, query] of queries) {
  for (const signedIn of [false, true]) {
    await listNodes(query, signedIn);
    const times: number[] = [];
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const started = performance.now();
      const list = await listNodes(query, signedIn);
      times.push(performance.now() - started);
      total = list === "empty" ? 0 : list.total;
    }
    times.sort((a, b) => a - b);
    const row = {
      name,
      reader: signedIn ? "signed in" : "anonymous",
      medianMs: Math.round(times[5]! * 10) / 10,
      total,
    };
    results.push(row);
    console.log(row);
  }
}
const out = process.argv.indexOf("--json");
if (out !== -1)
  writeFileSync(process.argv[out + 1]!, JSON.stringify(results, null, 2));
await closeDb();
