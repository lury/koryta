import { readFirstRevisions } from "./edgeLists";
import { writtenByImportOrReviewed, type Written } from "../utils/provenance";

/** Which of `docs` an import wrote first or a reviewer approved
 * (`writtenByImportOrReviewed`), with the first revisions of the rest read in
 * one query, each document once. */
export async function importedOrReviewedPg(
  docs: readonly Written[],
): Promise<Set<string>> {
  const unsettled = docs.flatMap((doc) =>
    doc.id && !doc.revision_id ? [doc.id] : [],
  );
  const firsts = await readFirstRevisions([...new Set(unsettled)]);
  const shown = new Set<string>();
  for (const doc of docs) {
    if (doc.id && writtenByImportOrReviewed(doc, firsts.get(doc.id)))
      shown.add(doc.id);
  }
  return shown;
}
