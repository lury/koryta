import { defineEventHandler, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { listQaChecks } from "~~/server/utils/qaChecks";

/** Everybody's verdicts on the QA changelog, for anybody signed in: /qa
 * shows what the others found. */
export default defineEventHandler(async (event) => {
  await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return { checks: await listQaChecks() };
});
