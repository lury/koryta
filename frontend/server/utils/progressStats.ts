/** The tagging-progress counters of `/api/stats/progress`, counted in one
 * aggregate by `progressFromDb` (server/db/stats.ts): every person exactly
 * one of approved, reviewed and toCheck. */

export type ProgressStats = {
  /** People matching the structural filters, regardless of status. */
  total: number;
  /** Published (approved) people. */
  approved: number;
  /** Not published yet, but already looked at: voted on or annotated.
   *
   * Deliberately not "or has a revision waiting for approval". Every person
   * the scrapers ingest arrives as an unapproved revision, so
   * `revisions.has_unapproved` is set on all 5190 unpublished people and on
   * none of the published ones - counting it would restate `toCheck` under a
   * second name. Only 30 of those 5190 have a hand-written latest revision,
   * and telling them apart costs a read of every one of the revisions. If
   * that number is ever wanted, /api/admin/summary already computes it as
   * `unapprovedManual`. */
  reviewed: number;
  /** Not published and untouched by the community. */
  toCheck: number;
  /** People at least one human voted on. */
  withVotes: number;
  /** People with at least one note. */
  withNotes: number;
};

export const zeroProgress: ProgressStats = {
  total: 0,
  approved: 0,
  reviewed: 0,
  toCheck: 0,
  withVotes: 0,
  withNotes: 0,
};
