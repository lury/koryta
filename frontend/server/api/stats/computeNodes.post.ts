import { getUser } from "~~/server/utils/auth";
import { dropCachedResponses } from "~~/server/utils/cachedResponses";
import { recountBatch } from "~~/server/db/batch";
import { useDb } from "~~/server/db/client";

/** The nightly recount of every derived field (server/db/batch.ts), then the
 * cached handlers and pages that served the old ones are dropped. */
export default defineEventHandler(async (event) => {
  // Reads every node, edge, note, vote and revision and writes back to every
  // node, so an open one is both a way to run up the bill and a way to
  // overwrite the counters the whole site is filtered and ordered by. An admin,
  // or the datascience group: a recount writes no more than its imports
  // already do, and the night's robot runs one after its uploads (decision on
  // 2026-11-18).
  const user = await getUser(event);
  if (user.admin !== true && user.datascience !== true) {
    throw createError({
      statusCode: 403,
      message:
        "Ta operacja jest dostępna tylko dla administratorów i grupy datascience.",
    });
  }

  const report = await recountBatch(useDb());
  await dropCachedResponses("nitro:handlers", "nitro:routes");
  return {
    status: "success",
    computedNodes: report.nodes,
    computedRegions: report.regions,
    report,
  };
});
