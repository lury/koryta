import { defineEventHandler, getRouterParam, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import { putOwnNotePg } from "~~/server/db/notes";
import { assertNoteNode, noteBody } from "~~/server/utils/noteRules";

/** The signed-in reader's note on a page, at `<nodeId>_<uid>`, with dates
 * from the server's clock. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const nodeId = decodeURIComponent(getRouterParam(event, "nodeId") ?? "");
  assertNoteNode(nodeId);
  const body = await readValidatedBody(event, (b) => noteBody.parse(b));
  const note = await putOwnNotePg(nodeId, user.uid, body);
  return { note };
});
