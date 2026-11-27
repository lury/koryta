import { getUser, requireDatascience } from "~~/server/utils/auth";
import { toArticleCapture } from "~~/server/utils/captures";
import { readDoc } from "~~/server/db/graph";

/** One capture, which is what the extension popup and `/zrodla` poll while the
 * extractor is working. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  requireDatascience(await getUser(event));

  const data = await readDoc("article_pages", id);
  if (!data) {
    throw createError({ statusCode: 404, message: "Nie ma takiej strony." });
  }

  return { capture: toArticleCapture(id, data) };
});
