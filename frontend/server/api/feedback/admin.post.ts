import { z } from "zod";
import { defineEventHandler, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import { OPEN_CAP } from "~~/shared/feedbackQueue";
import { triageFeedbackPg } from "~~/server/db/feedback";

const bodyValidator = z.object({
  id: z.string().min(1),
  // `undefined` leaves the field untouched, `null`/"" clears it.
  adminStatus: z
    .enum(["new", "in_progress", "resolved", "wont_fix"])
    .optional(),
  adminNote: z.string().max(2000).nullable().optional(),
  // A place in the work queue, computed by the page from the neighbours it
  // was dropped between (`shared/feedbackQueue.ts`). `null` takes the report
  // out of the queue again.
  queueRank: z.number().finite().nullable().optional(),
  // Other reports' new ranks, when the queue had no gap left where this one
  // was dropped and had to be spaced out first. Written in the same batch as
  // the move, so a reload halfway cannot leave the queue half renumbered.
  renumber: z
    .array(z.object({ id: z.string().min(1), queueRank: z.number().finite() }))
    .max(OPEN_CAP)
    .optional(),
});

/** Admin-only triage of a feedback item.
 *
 * Writes only the fields that were sent, so moving a report in the queue and
 * somebody else changing its status at the same moment both stick. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const body = await readValidatedBody(event, (b) => bodyValidator.parse(b));

  const patch: Record<string, unknown> = {};
  if (body.adminStatus !== undefined) patch.adminStatus = body.adminStatus;
  if (body.adminNote !== undefined) patch.adminNote = body.adminNote || "";
  if (typeof body.queueRank === "number") patch.queueRank = body.queueRank;
  const found = await triageFeedbackPg(
    body.id,
    patch,
    body.queueRank === null,
    body.renumber ?? [],
  );
  if (!found) {
    throw createError({ statusCode: 404, message: "Zgłoszenie nie istnieje." });
  }
  return { ok: true };
});
