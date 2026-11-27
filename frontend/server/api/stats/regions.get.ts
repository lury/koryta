import { authCachedEventHandler } from "~~/server/utils/handlers";
import { regionStatsFromDb } from "~~/server/db/stats";

/** The home map's region rows, as the recount stores them. Read only. */
export default authCachedEventHandler(async () => regionStatsFromDb());
