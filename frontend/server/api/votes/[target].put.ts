import { defineEventHandler, getRouterParam, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import { putOwnVotePg } from "~~/server/db/votes";
import {
  assertHumanVoter,
  assertVoteTarget,
  voteBody,
} from "~~/server/utils/voteRules";

/** The signed-in reader's vote on one node or extraction, merged category by
 * category into what they voted before (the rules: server/utils/voteRules.ts).
 * Answers the vote as stored. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const targetId = decodeURIComponent(getRouterParam(event, "target") ?? "");
  assertVoteTarget(targetId);
  assertHumanVoter(user.uid);
  const body = await readValidatedBody(event, (b) => voteBody.parse(b));
  const vote = await putOwnVotePg(targetId, user.uid, body);
  return { vote };
});
