import { useDb } from "~~/server/db/client";

const HOUR_MS = 60 * 60_000;

/** Deletes what is past its `expireAt`, as Firestore's TTL did
 * (`expire_documents()` in 0403_d_ops.sql), hourly. Every
 * instance runs it; the deletes are idempotent. */
export default defineNitroPlugin((nitroApp) => {
  const timer = setInterval(() => {
    useDb()`SELECT expire_documents()`.catch((error: unknown) =>
      console.error("[expire] expire_documents failed", error),
    );
  }, HOUR_MS);
  timer.unref();
  nitroApp.hooks.hook("close", () => clearInterval(timer));
});
