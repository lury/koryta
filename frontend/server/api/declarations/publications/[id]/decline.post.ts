import { holdRequest } from "~~/server/utils/declarationDecisionRequest";
import { declinePublicationPg } from "~~/server/db/declarationHolds";
import { restageDeclarationPeoplePg } from "~~/server/db/declarationPeopleCount";

/**
 * „Nie publikuj” on /admin/oswiadczenia: the person leaves the held list for
 * the people who will not be published (`declinePublication`). Admins only,
 * checked before anything is read.
 */
export default defineEventHandler(async (event): Promise<{ id: string }> => {
  const { uid, id } = await holdRequest(event);
  await declinePublicationPg(id, uid);
  await restageDeclarationPeoplePg([id]);
  return { id };
});
