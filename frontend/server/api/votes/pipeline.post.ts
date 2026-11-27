import { defineEventHandler, readValidatedBody } from "h3";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { applyPipelineVotesPg } from "~~/server/db/votes";
import { pipelineVotesBody } from "~~/server/utils/voteRules";

/** A scoring model's scores, written and retracted in one call
 * (`isPipelineVote`): datascience only, nodes only, under a uid with
 * „pipeline” in it, at `<nodeId>_<model>`. */
export default defineEventHandler(async (event) => {
  requireDatascience(await getUser(event));
  const body = await readValidatedBody(event, (b) =>
    pipelineVotesBody.parse(b),
  );
  return applyPipelineVotesPg(body);
});
