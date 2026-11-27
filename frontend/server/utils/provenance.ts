/** A node or an edge, as much of it as `writtenByImportOrReviewed` reads. */
export type Written = { id?: string; revision_id?: unknown };

/** Whether a document says only what an automatic import wrote or a reviewer
 * approved - the unpublished pages and relations a logged out reader may be
 * shown a glimpse of (`shared/personTeaser.ts`), given its first revision:
 * the earliest by `update_time` of those whose `node_id` is the document's id.
 *
 * Everything else in the drafts is somebody's say-so. A contributor's change
 * to an existing page or relation is only a pending revision until a reviewer
 * approves it; but proposing a new person writes the person's document at
 * once, and so does adding a relation - unreviewed claims, by anybody with an
 * account, about a named individual. Showing those to the public would let
 * anybody put anybody's name on this site.
 *
 * So a document qualifies when it has an approved revision (`revision_id`),
 * or when its first revision was written by an import - `update_automatic`,
 * which the server sets from how the write was made rather than from anything
 * in the request. A document with no revisions at all is older than the
 * question can be answered for, and does not. Many at once:
 * `importedOrReviewedPg` (server/db/provenance.ts). */
export function writtenByImportOrReviewed(
  doc: Written,
  first: { update_automatic?: unknown } | undefined,
): boolean {
  return !!doc.revision_id || first?.update_automatic === true;
}
