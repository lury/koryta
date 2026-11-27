/**
 * Brings the database at DATABASE_URL up to the schema in
 * server/db/migrations.
 *
 *   DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_dev npm run db:migrate
 */
import postgres from "postgres";
import { connectOptions } from "../../server/db/client";
import { migrate } from "../../server/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = postgres(url, { ...connectOptions(), max: 1, onnotice: () => {} });
try {
  const applied = await migrate(sql);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
} finally {
  await sql.end();
}
