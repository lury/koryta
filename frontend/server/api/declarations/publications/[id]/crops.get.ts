import { holdRequest } from "~~/server/utils/declarationDecisionRequest";
import { waitsForAdmin } from "~~/server/utils/declarationDecisions";
import { reviewRow } from "~~/server/utils/declarationOverview";
import { peopleByIdPg } from "~~/server/db/declarationOverview";
import { readingsOfAnotherDayPg } from "~~/server/db/declarationPublish";
import { readDoc } from "~~/server/db/editorial";
import { useDb } from "~~/server/db/client";
import type { HeldCropRow } from "~~/shared/declarations";

/**
 * The crops that give a held page another birth date, as the rows of
 * /admin/oswiadczenia decide them: what `conflicting_reading` holds it for. The
 * list „Inna data niż na stronie” shows only the newest of them, and on
 * 2026-11-06 none of the 25 crops behind the 20 holds were among its 20 rows,
 * so a row asks for its own. A crop settled already - another page's
 * declaration, read with that page's date - is listed as one nobody decides
 * here (`decidable`). Admins only, checked before anything is read: the pages'
 * dates and what readers typed are read here.
 */
export default defineEventHandler(async (event): Promise<HeldCropRow[]> => {
  const { id } = await holdRequest(event);
  const born = (await readDoc(useDb(), "nodes", id))?.birthDate;
  if (typeof born !== "string" || !born) return [];
  const crops = await readingsOfAnotherDayPg(id, born.trim());
  const people = await peopleByIdPg(
    crops.flatMap((crop) =>
      Array.isArray(crop.data.personIds)
        ? (crop.data.personIds as string[])
        : [],
    ),
  );
  return crops.map((crop) => ({
    ...reviewRow(crop, people),
    decidable: waitsForAdmin(crop.data),
  }));
});
