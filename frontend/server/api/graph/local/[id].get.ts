import { z } from "zod";
import { getLocalGraph } from "~~/server/utils/localGraph";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { graphDistance, graphIdList } from "~~/server/utils/localGraphRequest";
import { getRouterParam, getValidatedQuery, type H3Event } from "h3";

const queryValidator = z.object({
  distance: graphDistance,
  expand: graphIdList,
});

async function localGraph(event: H3Event) {
  // Clamped: the url is the reader's to type. See `MAX_GRAPH_DISTANCE`.
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );
  const focusNodeId = getRouterParam(event, "id");

  if (!focusNodeId) {
    throw createError({ statusCode: 400, statusMessage: "id is required" });
  }

  return getLocalGraph(
    focusNodeId,
    await wantsLatest(event),
    query.distance,
    query.expand,
  );
}

// A signed in reader is the one who may have just added the edge they are
// looking for, and the cache holds a response for six hours - long enough to
// convince somebody their relation was never written. So they read through to
// Firestore, while logged out traffic, which is nearly all of it, still gets
// the cache. This route hand-rolled that first, deciding it from `latest`
// alone, and that is how anybody with curl was drawn the drafts: the decision
// is `editorFreshCachedEventHandler`'s now, and it asks for a token.
export default editorFreshCachedEventHandler(localGraph);
