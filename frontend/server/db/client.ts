import postgres from "postgres";

export type Db = postgres.Sql;

/** The one pool of this server instance, opened on first use.
 *
 * Five connections: Cloud Run gives an instance one vCPU and up to 80
 * requests at once, and one Node process works through one result at a time
 * anyway, so more connections would only queue inside Postgres instead of
 * here. Ten instances times five stay under the 100 connections of the
 * smallest Cloud SQL tier. `PG_POOL_MAX` overrides it. */
let pool: Db | undefined;

export function useDb(): Db {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set: there is no Postgres to read");
  }
  pool = postgres(url, {
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idle_timeout: 30,
    max_lifetime: 30 * 60,
    connect_timeout: 10,
    onnotice: () => {},
    connection: {
      application_name: "koryta-nitro",
      TimeZone: "UTC",
      // A plan for the values at hand every time: the generic plan Postgres
      // switches a prepared statement to after five runs cannot know that
      // `LIMIT 10` is ten, and sorted all 27,509 people for a page of them
      // (115 ms against 1 ms).
      plan_cache_mode: "force_custom_plan",
    },
  });
  return pool;
}

export async function closeDb(): Promise<void> {
  const open = pool;
  pool = undefined;
  await open?.end({ timeout: 5 });
}
