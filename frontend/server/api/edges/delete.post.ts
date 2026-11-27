import { requireAdmin } from "~~/server/utils/auth";
import { withoutInternalFields } from "~~/server/utils/revisions";
import { editorialTx, readDoc, recordAuditPg } from "~~/server/db/editorial";
import { createRevisionPg } from "~~/server/db/revisionWrites";
import { removePromotedEdge } from "~~/server/db/edgeWrites";
import { z } from "zod";

const bodyValidator = z.object({
  edge_id: z.string().min(1),
  reason: z.string().trim().min(1, "Powód usunięcia jest wymagany"),
});

export type EdgeDeleted = {
  edge_id: string;
  deleted: true;
  /** The removal revision written for it, or null when the edge was already
   * gone and nothing new was recorded. */
  revision_id: string | null;
};

/** Takes one relation off the graph, on an administrator's own authority.
 *
 * The reviewed route - propose, queue, approve - is the right one for a claim
 * somebody disagrees with. This is for a relation that is not a claim at all:
 * two people merged into one node bring their employers with them, and the
 * relations that came off the wrong half assert something nobody ever said.
 * Making an admin file a proposal against themselves to clear one adds a queue
 * entry and a second click, and the verdict was never in doubt.
 *
 * A soft delete, like every other removal here: `deleted: true` rather than a
 * document that stops existing. `pageIsPublic` already reads the flag, so the
 * relation leaves the public graph on the next read, and the revision written
 * alongside keeps who removed it and why - which is the whole record of a
 * merge going wrong, and the only thing left to read if it has to be undone.
 */
export default defineEventHandler(async (event): Promise<EdgeDeleted> => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const user = await requireAdmin(event);
  const result = await editorialTx(async (tx, log) => {
    const data = await readDoc(tx, "edges", body.edge_id, true);
    if (!data) {
      throw createError({
        statusCode: 404,
        message: `Nie ma powiązania o id: ${body.edge_id}`,
      });
    }
    // Idempotent rather than a 409: two admins clearing the same bad merge
    // both mean the relation is gone.
    if (data.deleted === true) return null;

    // `deleted` and `delete_reason` are fields the document owns, so they are
    // withheld from `stored` for this revision to be the one that states them.

    const { deleted: _wasDeleted, delete_reason: _oldReason, ...stored } = data;
    const { revisionId } = await createRevisionPg(
      tx,
      log,
      user,
      { collection: "edges", id: body.edge_id },
      {
        ...withoutInternalFields(data),
        deleted: true,
        delete_reason: body.reason,
      },
      { stored, approve: true, published: false },
    );
    await recordAuditPg(tx, {
      action: "delete",
      collection: "edges",
      target_id: body.edge_id,
      revision_id: revisionId,
      user: user.uid,
      reason: body.reason,
    });
    // The facts this relation was promoted from no longer say it exists.
    await removePromotedEdge(tx, log, body.edge_id);
    return revisionId;
  });
  if (result === null) {
    return { edge_id: body.edge_id, deleted: true, revision_id: null };
  }

  // The entity and graph endpoints are cached per handler for six hours.
  await useStorage("cache").clear("nitro:handlers");

  return { edge_id: body.edge_id, deleted: true, revision_id: result };
});
