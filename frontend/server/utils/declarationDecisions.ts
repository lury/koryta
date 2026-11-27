import type { ExtractStatus } from "~~/shared/declarations";
import type { StoredPublication } from "./declarationRules";

/**
 * The decisions /admin/oswiadczenia offers on a crop the readers left to an
 * admin, as the approved overview draws them (round bip-admin-r2,
 * 2026-10-29): a date, "unreadable", or taking the crop back when it is not
 * the person's.
 *
 * Only a crop on one of the overview's two lists is decided: one readers
 * could not agree on (`disputed`), and an agreed reading its page contradicts
 * (`pageMatch` `different`). Anything else was settled in the meantime - by
 * another admin, or by a reviewer who corrected the page so that the sweep
 * matched it - and a decision made on the old state is refused rather than
 * laid over theirs.
 *
 * A date settles the crop as the admin's (`agreed.by` "admin") and is
 * compared with its pages afresh, but the automation publishes nobody on it:
 * a draft born that day is held for somebody to publish by hand
 * (`admin_decision` in server/db/declarationPublish.ts), and a public page born that
 * day is left as it is, since the admin chose the date with the pages' dates
 * a click away. A page born on another day is flagged as for any reading. The
 * other two take the crop out of the comparison: an unreadable or withdrawn
 * crop matches no page and holds none (`agreedDay` in server/db/declarationPublish.ts
 * reads only an agreed one), and leaves the "different" list. A note the
 * comparison filed on a page stays: it is that page's to resolve. Who decided
 * what, and what it replaced, stays on the crop.
 *
 * A public page whose record lists the crop shows its declaration only while
 * the crop is agreed on the page's date (`confirmedDeclarations`, an admin's
 * date included since the decision on 2026-11-18), so any of the three can
 * change what the page shows, which `linkedOnAPage` tells the endpoints, so
 * they drop the pages' cached answers.
 *
 * The decisions on a held page are here too: saying it will not be published,
 * taking that back, and what a publication by hand does to a hold. Asking a
 * hold again is a publication, and lives with them in server/db/declarationPublish.ts
 * (`recheckPublication`).
 */

/** The name overview.get.ts caches the overview's counts under, for two
 * minutes on each instance; the lists an admin decides on are read on every
 * request. Nitro keeps a cached function under `nitro:functions:<name>` in
 * the `cache` storage. The endpoints' `clear` of it removes nothing (unstorage
 * clears only mounts below the base, and the entry sits on the root mount):
 * after a decision only the counts can be up to two minutes old. */
export const OVERVIEW_CACHE = "declarationOverview";
export const OVERVIEW_CACHE_BASE = `nitro:functions:${OVERVIEW_CACHE}`;

export type AdminDecision =
  | { verdict: "date"; value: string }
  | { verdict: "unreadable" }
  | { verdict: "withdraw" };

/** What a decision left the crop as. */
export type DecidedExtract = {
  id: string;
  status: ExtractStatus;
  /** Whether it now holds a full date to compare with its pages. */
  compare: boolean;
};

/** A crop's pictures as data URLs, the way the reading task sends them. A
 * crop the job read itself may have come without one: null then. */
export type CropImages = { date: string | null; name: string | null };

/** Whether a crop is on one of the overview's lists that ask an admin. */
export function waitsForAdmin(
  data: Record<string, unknown> | undefined,
): boolean {
  return (
    data?.status === "disputed" ||
    (data?.status === "agreed" && data.pageMatch === "different")
  );
}

/** Whether a record is a hold an admin said will not be published. */
export function isDeclined(record: StoredPublication | undefined): boolean {
  return record?.status === "held" && !!record.declinedAt;
}
