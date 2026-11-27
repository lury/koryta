import type { QueueTier } from "~~/shared/queueTiers";
import { queueTiersFromDb } from "~~/server/db/stats";

/** One difficulty tier, as /pomoc renders it. */
export type QueueTierStat = {
  tier: QueueTier;
  /** People filed under this tier whom nobody has checked yet - unpublished
   * and without a single vote - or null where the count could not be taken,
   * see the handler. Never 0 where the answer is unknown: the card drops the
   * number rather than printing „Do sprawdzenia: 0”, which is the one number
   * that would talk a reader out of the task. */
  toCheck: number | null;
  /** A few people already published off this tier, so a reader can see what a
   * finished page looks like before starting one. */
  examples: { id: string; name: string }[];
};

export type QueueTierStats = { tiers: QueueTierStat[] };

/** How many people nobody has checked yet are in each difficulty tier, and a
 * few published examples of each (`queueTiersFromDb`).
 *
 * `stats.queueTier` is written by the nightly recount and by the writes that
 * touch a person, so who is in which tier is as fresh as that. The cache is
 * `swr`: the first request after its five minutes are up is answered with the
 * old numbers while it refreshes.
 */
export default defineCachedEventHandler(
  async (): Promise<QueueTierStats> => ({ tiers: await queueTiersFromDb() }),
  { maxAge: 300, swr: true },
);
