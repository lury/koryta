import { useDb } from "~~/server/db/client";
import { drainOutbox, mailSettings } from "~~/server/utils/mailOutbox";

/** How often an instance looks at the outbox. */
const POLL_MS = Number(process.env.MAIL_POLL_MS ?? 15_000);

/** Sends the `mail` outbox from every instance
 * (server/utils/mailOutbox.ts). `MAIL_WORKER=false` turns it off, e.g. where
 * a separate process drains it (`scripts/mail/drain.ts`). */
export default defineNitroPlugin((nitroApp) => {
  if (process.env.MAIL_WORKER === "false") return;
  const settings = mailSettings();
  console.info(
    `[mail] outbox worker every ${POLL_MS} ms${settings.dryRun ? ", dry run" : ""}`,
  );
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    drainOutbox(useDb(), { settings })
      .catch((error) => console.error("[mail] drain failed", error))
      .finally(() => {
        busy = false;
      });
  }, POLL_MS);
  timer.unref();
  nitroApp.hooks.hook("close", () => clearInterval(timer));
});
