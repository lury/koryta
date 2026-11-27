import { defineEventHandler, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { readMePg, servedMe } from "~~/server/db/users";

/** The signed-in reader's own settings (`users/{uid}`), or `config: null`
 * when they never saved any. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const data = await readMePg(user.uid);
  const config = servedMe(data);
  return { config: config ? { ...config, id: user.uid } : null };
});
