import { isDeepStrictEqual } from "node:util";
import type { Firestore } from "firebase-admin/firestore";
import type { Db } from "../../server/db/client";
import {
  collectionTables,
  droppedCollections,
  opsCollectionTables,
} from "../../server/db/collections";
import { TableLoader, type TableReport } from "../../server/db/load";
import {
  emptyReport,
  normalizeDocument,
  type NormalizeReport,
} from "../../server/db/normalize";

export interface CollectionReport extends TableReport {
  table: string;
  /** `count()` in Firestore before the copy. */
  firestore: number;
  /** Rows in the table after it. */
  postgres: number;
  /** Ids in the table that Firestore no longer has; removed with `prune`. */
  stale: number;
  /** Documents re-read after the copy that do not match their row. */
  sampleMismatches: string[];
}

export interface MigrationReport {
  startedAt: string;
  seconds: number;
  collections: Record<string, CollectionReport>;
  dropped: Record<string, number>;
  normalize: NormalizeReport;
  /** Every collection's three counts agree and no sample differs. */
  ok: boolean;
}

const SAMPLE = 50;

async function copyCollection(
  sql: Db,
  db: Firestore,
  collection: string,
  table: string,
  normalize: NormalizeReport,
  prune: boolean,
): Promise<CollectionReport> {
  const ref = db.collection(collection);
  const firestore = (await ref.count().get()).data().count;
  const loader = new TableLoader(sql, collection, table, normalize);
  const seen = new Set<string>();
  for await (const doc of ref.stream() as AsyncIterable<FirebaseFirestore.QueryDocumentSnapshot>) {
    seen.add(doc.id);
    await loader.add(doc.id, doc.data());
  }
  await loader.flush();

  const stored = await sql<{ id: string }[]>`SELECT id FROM ${sql(table)}`;
  const staleIds = stored.map((r) => r.id).filter((id) => !seen.has(id));
  if (prune && staleIds.length > 0) {
    await sql`DELETE FROM ${sql(table)} WHERE id = ANY(${staleIds}::text[])`;
  }
  const [counted] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ${sql(table)}`;
  const postgres = counted?.n ?? 0;

  // Read a few documents again and compare them with their rows.
  const sampleIds = [...seen].sort(() => Math.random() - 0.5).slice(0, SAMPLE);
  const sampleMismatches: string[] = [];
  if (sampleIds.length > 0) {
    const snaps = await db.getAll(...sampleIds.map((id) => ref.doc(id)));
    const rows = await sql<{ id: string; data: unknown }[]>`
      SELECT id, data FROM ${sql(table)} WHERE id = ANY(${sampleIds}::text[])`;
    const byId = new Map(rows.map((r) => [r.id, r.data]));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const expected = normalizeDocument(
        collection,
        snap.id,
        snap.data()!,
        emptyReport(),
      );
      // A fact the store had no `createdAt` for is given one (0901).
      const row = byId.get(snap.id) as Record<string, unknown> | undefined;
      if (table === "extractions" && expected.createdAt === undefined && row)
        expected.createdAt = row.createdAt;
      if (!isDeepStrictEqual(expected, row)) sampleMismatches.push(snap.id);
    }
  }

  return {
    ...loader.report,
    table,
    firestore,
    postgres,
    stale: prune ? 0 : staleIds.length,
    sampleMismatches,
  };
}

/** Copies every collection of `koryta-pl` (and of `agent-tasks`, when given)
 * into its table, upserting, so a second run against a later export writes
 * only what changed; then refreshes the derived stats. Reads with the admin
 * SDK, from the emulator or from a project with application default
 * credentials. */
export async function migrateFromFirestore(
  sql: Db,
  main: Firestore,
  options: {
    ops?: Firestore;
    prune?: boolean;
    only?: string[];
    log?: (line: string) => void;
  } = {},
): Promise<MigrationReport> {
  const started = Date.now();
  const log = options.log ?? (() => {});
  const normalize = emptyReport();
  const collections: Record<string, CollectionReport> = {};
  const jobs: [Firestore, string, string][] = [
    ...Object.entries(collectionTables).map(
      ([c, t]) => [main, c, t] as [Firestore, string, string],
    ),
    ...(options.ops
      ? Object.entries(opsCollectionTables).map(
          ([c, t]) => [options.ops!, c, t] as [Firestore, string, string],
        )
      : []),
  ];
  for (const [db, collection, table] of jobs) {
    if (options.only && !options.only.includes(collection)) continue;
    const t0 = Date.now();
    const report = await copyCollection(
      sql,
      db,
      collection,
      table,
      normalize,
      options.prune ?? false,
    );
    collections[collection] = report;
    log(
      `${collection}: firestore ${report.firestore}, read ${report.read}, ` +
        `postgres ${report.postgres} (+${report.inserted} ~${report.updated} ` +
        `=${report.unchanged}), invalid ${report.invalid}, stale ${report.stale}, ` +
        `sample mismatches ${report.sampleMismatches.length}, ${Date.now() - t0} ms`,
    );
  }
  const dropped: Record<string, number> = {};
  for (const name of droppedCollections) {
    dropped[name] = (await main.collection(name).count().get()).data().count;
  }
  await sql`SELECT refresh_node_stats()`;
  const ok = Object.values(collections).every(
    (c) =>
      c.firestore === c.read &&
      c.read === c.postgres &&
      c.sampleMismatches.length === 0,
  );
  return {
    startedAt: new Date(started).toISOString(),
    seconds: (Date.now() - started) / 1000,
    collections,
    dropped,
    normalize,
    ok,
  };
}
