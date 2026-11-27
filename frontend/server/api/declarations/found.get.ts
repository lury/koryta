import { getUser } from "~~/server/utils/auth";
import { findsOfPg } from "~~/server/db/declarationReading";

/**
 * The people a signed-in reader found (`findsOf`), for
 * /oswiadczenia/znalezione. A token is required: a reader without an account
 * is shown how many in the tally, and whom once they sign in, which moves
 * what this browser found onto the account (`claimAnswers`).
 *
 * Per reader, so never cached.
 */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return findsOfPg(user.uid);
});
