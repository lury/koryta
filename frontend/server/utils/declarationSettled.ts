import type { H3Event } from "h3";
import { pagesTouched } from "~~/shared/declarationPeople";
import { publishLimitOf } from "~~/shared/declarations";
import { restageDeclarationPeoplePg } from "../db/declarationPeopleCount";
import { matchAndDrainPg } from "../db/declarationPublish";

/**
 * What follows when a reader's request settles crops on a full date, be it
 * their answer (`/api/declarations/<id>/answer`) or the answers their account
 * claimed (`/api/declarations/claim`): the crops meet their pages, and the
 * publication queue is taken up under the configured limit (`matchAndDrain`),
 * `maxPages` pages of it at most, as the reader is waiting. The people it
 * moved move in the people count too.
 *
 * Never at the reader's expense: the answers are stored and the crops settled
 * whatever happens here, and the sweep the job calls after every upload
 * compares a crop this did not.
 */
export async function compareSettled(
  event: H3Event,
  extractIds: readonly string[],
  maxPages: number,
): Promise<void> {
  if (extractIds.length === 0) return;
  let touched: string[] = [];
  try {
    const { matched, drain } = await matchAndDrainPg(
      extractIds,
      new Date(),
      publishLimitOf(useRuntimeConfig(event)),
      { maxPages },
    );
    touched = pagesTouched({ matched, drain });
    if (drain.published.length > 0) {
      await useStorage("cache").clear("nitro:handlers");
    }
  } catch (error) {
    console.error(
      `[declarations] comparing ${extractIds.join(", ")} failed`,
      error,
    );
  }
  await restageDeclarationPeoplePg(touched);
}
