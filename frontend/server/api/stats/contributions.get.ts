import { getUser } from "~~/server/utils/auth";
import { contributionsFromDb } from "~~/server/db/stats";

export type ContributionStats = {
  votes: number;
  notes: number;
  revisions: number;
};

/** Counts of the requesting user's contributions: votes cast, notes written
 * and change proposals submitted. Used to show people how much they helped
 * with the data tagging effort. */
export default defineEventHandler(async (event): Promise<ContributionStats> => {
  const user = await getUser(event);
  return contributionsFromDb(user.uid);
});
