import { getUser } from "~~/server/utils/auth";
import { addCommentPg } from "~~/server/db/feedback";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const user = await getUser(event);

  if (!body || !body.content) {
    throw createError({
      statusCode: 400,
      message: "Missing content",
    });
  }

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

  return { id: await addCommentPg(comment), ...comment };
});
