import { closeDb } from "~~/server/db/client";

/** Lets the pool's connections go when Nitro shuts down, so that an instance
 * being replaced does not leave them to time out on the database. */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("close", closeDb);
});
