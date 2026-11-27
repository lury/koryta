import type { Comment } from "~~/shared/model";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import { listCommentsPg } from "~~/server/db/feedback";

/** The comments under a page, oldest first.
 *
 * Fresh for a signed-in reader. „Dodałem testowy komentarz, ale nie jest
 * widoczny” was reported, and taken for moderation: nothing moderates a
 * comment, but `authCachedEventHandler` held this list for six hours for
 * everybody, so the author's own refresh after posting was answered from
 * before the post. The section is drawn for signed-in readers only, so they
 * are the list's whole audience, and each of their page views now costs one
 * query: a read per comment, and the one minimum read on the many pages nobody
 * has commented on. Anybody asking without `latest` is still served from the
 * six-hour cache. */
export default editorFreshCachedEventHandler(async (event) => {
  const query = getQuery(event);
  const filter =
    query.onlyLeads === "true"
      ? ({ onlyLeads: true } as const)
      : query.nodeId
        ? { nodeId: String(query.nodeId) }
        : query.edgeId
          ? { edgeId: String(query.edgeId) }
          : null;
  if (!filter) return [];
  return oldestFirst(await listCommentsPg(filter));
});

/** Sorted in memory - oldest first for conversation flow. */
function oldestFirst(comments: Comment[]): Comment[] {
  return comments.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}
