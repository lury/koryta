import { getUser } from "~~/server/utils/auth";
import { z } from "zod";
import { addCommentPg } from "~~/server/db/feedback";
import type { Comment } from "~~/shared/model";
import { optionalDocumentId } from "~~/server/utils/requestIds";

/** The longest comment taken. Nothing in the form limits it; this only keeps
 * one request from storing a novel in a row. */
const COMMENT_MAX_LENGTH = 10_000;

const bodyValidator = z.object({
  // Stored as typed; the check is only that there is something besides
  // whitespace, which is what the form checks before sending.
  content: z
    .string()
    .max(COMMENT_MAX_LENGTH)
    .refine((value) => value.trim().length > 0, "Missing content"),
  nodeId: optionalDocumentId.nullable(),
  edgeId: optionalDocumentId.nullable(),
  parentId: optionalDocumentId.nullable(),
});

export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const comment = {
    content: body.content,
    authorId: user.uid,
    authorName: user.uid,
    createdAt: new Date().toISOString(),
    isLead: !body.nodeId && !body.edgeId && !body.parentId,
    nodeId: body.nodeId || null,
    edgeId: body.edgeId || null,
    parentId: body.parentId || null,
  };

  // Stored with null for a missing target, which is what the list's lead
  // query matches; `Comment` spells the same absence as optional.
  return {
    id: await addCommentPg(comment as unknown as Omit<Comment, "id">),
    ...comment,
  };
});
