import {
  activityKinds,
  emptyActivityCounts,
  totalActivity,
  type ActivityCounts,
  type ActivityKind,
} from "~~/shared/activity";
import {
  aggregateActivity,
  type ActivityAggregate,
  type ActivityEvent,
} from "~~/server/utils/activityStats";

/** One finished UTC day of activity, counted once and kept.
 *
 * The activity section used to answer every request by scanning every source
 * collection across the whole window - up to 20,000 documents per collection,
 * per window length, re-read every time the five-minute cache lapsed. Almost
 * all of that is settled history: what happened on the 3rd cannot change on the
 * 12th, so it is counted on the 4th and read back as a single document from
 * then on. A 90-day window is 89 document reads plus one scan of today.
 *
 * The exception is worth stating, because it is the one way a stored day can
 * drift from a live count. Votes and notes are edited in place and carry only
 * the time of the *last* edit, so re-voting on a person you rated last week
 * moves that event onto today - and the stored rollup for last week still
 * counts it where it was. The same document then shows up on both days. The
 * live scan this replaces had the opposite bug (the older day silently lost the
 * event), and neither is fixable without recording an event per write rather
 * than reading it off the mutable document. Revisions and audit entries are
 * append-only and never drift.
 */
export type DailyRollup = {
  /** `YYYY-MM-DD`, UTC. Also the document id. */
  date: string;
  totals: ActivityCounts;
  /** Per contributor, for the day. Pipeline and migration uids are already
   * filtered out by `aggregateActivity`, so nothing in here is a robot. */
  contributors: Record<
    string,
    { counts: ActivityCounts; lastActiveAt: string }
  >;
  /** Kinds whose scan hit its cap on this day, so the day is a lower bound. */
  truncated: ActivityKind[];
  /** People the declarations' automation published on its own that day,
   * counted apart from `totals` and from every contributor. */
  automatic: number;
};

/** Bumped whenever the rule for what counts as activity changes.
 *
 * A stored day was counted under the rule that was current when it was written,
 * so a change of rule has to invalidate it - otherwise the ingest revisions
 * this version stopped counting would stay in every day already on disk, and
 * the fix would only apply going forward. A day whose document carries a
 * different version is recomputed and overwritten.
 *
 * 1: excludes automatic revisions and article-node bookkeeping.
 * 2: excludes the `migration:*` scripts as well as the pipeline.
 * 3: four kinds instead of seven — the two vote kinds merged, comments and
 *    non-publication admin decisions dropped. A day stored under 2 holds its
 *    counts under names this version no longer reads, so it would come back as
 *    a day on which nobody voted.
 * 4: what the declarations' automation publishes on its own is counted, apart
 *    (`automatic`). A day stored under 3 dropped it with the other robots.
 * 5: readings on /oswiadczenia (`reading`). A day stored under 4 never read
 *    `declarationAnswers`, so it would come back as a day nobody read a crop.
 */
export const ROLLUP_VERSION = 5;

/** How long a day is left alone after it ends before its count is written down.
 *
 * A day is settled when nothing can still land in it, and "midnight has passed"
 * is not quite that. Votes are stamped in the browser
 * (`app/composables/votes.ts` writes `new Date().toISOString()`), so a machine
 * whose clock is behind writes an event dated earlier than the moment it
 * happened - and if that lands after the day it claims has been stored, it is
 * lost, because the stored day is never counted again.
 *
 * Six hours buys tolerance of that at the cost of scanning at most one extra
 * day live. It bounds the skew that is survivable rather than eliminating it: a
 * clock a week out still writes into a day nobody will recount. Every other
 * timestamp here is written by the server and cannot drift at all.
 */
const SETTLE_HOURS = 6;

/** Split a window's days into the ones worth storing and the ones still worth
 * reading live. `live` is always the suffix, because a later day settles later,
 * and it always holds today. */
export function splitSettledDays(
  days: string[],
  now: Date,
): { settled: string[]; live: string[] } {
  const cutoff = now.getTime() - SETTLE_HOURS * 60 * 60 * 1000;
  const first = days.findIndex((day) => Date.parse(dayEndIso(day)) > cutoff);
  return first === -1
    ? { settled: days, live: [] }
    : { settled: days.slice(0, first), live: days.slice(first) };
}

export function dayStartIso(day: string): string {
  return `${day}T00:00:00.000Z`;
}

/** The instant the day ends, as an exclusive upper bound. */
export function dayEndIso(day: string): string {
  return new Date(
    Date.parse(dayStartIso(day)) + 24 * 60 * 60 * 1000,
  ).toISOString();
}

/** Roll one day's events up into the document that will stand for it.
 *
 * Goes through `aggregateActivity` rather than counting here, so a stored day
 * and a live one are produced by the same code - including which uids are
 * dropped as robots and how a note's several sources are counted.
 */
export function rollupForDay(
  date: string,
  events: ActivityEvent[],
  truncated: ActivityKind[],
): DailyRollup {
  const aggregate = aggregateActivity(events, { since: date, until: date });

  return {
    date,
    totals: aggregate.totals,
    contributors: Object.fromEntries(
      aggregate.contributors.map((c) => [
        c.uid,
        { counts: c.counts, lastActiveAt: c.lastActiveAt },
      ]),
    ),
    truncated: [...new Set(truncated)],
    automatic: aggregate.automatic,
  };
}

/** Assemble a window's aggregate out of the days it spans.
 *
 * Same shape `aggregateActivity` returns for a live scan, so the endpoint and
 * everything below it cannot tell which of the two it was handed. `days` is
 * what fixes the window: a day with no rollup is a zero column rather than a
 * gap, exactly as it is when the scan found nothing.
 */
export function mergeRollups(
  days: string[],
  rollups: Iterable<DailyRollup>,
): ActivityAggregate {
  const byDate = new Map<string, DailyRollup>();
  for (const rollup of rollups) byDate.set(rollup.date, rollup);

  const totals = emptyActivityCounts();
  let automatic = 0;
  const byUid = new Map<
    string,
    { uid: string; counts: ActivityCounts; total: number; lastActiveAt: string }
  >();

  const daily = days.map((date) => {
    const rollup = byDate.get(date);
    const counts = rollup ? { ...rollup.totals } : emptyActivityCounts();

    for (const kind of activityKinds) totals[kind] += counts[kind];
    automatic += rollup?.automatic ?? 0;

    for (const [uid, entry] of Object.entries(rollup?.contributors ?? {})) {
      let contributor = byUid.get(uid);
      if (!contributor) {
        contributor = {
          uid,
          counts: emptyActivityCounts(),
          total: 0,
          lastActiveAt: entry.lastActiveAt,
        };
        byUid.set(uid, contributor);
      }
      for (const kind of activityKinds) {
        contributor.counts[kind] += entry.counts[kind];
      }
      contributor.total = totalActivity(contributor.counts);
      if (entry.lastActiveAt > contributor.lastActiveAt) {
        contributor.lastActiveAt = entry.lastActiveAt;
      }
    }

    return {
      date,
      counts,
      total: totalActivity(counts),
      automatic: rollup?.automatic ?? 0,
    };
  });

  return {
    totals,
    total: totalActivity(totals),
    daily,
    // Same tie-break as a live aggregate, so two windows that hold the same
    // work rank it the same way.
    contributors: [...byUid.values()].sort(
      (a, b) => b.total - a.total || (a.uid < b.uid ? -1 : 1),
    ),
    automatic,
  };
}

/** Every kind that any day in the set reported as cut short. */
export function mergeTruncated(rollups: Iterable<DailyRollup>): ActivityKind[] {
  const kinds = new Set<ActivityKind>();
  for (const rollup of rollups)
    for (const kind of rollup.truncated) kinds.add(kind);
  return [...kinds];
}

/** The stored document, or null if it is absent or was counted under an older
 * rule. Anything unreadable is treated as absent and recomputed - a rollup is
 * derived data, so there is nothing to salvage from a malformed one. */
export function decodeRollup(
  id: string,
  data: Record<string, unknown> | undefined,
): DailyRollup | null {
  if (!data || data.version !== ROLLUP_VERSION) return null;

  // Cast to something nullable rather than to the shape this hopes for: the
  // document came off the wire, and a rollup is derived data, so anything
  // unreadable in it is recomputed rather than trusted.
  const stored = data.contributors as
    Record<string, Record<string, unknown> | undefined> | undefined;

  const contributors: DailyRollup["contributors"] = {};
  for (const [uid, entry] of Object.entries(stored ?? {})) {
    const lastActiveAt = entry?.lastActiveAt;
    if (typeof lastActiveAt !== "string") continue;
    contributors[uid] = { counts: decodeCounts(entry), lastActiveAt };
  }

  return {
    date: id,
    totals: decodeCounts(data.totals as Record<string, unknown> | undefined),
    contributors,
    truncated: Array.isArray(data.truncated)
      ? (data.truncated.filter((kind) =>
          activityKinds.includes(kind as ActivityKind),
        ) as ActivityKind[])
      : [],
    // Left out of the document at zero, as the counts are.
    automatic:
      typeof data.automatic === "number" && Number.isFinite(data.automatic)
        ? data.automatic
        : 0,
  };
}

/** Zero counts are left out of the stored document, so every read fills them
 * back in - a chart must never have to tell "zero" from "absent". */
function decodeCounts(
  source: Record<string, unknown> | undefined,
): ActivityCounts {
  const counts = emptyActivityCounts();
  for (const kind of activityKinds) {
    const value = source?.[kind];
    if (typeof value === "number" && Number.isFinite(value))
      counts[kind] = value;
  }
  return counts;
}

function encodeCounts(counts: ActivityCounts): Record<string, number> {
  return Object.fromEntries(
    activityKinds
      .filter((kind) => counts[kind] > 0)
      .map((kind) => [kind, counts[kind]]),
  );
}

/** The document a settled day is stored as (`activity_daily`), zero counts
 * left out; `decodeRollup` reads it back. */
export function encodeRollup(rollup: DailyRollup): Record<string, unknown> {
  return {
    version: ROLLUP_VERSION,
    date: rollup.date,
    computedAt: new Date().toISOString(),
    totals: encodeCounts(rollup.totals),
    truncated: rollup.truncated,
    ...(rollup.automatic > 0 ? { automatic: rollup.automatic } : {}),
    contributors: Object.fromEntries(
      Object.entries(rollup.contributors).map(([uid, entry]) => [
        uid,
        { ...encodeCounts(entry.counts), lastActiveAt: entry.lastActiveAt },
      ]),
    ),
  };
}
