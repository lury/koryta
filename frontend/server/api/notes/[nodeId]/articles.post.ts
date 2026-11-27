import { defineEventHandler, getRouterParam, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import { attachArticleIdsPg } from "~~/server/db/notes";
import { articleIdsBody, assertNoteNode } from "~~/server/utils/noteRules";

/** Points the reader's own note entries at the article nodes their urls
 * became (`attachArticleIds` in app/composables/notes.ts). The entries are
 * re-read under a lock and matched by url, so one added meanwhile stays. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const nodeId = decodeURIComponent(getRouterParam(event, "nodeId") ?? "");
  assertNoteNode(nodeId);
  const body = await readValidatedBody(event, (b) => articleIdsBody.parse(b));
  const articleIds = new Map(Object.entries(body.articleIds));
  const changed =
    articleIds.size > 0 &&
    (await attachArticleIdsPg(nodeId, user.uid, articleIds));
  return { changed };
});
