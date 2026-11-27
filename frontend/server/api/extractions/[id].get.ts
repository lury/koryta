import { readerAwareCachedEventHandler } from "~~/server/utils/handlers";
import { toExtractionFact } from "~~/server/utils/extractions";
import { readExtractionPg } from "~~/server/db/extractions";

/** One fact by id, whatever its review state.
 *
 * The list endpoint serves a filtered page — the review flow asks it for
 * unreviewed facts only — so a shared `?fact=<id>` link needs a way to reach
 * past that filter. Without it, linking a card would stop working the moment
 * anybody reviewed it, which is most of the cards worth sharing.
 *
 * Signed in only, unlike the list, which answers a logged out caller with a
 * count. There is no count of one, and the sole caller — the `?fact=` link on
 * /ekstrakcje/kategoryzacja — sits behind the `auth` middleware already, so
 * the fact that an id is guessable is the whole of the exposure. */
export default readerAwareCachedEventHandler(
  async (event) => {
    if (event.context.hasUser !== true) {
      throw createError({
        statusCode: 401,
        message: "Zaloguj się, aby zobaczyć wydobyte fakty.",
      });
    }

    const id = getRouterParam(event, "id");
    if (!id) {
      throw createError({ statusCode: 400, message: "Missing extraction id" });
    }

    const row = await readExtractionPg(id);
    if (!row) {
      throw createError({
        statusCode: 404,
        message: `Extraction not found for id=${id}`,
      });
    }

    return { fact: toExtractionFact(row.id, row.data) };
  },
  { maxAge: 60 },
);
