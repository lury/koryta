import { z } from "zod";
import type { ProgressStats } from "~~/server/utils/progressStats";
import { progressFromDb } from "~~/server/db/stats";

const queryValidator = z.object({
  party: z.string().optional(),
  parties: z.union([z.string(), z.array(z.string())]).optional(),
  teryt: z.string().optional(),
  companyTeryt: z.string().optional(),
  krs: z.union([z.string(), z.array(z.string())]).optional(),
  place: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.string().optional(),
  currentlyEmployed: z.enum(["all", "any", "selected"]).optional(),
  minEmploymentDate: z.string().optional(),
  minVotes: z.coerce.number().optional(),
  queueTier: z.coerce.number().optional(),
  election: z.union([z.string(), z.array(z.string())]).optional(),
  electionResult: z.enum(["won", "lost"]).optional(),
});

// Re-exported because the components fetching this endpoint import the type
// from it - see app/composables/stats/useStats.ts. The definition, and the
// arithmetic behind every one of these numbers, lives in
// server/utils/progressStats.ts.
export type { ProgressStats };

/** Aggregate tagging-progress counts for the people matching the current
 * table filters. Status filters (visibility, hideVoted) are deliberately not
 * accepted: the response breaks people down by exactly those statuses.
 *
 * The response does not depend on the requesting user, so it is cached
 * briefly and shared.
 */
export default defineCachedEventHandler(
  async (event): Promise<ProgressStats> => {
    const query = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );
    // Every filter in one aggregate (server/db/stats.ts).
    return progressFromDb(query);
  },
  { maxAge: 300, swr: true },
);
