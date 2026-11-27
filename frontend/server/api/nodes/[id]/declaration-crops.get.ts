import { getUser } from "~~/server/utils/auth";
import {
  draftPersonPg,
  personDeclarationCropsPg,
} from "~~/server/db/declarationPages";
import type { PersonDeclarationCrops } from "~~/shared/declarations";

/**
 * The crops of a person's declarations on BIP, and where the page's
 * publication from them stands, for a signed-in reader of the page while it
 * is a draft (`PersonDraftDeclarations`); with no crop, the elections the
 * person won, the searches for their declarations and the links readers
 * gave.
 *
 * Signed-in readers only, as a draft page itself is (decision on
 * 2026-11-20), and drafts only (`draftPersonPg`). Never cached, as it changes
 * with every reading.
 */
export default defineEventHandler(
  async (event): Promise<PersonDeclarationCrops> => {
    const user = await getUser(event);
    setResponseHeader(event, "Cache-Control", "private, no-store");
    const id = getRouterParam(event, "id");
    if (!id) throw createError({ statusCode: 400, message: "Missing id" });

    const personId = await draftPersonPg(id);
    return personDeclarationCropsPg(personId, user.uid);
  },
);
