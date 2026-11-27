import { defineEventHandler, getValidatedQuery } from "h3";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { pipelineScoresPg } from "~~/server/db/votes";
import { pipelineVotesBody } from "~~/server/utils/voteRules";

const queryValidator = pipelineVotesBody.pick({ model: true });

/** Node id -> the score a model last wrote, for `koryta_uploader --type
 * score` to reconcile against. The datascience group only, as the rules had
 * it for writing a model's votes. */
export default defineEventHandler(async (event) => {
  requireDatascience(await getUser(event));
  const { model } = await getValidatedQuery(event, (q) =>
    queryValidator.parse(q),
  );
  const scores = await pipelineScoresPg(model);
  return { scores };
});
