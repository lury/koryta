import { createError, defineEventHandler, getRouterParam } from "h3";
import { getUser } from "~~/server/utils/auth";
import { deleteOwnVotePg } from "~~/server/db/votes";
import { assertVoteTarget } from "~~/server/utils/voteRules";

/** Takes back the reader's own vote on a target. Nothing in the app calls it -
 * a vote taken back is written as 0 - but it is how a vote holding a value out
 * of range is repaired. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const targetId = decodeURIComponent(getRouterParam(event, "target") ?? "");
  assertVoteTarget(targetId);
  const outcome = await deleteOwnVotePg(targetId, user.uid);
  if (outcome === "missing") {
    throw createError({ statusCode: 404, message: "Nie ma takiego głosu." });
  }
  if (outcome === "forbidden") {
    throw createError({ statusCode: 403, message: "To nie jest Twój głos." });
  }
  return { ok: true };
});
