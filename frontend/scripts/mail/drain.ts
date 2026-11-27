/**
 * Sends what waits in the `mail` outbox, until nothing is left, and exits.
 * Dry run unless MAIL_DRY_RUN=false and SMTP_HOST are set
 * (server/utils/mailOutbox.ts).
 *
 *   DATABASE_URL=... npx tsx scripts/mail/drain.ts
 */
import postgres from "postgres";
import { connectOptions } from "../../server/db/client";
import { drainOutbox, mailSettings } from "../../server/utils/mailOutbox";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, {
    ...connectOptions(),
    max: 1,
    onnotice: () => {},
  });
  const settings = mailSettings();
  const total = { sent: 0, retried: 0, failed: 0 };
  try {
    for (;;) {
      const result = await drainOutbox(sql, { settings });
      total.sent += result.sent;
      total.retried += result.retried;
      total.failed += result.failed;
      if (result.sent + result.retried + result.failed === 0) break;
    }
  } finally {
    await sql.end();
  }
  console.log(settings.dryRun ? "dry run:" : "sent:", total);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
