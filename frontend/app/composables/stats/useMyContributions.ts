import { useAuthState, authRequest } from "../auth";
import { useContributionsTick } from "../votes";
import type { ContributionStats } from "~~/server/api/stats/contributions.get";

/** Counts of the current user's contributions, from /api/stats/contributions.
 *
 * Read again after every vote and note this reader saves (the tick), so the
 * counters move right after they act without a Firestore listener (decision
 * on 2026-11-26).
 */
export function useMyContributions() {
  const { user } = useAuthState();
  const tick = useContributionsTick();

  const { data: serverStats } = useAsyncData(
    "my-contributions",
    async () =>
      user.value
        ? await authRequest<ContributionStats>("/api/stats/contributions", {
            method: "GET",
          })
        : null,
    { watch: [user, tick], server: false },
  );

  return {
    user,
    votesCount: computed(() => serverStats.value?.votes ?? 0),
    notesCount: computed(() => serverStats.value?.notes ?? 0),
    revisionsCount: computed(() => serverStats.value?.revisions ?? 0),
  };
}
