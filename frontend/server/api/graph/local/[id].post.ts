import { defineEventHandler, readValidatedBody, getRouterParam } from "h3";
import { z } from "zod";
import { getLocalGraph } from "~~/server/utils/localGraph";
import { bodyWantsLatest } from "~~/server/utils/handlers";
import { graphDistance, graphIdList } from "~~/server/utils/localGraphRequest";

const bodyValidator = z.object({
  latest: z.unknown(),
  distance: graphDistance,
  expand: graphIdList,
  subjects: graphIdList,
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body ?? {}),
  );
  // Asked for in the body and allowed by the token. The table sent
  // `latest: true` for every reader until 2026-10-14, and this took it at its
  // word, so the flag by itself is no sign of anybody signed in.
  const latest = await bodyWantsLatest(event, body);
  const focusNodeId = getRouterParam(event, "id");

  if (!focusNodeId) {
    throw createError({ statusCode: 400, statusMessage: "id is required" });
  }

  // `subjects` and `expand` are not the same request. The table sends the
  // other nine rows of the page as `subjects` - it wants each of their
  // neighbourhoods in full - where an `expand` is one node a reader on the
  // canvas asked to see more of, drawn a ring out from whoever the page is
  // about. See `getLocalGraph`.
  return getLocalGraph(
    focusNodeId,
    latest,
    body.distance,
    body.expand,
    body.subjects,
  );
});
