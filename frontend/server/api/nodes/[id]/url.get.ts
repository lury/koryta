import { generateEntityUrl, mangledIdKey } from "~~/shared/slugs";
import { readPagesByMangledId } from "~~/server/db/nodes";

/** The address of the public page an id names, matched without regard to the
 * id's case or to punctuation trailing it - see `mangledIdKey`.
 *
 * `[seoType]/[slug].vue` asks this once an id has failed to resolve as it is,
 * and sends the reader on to the answer.
 *
 * The pages searched are the sitemap's (`inSitemap`): a mangled link should
 * lead to a page anybody may read, at the address that page is published
 * under. They are found by an index on the mangled id
 * (`readPagesByMangledId`, 0942_mangled_ids.sql); the handler read every
 * sitemap file and compared the ids in Node, 43 s at x50.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id", { decode: true });
  const key = id ? mangledIdKey(id) : "";
  if (!key) {
    throw createError({ statusCode: 400, message: "Missing id" });
  }

  const matches = await readPagesByMangledId(key);
  // Two pages whose ids differ only in case would make any answer a guess.
  if (matches.length !== 1) {
    throw createError({
      statusCode: 404,
      message: `No public page for id=${id}`,
    });
  }
  const [page] = matches;
  return { url: generateEntityUrl(page!.type, page!.id, page!.name) };
});
