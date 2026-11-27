import { requireAdmin } from "~~/server/utils/auth";
import { notifyRevisionReviewed } from "~~/server/utils/revisionNotifications";
import {
  editorialTx,
  patchDoc,
  readDoc,
  recordAuditPg,
} from "~~/server/db/editorial";
import { revisionTarget } from "~~/server/db/revisionWrites";
import { approvedRevisionId, type Revision } from "~~/shared/model";
import { z } from "zod";

const bodyValidator = z.object({
  revision_id: z.string(),
  reason: z.string().trim().min(1, "Powód odrzucenia jest wymagany"),
});

/** Turns a suggestion down, with a reason.
 *
 * The revision is kept - it is the record of what somebody proposed and why it
 * was not taken - but it stops counting as pending, so a queue of suggestions
 * can actually be worked through instead of growing forever.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );
  const user = await requireAdmin(event);

  const { revision, target } = await editorialTx(async (tx, log) => {
    const revision = (await readDoc(
      tx,
      "revisions",
      body.revision_id,
      true,
    )) as Partial<Revision> | undefined;
    if (!revision) {
      throw createError({
        statusCode: 404,
        message: `Nie ma rewizji o id=${body.revision_id}`,
      });
    }
    const target = revisionTarget({ ...revision, id: body.revision_id });

    // Rejecting the snapshot a page is currently serving would leave it saying
    // something nobody stands behind. Approve a different revision first.
    const stored = await readDoc(tx, target.collection, target.id, true);
    if (approvedRevisionId(stored?.revision_id) === body.revision_id) {
      throw createError({
        statusCode: 409,
        message:
          "Nie można odrzucić rewizji, która jest w tej chwili zatwierdzona. Zatwierdź inną wersję albo ukryj stronę.",
      });
    }

    await patchDoc(tx, log, "revisions", body.revision_id, {
      status: "rejected",
      reject_reason: body.reason,
      review_user: user.uid,
      review_time: new Date().toISOString(),
    });
    await recordAuditPg(tx, {
      action: "reject",
      collection: target.collection,
      target_id: target.id,
      revision_id: body.revision_id,
      user: user.uid,
      reason: body.reason,
    });
    return { revision, target };
  });

  // A rejection is the one verdict the author cannot discover by looking at the
  // page, so the reason only reaches them if it is sent.
  await notifyRevisionReviewed({
    decision: "rejected",
    revisionId: body.revision_id,
    revision,
    target,
    reason: body.reason,
    reviewerUid: user.uid,
    siteUrl: useRuntimeConfig(event).public.siteUrl,
  });

  return { revision_id: body.revision_id, status: "rejected" };
});
