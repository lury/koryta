/**
 * The rules of a settled reading meeting its pages, without a store: what a
 * publication record becomes (`nextPublication`), what holds a page, which
 * candidacies go up with it, and the limits of a pass. The reads and writes
 * that apply them are server/db/declarationPublish.ts.
 *
 * Once readers agree on the birth date a crop shows (`recordAnswer`), or the
 * job's own reading settles it at upload (`machineSettles`: a typed date read
 * with high confidence, or an OCR date that is already a page's birth date),
 * the reading meets the pages for the first time - nothing on the BIP side
 * ever carries a date the site knows. Each page the crop's candidacies name
 * is one of:
 *
 * - without a birth date: recorded, nothing else. The pipeline's join proposes
 *   one from the register where the two agree; that is a reviewer's call.
 * - born on another day: flagged with a note on the page. Nothing is detached
 *   or changed - which of the two is wrong is for a person to say.
 * - born that day and public already: the declaration is linked on it.
 * - born that day and a draft: queued, and published by the site itself, a
 *   few a Warsaw day, with its KRS jobs and the candidacies the declaration
 *   was filed for. Two pages born that day are both held: one of them is the
 *   person, and the reading cannot say which.
 *
 * A date an admin settled on /admin/oswiadczenia meets the pages the same
 * way, but a draft born that day is held (`admin_decision`) and a public one
 * is left as it is: the admin chose the date with the pages' dates a click
 * away, so it confirms nothing.
 *
 * Publishing re-reads everything and holds the page rather than overrule
 * anybody. The daily limit lives in the runtime config and is 0 until it is
 * set; an admin can publish the queue past it from /admin/oswiadczenia.
 * Nothing is published while a people import may be writing pages, and a
 * page a stale write of one took off the site again is put back.
 */
import type { AuditEntry } from "~~/shared/audit";
import { warsawHour } from "~~/shared/dates";
import {
  DECLARATION_ACTOR,
  PEOPLE_IMPORT_WINDOW,
  type PageMatch,
  type PageOutcome,
  type PublicationEdgeHold,
  type PublicationHoldReason,
  type PublicationStatus,
} from "~~/shared/declarations";
import { registerEntry } from "~~/shared/identifiers";
import type { Edge, Revision } from "~~/shared/model";
import { pageIsPublic } from "~~/shared/model";
import { normalizeUpdateTime } from "~~/shared/revisions";
import { isAutomatedUid } from "~~/shared/stats";
import { placeClashes } from "~~/shared/twoPlaces";
import {
  birthDateOf,
  unitOf,
  withDeclaration,
  type LinkedDeclaration,
} from "./declarationMatch";
import { unnamedLocal } from "./edges";

type Data = Record<string, unknown>;

/** How long a page may stay `publishing` before the next pass takes it up
 * again. Publishing one takes seconds; longer means the pass that claimed it
 * died with it. */
export const STUCK_PUBLISHING_MS = 15 * 60_000;

/** Pages one pass over the queue takes up at most, so the request that runs
 * it stays a request. The next pass carries on. */
export const DRAIN_BATCH = 25;

/** Settled crops one sweep compares with their pages, of each kind. */
export const SWEEP_BATCH = 50;

/** How far back a sweep looks for pages this automation published that are
 * drafts again. The import's stale write lands seconds after the publication
 * it undoes, so a few days is plenty, and the sweep runs after every upload. */
export const REVERT_WINDOW_DAYS = 3;

/** What `declarationPublications/<page id>` holds. Never a date: the page has
 * its own, and the reading is on the crop. */
export type StoredPublication = {
  personId: string;
  status: PublicationStatus;
  reason: PublicationHoldReason | null;
  /** The settled crops whose date the page has. */
  extractIds: string[];
  declarations: LinkedDeclaration[];
  queuedAt?: string;
  /** When a pass took the page up, and the Warsaw day of the slot it took.
   * No day where an admin's press took it up: a press takes no slot. */
  claimedAt?: string;
  day?: string;
  heldAt?: string;
  publishedAt?: string;
  /** Whether the site published the page on its own: false where an admin
   * pressed for it. */
  autoPublished?: boolean;
  /** The uid of the admin whose press of „Opublikuj z kolejki” took the page
   * up last (`drainPublications`); none where the automation did. */
  pressedBy?: string;
  /** The import's revision approved on the way up, where the page had none. */
  approvedRevision?: string | null;
  edges?: {
    published: string[];
    held: { id: string; reason: PublicationEdgeHold }[];
  };
  /** When a sweep found the page a draft again after this automation had put
   * it up, and nobody on record had taken it down. */
  revertedAt?: string;
  /** Who said the page will not be published, and when (`declinePublication`).
   * Gone again once it is put back. */
  declinedBy?: string;
  declinedAt?: string;
  /** The hold a publication by hand closed (`closeHoldOnPublication`): who
   * published the page, when, and what it was held for. */
  handPublished?: {
    uid: string;
    at: string;
    held: PublicationHoldReason | null;
  };
  createdAt?: string;
  updatedAt?: string;
};

/** What `matchPages` concluded about one crop. */
export type MatchResult = {
  extractId: string;
  /** Null when the crop is not a settled full date, which compares with
   * nothing. */
  pageMatch: PageMatch | null;
  outcomes: Record<string, PageOutcome>;
  /** Whether anything was written. */
  changed: boolean;
};

/** What `publishPage` did. `confirmed` is a page somebody else made public
 * while it waited: nothing was published, and the day's slot is not used. */
export type PublishOutcome =
  | {
      status: "published";
      approvedRevision: string | null;
      edges: NonNullable<StoredPublication["edges"]>;
    }
  | { status: "held"; reason: PublicationHoldReason }
  | { status: "confirmed" };

/** Whether `now` falls in `PEOPLE_IMPORT_WINDOW`. */
export function inPeopleImportWindow(now: Date): boolean {
  const hour = warsawHour(now);
  return hour >= PEOPLE_IMPORT_WINDOW.from && hour < PEOPLE_IMPORT_WINDOW.to;
}

/** Whether a typed date says the person was born on another day than the
 * page's stored `YYYY-MM-DD`: a year alone is compared with the year, and a
 * page without a date contradicts nothing. */
export function contradicts(typed: string, stored: string): boolean {
  if (!stored) return false;
  const length = Math.min(typed.length, stored.length);
  return typed.slice(0, length) !== stored.slice(0, length);
}

/** Whether the crop's date is one an admin settled (`decideExtract`), rather
 * than one readers agreed on without seeing the page's or the job read off a
 * typed form at upload. */
export function settledByAdmin(extract: Data | undefined): boolean {
  return (
    (extract?.agreed as { by?: unknown } | null | undefined)?.by === "admin"
  );
}

/** The note's text: plain words, the declaration named well enough to find
 * the line in it. */
export function anotherDateNote(extract: Data): string {
  const { unit, office } = unitOf(extract);
  const where = [
    unit,
    office,
    typeof extract.declarationYear === "number"
      ? `za ${extract.declarationYear} r.`
      : null,
    typeof extract.page === "number"
      ? `strona ${extract.page + 1} pliku`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    "Automatyczne porównanie z oświadczeniem majątkowym: data urodzenia " +
    `odczytana z oświadczenia (${where}) nie zgadza się z datą zapisaną na ` +
    "tej stronie. Nic nie zostało zmienione ani odpięte. Do sprawdzenia, czy " +
    "to ta sama osoba i która data jest właściwa."
  );
}

/** Where a page's record goes once one more crop has the page's date, as the
 * fields to merge into it, or null when nothing changes.
 *
 * Published and publishing stay what they are: the page is up, or going up.
 * A hold outlasts a later match - it is a doubt nobody has settled - unless
 * the page has become public since, which settles it, and takes an admin's
 * no along. An admin's no (`declinedAt`) outlasts every other match, with the
 * reason it was held for: another crop with the page's date is no answer to
 * it, nor is a reading that would take over an admin's-date hold. Two pages
 * with the crop's date hold the page whatever it was waiting for; on a page
 * being
 * published that is left as the reason for the pass that holds its slot,
 * which holds the page and gives the slot back (`publishPage`): taking the
 * status from under it here would strand the slot.
 *
 * An admin's date only ever holds a page: one no record names yet, or one an
 * admin's date holds already. It joins no other record, where it would be
 * linked on the page and read as a match when the page is published. A
 * reading nobody chose takes a page only an admin's date held over as if it
 * were new, without the admin's crops: that hold stood for no doubt, only for
 * the lack of such a reading.
 */
export function nextPublication(
  existing: StoredPublication | undefined,
  pageId: string,
  args: {
    outcome: "queued" | "held" | "confirmed";
    byAdmin: boolean;
    extractId: string;
    declaration: LinkedDeclaration;
    now: Date;
  },
  /** How the instant and a removed field are written. */
  values: { at: (now: Date) => unknown; removed: () => unknown },
): Data | null {
  const declined = existing?.status === "held" && !!existing.declinedAt;
  const adminHold =
    existing?.status === "held" &&
    existing.reason === "admin_decision" &&
    !declined;
  if (args.byAdmin && existing && !adminHold) return null;
  const before = adminHold && !args.byAdmin ? undefined : existing;
  const was = before?.status;
  const status: PublicationStatus =
    was === "published" || was === "publishing"
      ? was
      : args.outcome === "queued" && was === "held"
        ? "held"
        : args.outcome;
  const reason: PublicationHoldReason | null =
    status === "held"
      ? (before?.reason ?? (args.byAdmin ? "admin_decision" : "two_pages"))
      : status === "publishing" &&
          (args.outcome === "held" || before?.reason === "two_pages")
        ? "two_pages"
        : null;
  const knownIds = before?.extractIds ?? [];
  const known = before?.declarations ?? [];
  const extractIds = unique([...knownIds, args.extractId]);
  const declarations = withDeclaration(known, args.declaration);

  if (
    before &&
    was === status &&
    (before.reason ?? null) === reason &&
    extractIds.length === knownIds.length &&
    declarations.length === known.length
  ) {
    return null;
  }

  const at = values.at(args.now);
  return {
    personId: pageId,
    status,
    reason,
    extractIds,
    declarations,
    updatedAt: at,
    ...(existing ? {} : { createdAt: at }),
    // When the page first waited: the queue is first come, first served by
    // it, and the admin list of held pages is ordered by it, so a page held
    // the moment it matched - two pages with one date - is stamped too.
    ...((status === "queued" || status === "held") && !before?.queuedAt
      ? { queuedAt: at }
      : {}),
    ...(status === "held" && was !== "held" ? { heldAt: at } : {}),
    // A page that went public answers the admin's no as well.
    ...(declined && status !== "held"
      ? { declinedAt: values.removed(), declinedBy: values.removed() }
      : {}),
  };
}

export function sameOutcomes(
  stored: unknown,
  outcomes: Record<string, PageOutcome>,
): boolean {
  if (!stored || typeof stored !== "object") return false;
  const before = stored as Record<string, unknown>;
  const keys = Object.keys(outcomes);
  return (
    Object.keys(before).length === keys.length &&
    keys.every((key) => before[key] === outcomes[key])
  );
}

export function held(reason: PublicationHoldReason): PublishOutcome {
  return { status: "held", reason };
}

/** Whether the last decision on record about who may see the page is this
 * automation publishing it. */
export function lastPublishedHere(audit: readonly AuditEntry[]): boolean {
  const last = audit
    .filter((row) => row.action === "publish" || row.action === "unpublish")
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .at(-1);
  return last?.action === "publish" && last.user === DECLARATION_ACTOR;
}

/** Whether the page's birth date came with the register entry its jobs are
 * listed under, so that a declaration confirming the date says something
 * about whose jobs they are.
 *
 * The jobs on a page are its register entry's: the import never sends a page
 * another entry's payload (`refuseAnotherEntry`). The date need not be that
 * entry's. The import never rewrites a stored one, so a page that linked its
 * entry before a person typed a date, or got its date from somewhere else
 * first, can store somebody else's: seven pages of the 10-10 export reached
 * through their own entry did, four of them a namesake's. A councillor whose
 * declaration matches that date is the date's owner, and the entry's board
 * seats would go up under the councillor's name.
 *
 * So the oldest revision that carries the date must have been written by the
 * import, not a person, and link the entry the page links now - or none, on a
 * page with none, whose jobs came from payloads the import matched to it by
 * name and that very date. 5,960 of the 6,017 dated drafts of 2026-10-29
 * qualify.
 */
export function dateCameWithEntry(
  page: Data,
  revisions: readonly StoredRevision[],
): boolean {
  const born = birthDateOf(page);
  const first = revisions
    .filter((revision) => {
      const data = revision.data as Data | undefined;
      return (
        revision.status !== "rejected" &&
        data?.deleted !== true &&
        birthDateOf(data) === born
      );
    })
    .sort(oldestFirst)[0];
  if (!first || writtenByPerson(first)) return false;
  return (
    registerEntry((first.data as Data).rejestrIo) ===
    registerEntry(page.rejestrIo)
  );
}

export type Unit = {
  teryt: string;
  level?: string;
  office: string;
  year: number;
};

/** The units the crops were filed for, each once. */
export function unitsOf(extracts: readonly Data[]): Unit[] {
  const units = new Map<string, Unit>();
  for (const extract of extracts) {
    for (const unit of Array.isArray(extract.units) ? extract.units : []) {
      if (typeof unit?.teryt !== "string" || !unit.office || !unit.year) {
        continue;
      }
      units.set(`${unit.teryt}|${unit.office}|${unit.year}`, unit as Unit);
    }
  }
  return [...units.values()];
}

/** The region node a unit's candidacies point at. The election edges are
 * filed under the powiat (a gmina's or a city's) or the województwo (the
 * sejmik), never under the gmina itself. */
export function regionOf(unit: Unit): string {
  const digits = unit.level === "wojewodztwo" ? 2 : 4;
  return `teryt${unit.teryt.slice(0, digits)}`;
}

/** The ids among these nodes whose page is public. */
export function publicAmong(nodes: ReadonlyMap<string, Data>): Set<string> {
  const found = new Set<string>();
  for (const [id, data] of nodes) {
    if (pageIsPublic(data)) found.add(id);
  }
  return found;
}

export type StoredEdge = { id: string; data: Edge };

/** The page's candidacies the declaration was filed for: for each unit, the
 * one election edge of its year in its region, for its office or a bare local
 * one („Samorząd”, or none in a year of local elections only). A by-election
 * is a contest of its own and never one of them. Two edges for one election
 * leave the automation unable to say which is the declaration's. */
export function chooseCandidacies(
  elections: readonly StoredEdge[],
  units: readonly Unit[],
  publicRegions: ReadonlySet<string>,
):
  | { chosen: StoredEdge[] }
  | { reason: "no_candidacy_on_page" | "ambiguous_candidacy" } {
  const chosen = new Map<string, StoredEdge>();
  const byElection = new Map<string, Set<string>>();
  for (const unit of units) {
    const region = regionOf(unit);
    const matches = elections.filter(
      ({ data }) =>
        data.by_election !== true &&
        String(data.start_date ?? "").slice(0, 4) === String(unit.year) &&
        data.target === region &&
        (data.position === unit.office || unnamedLocal(data)),
    );
    if (matches.length > 1) return { reason: "ambiguous_candidacy" };
    // A relation cannot go up while one of its ends is a draft.
    if (!publicRegions.has(region)) continue;
    const election = `${unit.year}|${unit.office}`;
    for (const match of matches) {
      chosen.set(match.id, match);
      byElection.set(
        election,
        (byElection.get(election) ?? new Set()).add(match.id),
      );
    }
  }
  if ([...byElection.values()].some((ids) => ids.size > 1)) {
    return { reason: "ambiguous_candidacy" };
  }
  if (chosen.size === 0) return { reason: "no_candidacy_on_page" };
  return { chosen: [...chosen.values()] };
}

/** Whether a revision is a person's word: written by hand, by somebody who is
 * not a pipeline or a migration. The old uploader wrote under a person's uid
 * with `update_automatic` set, and the merge migrations without it. */
export function writtenByPerson(revision: Revision): boolean {
  return (
    revision.update_automatic !== true && !isAutomatedUid(revision.update_user)
  );
}

/** The ids of the candidacies among `rows` that put the person in two places
 * in one election - grouped by the election, the way the night counts them,
 * so a European run beside a local one in 2024 is two contests. Grouped by
 * `placeClashes`, as the publish dialog and the person page group them. */
export function clashingCandidacies(
  pageId: string,
  rows: readonly StoredEdge[],
): Set<string> {
  const clashes = placeClashes(rows, ({ data }) => ({
    personId: pageId,
    regionId: data.target,
    startDate: data.start_date,
    position: data.position,
    byElection: data.by_election,
  }));
  return new Set(clashes.flatMap((clash) => clash.rows.map((row) => row.id)));
}

/** The pages a comparison that wrote something reached: their people's
 * other crops have a new place in the readers' queue (`requeueCrops`). */
export function pagesNewlyReached(matched: readonly MatchResult[]): string[] {
  return unique(
    matched
      .filter((match) => match.changed)
      .flatMap((match) => Object.keys(match.outcomes)),
  );
}

export function millisOf(value: unknown): number {
  if (
    value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
}

function oldestFirst(a: StoredRevision, b: StoredRevision): number {
  const timeA = normalizeUpdateTime(a.update_time) ?? "";
  const timeB = normalizeUpdateTime(b.update_time) ?? "";
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;
  return a.id.localeCompare(b.id);
}

type StoredRevision = Revision & { id: string };
