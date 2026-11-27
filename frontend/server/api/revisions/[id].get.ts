import { revisionPg } from "~~/server/db/revisionQueue";
import { setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";

/** One revision, whole: what somebody proposed a page should say.
 *
 * Signed in readers only. A revision of a page nobody has published is as much
 * a draft as the page, and it carries everything the proposal does - a party
 * included - so answering anybody who asked made `?latest`'s gate a door with
 * a window beside it. The page that previews a proposal (`?revisionId=`) asks
 * for it only for a signed in reader, and never on the server, whose render is
 * always anonymous.
 */
export default defineEventHandler(async (event) => {
  await getUser(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({
      statusCode: 400,
      message: "Missing revision id",
    });
  }

  const revision = await revisionPg(id);
  if (!revision) {
    throw createError({
      statusCode: 404,
      message: "Revision not found",
    });
  }

  return revision;
});
