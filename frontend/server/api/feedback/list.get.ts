import { z } from "zod";
import { defineEventHandler, getValidatedQuery } from "h3";
import { getUser } from "~~/server/utils/auth";
import { OPEN_CAP } from "~~/shared/feedbackQueue";
import { listFeedbackPg } from "~~/server/db/feedback";

const queryValidator = z.object({
  /** How many settled reports to return, newest first. Open ones are always
   * returned in full - see below. */
  limit: z.coerce.number().int().min(1).max(200).default(100),
  /** One report to return whatever its age, for a link that points straight
   * at it (Slack's "Otwórz w panelu" lands on `#fb-<id>`). */
  include: z
    .string()
    .regex(/^[^/]{1,200}$/)
    .optional()
    .catch(undefined),
});

/** Admin-only listing of feedback: this route is the only way in.
 *
 * Every open report comes back, however old: the page orders them into the
 * team's work queue, and a queue with its oldest entries cut off by a limit
 * would quietly lose them. Settled reports are history, so only the newest
 * `limit` of those. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  const { open, settled, included } = await listFeedbackPg({
    openCap: OPEN_CAP,
    limit: query.limit,
    include: query.include,
  });
  const feedback = [...open.slice(0, OPEN_CAP), ...settled];
  if (included && !feedback.some((report) => report.id === included.id)) {
    feedback.push(included);
  }
  return { feedback, openTruncated: open.length > OPEN_CAP };
});
