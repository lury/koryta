import { defineEventHandler, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import { patchMePg, servedMe } from "~~/server/db/users";
import { mePatch } from "~~/server/utils/meRules";

/** Saves the fields of the reader's own settings that /profil and the
 * newsletter question change, and answers the document as stored. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const patch = await readValidatedBody(event, (b) => mePatch.parse(b));
  const data = await patchMePg(user.uid, patch);
  return { config: { ...servedMe(data), id: user.uid } };
});
