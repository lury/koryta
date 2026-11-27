import { z } from "zod";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getOptionalUser } from "~~/server/utils/auth";
import { notesOnNodePg } from "~~/server/db/notes";
import { assertNoteNode } from "~~/server/utils/noteRules";

const queryValidator = z.object({ nodeId: z.string().min(1) });

/** The notes on one page: for a signed-in reader all of them, for anybody
 * else only on a page that is not a person. `useNotes` reads it again after
 * a save. */
export default defineEventHandler(async (event) => {
  const { nodeId } = await getValidatedQuery(event, (q) =>
    queryValidator.parse(q),
  );
  assertNoteNode(nodeId);
  const user = await getOptionalUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const notes = await notesOnNodePg(nodeId, !!user);
  return { notes };
});
