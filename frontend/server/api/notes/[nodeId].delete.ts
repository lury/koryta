import { createError, defineEventHandler, getRouterParam } from "h3";
import { getUser } from "~~/server/utils/auth";
import { deleteOwnNotePg } from "~~/server/db/notes";
import { assertNoteNode } from "~~/server/utils/noteRules";

/** Deletes the reader's own note on a page; the author only. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const nodeId = decodeURIComponent(getRouterParam(event, "nodeId") ?? "");
  assertNoteNode(nodeId);
  const outcome = await deleteOwnNotePg(nodeId, user.uid);
  if (outcome === "missing") {
    throw createError({ statusCode: 404, message: "Nie ma takiej notatki." });
  }
  if (outcome === "forbidden") {
    throw createError({
      statusCode: 403,
      message: "To nie jest Twoja notatka.",
    });
  }
  return { ok: true };
});
