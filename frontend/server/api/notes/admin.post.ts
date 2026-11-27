import { defineEventHandler, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import { triageNotePg } from "~~/server/db/notes";
import { triageBody } from "~~/server/utils/noteRules";

/** Admin-only triage of an individual note source: a reader writes only
 * their own notes, so an admin annotates somebody else's here, after the
 * admin claim is checked. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const body = await readValidatedBody(event, (b) => triageBody.parse(b));
  await triageNotePg(body);

  return { ok: true };
});
