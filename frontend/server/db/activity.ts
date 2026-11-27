import { useDb } from "./client";
import type { ActivityEvent } from "../utils/activityStats";
import { daysBetween, utcDay } from "../utils/activityStats";
import {
  dayEndIso,
  dayStartIso,
  decodeRollup,
  encodeRollup,
  rollupForDay,
  splitSettledDays,
  type DailyRollup,
} from "../utils/activityRollup";
import { publicProfileEnabled } from "../../shared/profile";

/** The instants a scan reads from, and up to (exclusive; open when absent). */
export type EventWindow = { sinceIso: string; untilIso?: string };

export type ActivityWindow = { since: string; until: string; days: number };

/** What counts as activity in a window, from every source: votes, notes'
 * sources, revisions proposed by hand, pages published, crops read. No scan
 * cap: a range on an indexed text field costs what it reads, so nothing is
 * ever `truncated`. Timestamps are ISO text (the migration stored the older
 * Timestamps that way too), so one bound per field. */
export async function collectActivityEventsFromDb(
  window: EventWindow,
): Promise<ActivityEvent[]> {
  const sql = useDb();
  const since = window.sinceIso;
  const until = window.untilIso ?? null;
  const within = (field: string) =>
    sql`(jsonb_text(data -> ${field}) >= ${since}
      AND (${until}::text IS NULL OR jsonb_text(data -> ${field}) < ${until}))`;

  const [votes, notes, revisions, publications, readings] = await Promise.all([
    sql<{ uid: string; at: string }[]>`
      SELECT user_uid AS uid, jsonb_text(data -> 'updatedAt') AS at FROM votes
      WHERE ${within("updatedAt")} AND user_uid IS NOT NULL`,
    sql<{ uid: string; at: string; count: number }[]>`
      SELECT user_uid AS uid,
        coalesce(jsonb_text(data -> 'updatedAt'), jsonb_text(data -> 'createdAt')) AS at,
        jsonb_array_length(data -> 'sources')::int AS count
      FROM notes
      WHERE (${within("createdAt")} OR ${within("updatedAt")})
        AND user_uid IS NOT NULL AND jsonb_typeof(data -> 'sources') = 'array'
        AND jsonb_array_length(data -> 'sources') > 0`,
    // Not the ingest's own revisions, nor an article node it opened for
    // itself (`wasNeverProposed`): no `status`, or reviewed in its own commit.
    sql<{ uid: string; at: string }[]>`
      SELECT jsonb_text(data -> 'update_user') AS uid, update_time AS at
      FROM revisions
      WHERE update_time >= ${since} AND (${until}::text IS NULL OR update_time < ${until})
        AND NOT jsonb_is_true(data -> 'update_automatic')
        AND jsonb_typeof(data -> 'update_user') = 'string'
        -- coalesce: a revision with no snapshot, or no review, is a person's.
        AND NOT coalesce(data #> '{data,type}' = '"article"'
          AND (NOT data ? 'status'
            OR coalesce(jsonb_text(data -> 'review_time') = update_time, false)), false)`,
    // One per (who, page, second), the newest of them, as the Firestore scan
    // ordered by `at` descending kept them.
    sql<{ uid: string; at: string }[]>`
      SELECT DISTINCT ON (uid, target, second) uid, at FROM (
        SELECT coalesce(nullif(jsonb_text(data -> 'pressed_by'), ''),
            jsonb_text(data -> 'user')) AS uid,
          jsonb_text(data -> 'at') AS at, id,
          coalesce(data ->> 'target_id', 'undefined') AS target,
          left(jsonb_text(data -> 'at'), 19) AS second
        FROM audit
        WHERE ${within("at")} AND data -> 'action' = '"publish"'
          AND data -> 'collection' = '"nodes"') a
      WHERE uid IS NOT NULL
      ORDER BY uid, target, second, at DESC, id DESC`,
    // Dated by the claim where an account took the reading over.
    sql<{ uid: string; at: string }[]>`
      SELECT jsonb_text(data -> 'uid') AS uid,
        coalesce(jsonb_text(data -> 'claimedAt'), jsonb_text(data -> 'at')) AS at
      FROM declaration_answers
      WHERE (${within("at")} OR ${within("claimedAt")})
        AND jsonb_typeof(data -> 'uid') = 'string' AND NOT starts_with(data ->> 'uid', 'anon:')
        AND data -> 'verdict' IS DISTINCT FROM '"skip"'`,
  ]);

  return [
    ...votes.map((e) => ({ ...e, kind: "vote" as const })),
    ...notes.map((e) => ({ ...e, kind: "noteSource" as const })),
    ...revisions.map((e) => ({ ...e, kind: "revision" as const })),
    ...publications.map((e) => ({ ...e, kind: "publication" as const })),
    ...readings
      .filter((e) => e.at)
      .map((e) => ({ ...e, kind: "reading" as const })),
  ];
}

/** The last `days` UTC days of activity, one rollup per day, ending today.
 *
 * A settled day is counted once and kept in `activity_daily`; the tail of the
 * window is read live, because a vote stamped by a slow browser clock can
 * still land in it (`splitSettledDays`). The missing settled days are read in
 * one range and stored, best effort: a failed write costs a recount next
 * time, not the page. The rollups come back unmerged, so a caller can cut a
 * shorter window out of a longer one. */
export async function loadActivityRollupsFromDb(
  days: number,
  until: Date = new Date(),
): Promise<{
  window: ActivityWindow;
  spanned: string[];
  rollups: DailyRollup[];
}> {
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);
  const window = {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    days,
  };
  const spanned = daysBetween(window.since, window.until);
  const { settled, live } = splitSettledDays(spanned, until);

  const sql = useDb();
  const stored = new Map<string, DailyRollup>();
  if (settled.length > 0) {
    const rows = await sql<{ id: string; data: Record<string, unknown> }[]>`
      SELECT id, data FROM activity_daily WHERE id = ANY(${settled}::text[])`;
    for (const row of rows) {
      const rollup = decodeRollup(row.id, row.data);
      if (rollup) stored.set(rollup.date, rollup);
    }
  }
  const missing = settled.filter((day) => !stored.has(day));
  const [past, current] = await Promise.all([
    missing.length > 0
      ? collectActivityEventsFromDb({
          sinceIso: dayStartIso(missing[0]!),
          untilIso: dayEndIso(missing[missing.length - 1]!),
        })
      : Promise.resolve([]),
    collectActivityEventsFromDb({
      sinceIso: dayStartIso(live[0] ?? window.until),
    }),
  ]);
  const byDay = new Map<string, ActivityEvent[]>(missing.map((d) => [d, []]));
  for (const event of past) {
    const day = utcDay(event.at);
    if (day) byDay.get(day)?.push(event);
  }
  const counted = missing.map((day) => rollupForDay(day, byDay.get(day)!, []));
  for (const rollup of counted) stored.set(rollup.date, rollup);
  if (counted.length > 0) {
    await sql`
      INSERT INTO activity_daily (id, data)
      SELECT r ->> 'date', r FROM jsonb_array_elements(${sql.json(counted.map(encodeRollup) as never)}) r
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`.catch(
      (error: unknown) =>
        console.error(
          `activity_daily: could not store ${missing[0]}..${missing[missing.length - 1]}`,
          error,
        ),
    );
  }

  return {
    window,
    spanned,
    rollups: [
      ...settled.map((day) => stored.get(day)!),
      ...live.map((day) => rollupForDay(day, current, [])),
    ],
  };
}

/** Who among `uids` said their name may be shown (`publicProfileEnabled`):
 * one boolean per uid asked, and nothing else of the owner-writable
 * document. */
export async function readPublicProfilesFromDb(
  uids: string[],
): Promise<Record<string, boolean>> {
  if (uids.length === 0) return {};
  const sql = useDb();
  const rows = await sql<{ id: string; flag: boolean | null }[]>`
    SELECT id, (data -> 'publicProfile')::text::boolean AS flag FROM users
    WHERE id = ANY(${uids}::text[]) AND jsonb_typeof(data -> 'publicProfile') = 'boolean'`;
  const flags = new Map(rows.map((r) => [r.id, r.flag]));
  return Object.fromEntries(
    uids.map((uid) => [uid, publicProfileEnabled(flags.get(uid) ?? undefined)]),
  );
}
