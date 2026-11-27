import postgres from "postgres";
import { migrate } from "~~/server/db/migrate";
import { closeDb } from "~~/server/db/client";
import { collectionTables } from "~~/server/db/collections";

/** A database of the test file's own, migrated from nothing, for the
 * handlers that read Postgres alone: `PG_TEST_DATABASE_URL` with `_<name>`
 * after its database name, made afresh, so that files running side by side
 * do not wipe each other's. */

export const PG_TEST_DATABASE_URL = process.env.PG_TEST_DATABASE_URL;

/** What a test hands a handler, read by the h3 mocks of the test files. */
export type TestEvent = {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** `authorization: <uid>[,claim...]`. */
  headers: Record<string, string>;
  context: Record<string, unknown>;
};

export async function openTestDatabase(name: string): Promise<postgres.Sql> {
  const url = new URL(PG_TEST_DATABASE_URL!);
  const database = `${url.pathname.slice(1)}_${name}`;
  const admin = postgres(PG_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${database}"`);
  await admin.end();
  url.pathname = `/${database}`;
  process.env.DATABASE_URL = url.toString();
  const sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
  await migrate(sql);
  return sql;
}

export async function closeTestDatabase(sql: postgres.Sql): Promise<void> {
  await sql.end();
  await closeDb();
}

type Doc = Record<string, unknown>;

/** Documents by Firestore collection name, written to their tables by
 * `sync`: a test arranges them the way it reads, then syncs before a call. */
export class Collections {
  private readonly tables = new Map<string, Record<string, Doc>>();

  table(name: keyof typeof collectionTables): Record<string, Doc> {
    if (!this.tables.has(name)) this.tables.set(name, {});
    return this.tables.get(name)!;
  }

  clear() {
    this.tables.clear();
  }

  /** Every table emptied, then filled with what is arranged now. */
  async sync(sql: postgres.Sql) {
    await sql.unsafe(`TRUNCATE ${Object.values(collectionTables).join(", ")}`);
    // In the loaders' order: a fact takes a missing `createdAt` from its
    // article (0901).
    for (const name of Object.keys(collectionTables)) {
      const docs = this.tables.get(name);
      if (!docs) continue;
      const table = collectionTables[name as keyof typeof collectionTables];
      for (const [id, data] of Object.entries(docs)) {
        await sql`INSERT INTO ${sql(table)} (id, data)
          VALUES (${id}, ${sql.json(JSON.parse(JSON.stringify(data)))})`;
      }
    }
  }
}

/** The status a handler's answer ends in: 200, or its error's. */
export async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    const e = error as { statusCode?: number; name?: string };
    return e.statusCode ?? (e.name === "ZodError" ? 400 : 500);
  }
}

/** Calls a handler as `as` (`<uid>[,claim...]`, nobody when undefined). */
export function callAs<T = unknown>(
  handler: unknown,
  as: string | undefined,
  event: Partial<TestEvent> = {},
): Promise<T> {
  return (handler as (event: TestEvent) => Promise<T>)({
    headers: as ? { authorization: as } : {},
    context: { hasUser: as !== undefined },
    ...event,
  });
}
