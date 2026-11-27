import { holdRequest } from "~~/server/utils/declarationDecisionRequest";
import { restorePublicationPg } from "~~/server/db/declarationHolds";
import { restageDeclarationPeoplePg } from "~~/server/db/declarationPeopleCount";

/**
 * „Przywróć” on /admin/oswiadczenia: takes an admin's „Nie publikuj” back, and
 * the person waits again for what they were held for (`restorePublication`).
 * Admins only, checked before anything is read.
 */
export default defineEventHandler(async (event): Promise<{ id: string }> => {
  const { id } = await holdRequest(event);
  await restorePublicationPg(id);
  await restageDeclarationPeoplePg([id]);
  return { id };
});
