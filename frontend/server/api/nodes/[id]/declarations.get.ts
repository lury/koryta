import { getRouterParam } from "h3";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { personDeclarationsPg } from "~~/server/db/declarationPages";
import type { PersonDeclarations } from "~~/shared/declarations";

/** The asset declarations a published person's page links, and whether the
 * site published the page itself because of one.
 *
 * Only public facts: the declaration's address on BIP, its year, the unit and
 * office. Never the crops, never what readers typed.
 *
 * Only a declaration whose crop still confirms the page's birth date is
 * listed (`confirmedDeclarations`): the record keeps what matched when it was
 * written, and since then the page's date may have been corrected, or an
 * admin may have withdrawn the crop or settled it on another day. A page left
 * with none says nothing, the line about its automatic publication included,
 * since that line rests on the match.
 *
 * A 404, never an empty answer, for a page that is not public or has nothing
 * to show. Nitro does not cache a 404, so the note appears the moment a page
 * goes live; an empty 200 would be cached for six hours and outlive the
 * publication it is about.
 */
export default authCachedEventHandler(
  async (event): Promise<PersonDeclarations> => {
    const id = getRouterParam(event, "id");
    if (!id) throw createError({ statusCode: 400, message: "Missing id" });
    const found = await personDeclarationsPg(id);
    if (!found) {
      throw createError({ statusCode: 404, message: `No declarations ${id}` });
    }
    return found;
  },
);
