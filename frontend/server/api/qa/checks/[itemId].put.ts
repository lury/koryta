import { defineEventHandler, getRouterParam, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import {
  assertQaItem,
  putQaCheck,
  qaCheckBody,
} from "~~/server/utils/qaChecks";

/** The reader's own verdict on one changelog entry, at `<itemId>_<uid>`.
 * There is no delete: a reported problem goes away only by somebody saying
 * it works now. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const itemId = decodeURIComponent(getRouterParam(event, "itemId") ?? "");
  assertQaItem(itemId);
  const body = await readValidatedBody(event, (b) => qaCheckBody.parse(b));
  return {
    check: await putQaCheck(itemId, user.uid, body),
  };
});
