/**
 * What a settled reading of a BIP asset declaration does to its pages, on
 * Postgres: the comparison, the publication queue and its passes, a hold
 * asked again, a publication a stale write undid. What the rules are, and
 * why, is at the top of server/utils/declarationRules.ts, which holds the
 * parts that need no store, and on each function here. The reads and writes are
 * explicit SQL (decision on 2026-11-26), a transaction where Firestore took
 * one, and the page with its revisions, edges and audit rows goes up through
 * `editorialTx`, so the trigger effects land in the same commit.
 *
 * Unlike the Firestore code, a page goes up in one transaction: the approval
 * of its revision, „Inne” where it names no party, `published` and the audit
 * row; its relations in a second one.
 */
import { createError } from "h3";
import type { AuditEntry } from "../../shared/audit";
import { warsawDate } from "../../shared/dates";
import { pagesTouched } from "../../shared/declarationPeople";
import {
  DECLARATION_ACTOR,
  nameFitsPage,
  type DrainResult,
  type PageOutcome,
  type PageMatch,
  type PublicationEdgeHold,
  type PublicationHoldReason,
  type RecheckResult,
  type SweepResult,
} from "../../shared/declarations";
import { isStalled, jobDefinition } from "../../shared/jobs";
import { CONTENT_CHANGED_AT } from "../../shared/lastmod";
import type { Edge, Note, NoteSource, Revision } from "../../shared/model";
import { approvedRevisionId, pageIsPublic } from "../../shared/model";
import { partyFloor, showsCandidacyAndPaidPost } from "../../shared/partyFloor";
import { latestPublishableRevision } from "../../shared/revisions";
import { isAutomatedUid, isPublicEmployment } from "../../shared/stats";
import {
  agreedDay,
  birthDateOf,
  declarationOf,
} from "../utils/declarationMatch";
import {
  anotherDateNote,
  asStrings,
  chooseCandidacies,
  clashingCandidacies,
  contradicts,
  dateCameWithEntry,
  DRAIN_BATCH,
  held,
  inPeopleImportWindow,
  lastPublishedHere,
  millisOf,
  nextPublication,
  pagesNewlyReached,
  publicAmong,
  regionOf,
  REVERT_WINDOW_DAYS,
  sameOutcomes,
  settledByAdmin,
  STUCK_PUBLISHING_MS,
  SWEEP_BATCH,
  unique,
  unitsOf,
  writtenByPerson,
  type MatchResult,
  type PublishOutcome,
  type StoredEdge,
  type StoredPublication,
} from "../utils/declarationRules";
import { holdsRevision, withoutInternalFields } from "../utils/revisions";
import {
  settledEdgeRefusal,
  waitingEdgeRefusal,
} from "../utils/edgePublication";
import { PEOPLE_WRITING_JOBS, runFromDoc } from "../utils/jobs";
import { useDb } from "./client";
import { takeCount } from "./declarationReading";
import {
  editorialTx,
  patchDoc,
  readDoc,
  recordAuditPg,
  storeDoc,
} from "./editorial";
import { resolveMergedNodeDoc } from "./graph";
import { requeueQuietlyPg } from "./readingQueue";
import {
  applyRevisionPg,
  approveWaitingEdgePg,
  cascadeUnpublishEdgesPg,
  createRevisionPg,
  edgeRevisionsForManyPg,
  nodeRevisionsPg,
  publishEdgePg,
  type StoredRevision,
} from "./revisionWrites";
import { textArray } from "./textArray";
import type postgres from "postgres";

type Data = Record<string, unknown>;
type Row = { id: string; data: Data };
type Tx = postgres.TransactionSql;
type LivePage = { id: string; data: Data };
/** A pass's hold on one page: the day of the slot it took (null for a press)
 * and the `claimedAt` it wrote. */
type Claim = { day: string | null; claimedAt: string };

const actor = { uid: DECLARATION_ACTOR };

/** Crops naming one page read for a reading of another birth date. */
const READINGS_PER_PAGE = 50;

/** The field `nextPublication` removes, as it writes it here. */
const REMOVED = Symbol("removed");

/** A field map split into what is set and the keys removed. */
function asPatch(fields: Data): { set: Data; unset: string[] } {
  const set: Data = {};
  const unset: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === REMOVED) unset.push(key);
    else set[key] = value;
  }
  return { set, unset };
}

/** Sets and removes top-level fields of a publication record, inserting it
 * when there is none (Firestore's `set` with `merge`). */
async function mergePublication(
  sql: Tx | ReturnType<typeof useDb>,
  pageId: string,
  set: Data,
  unset: string[] = [],
): Promise<void> {
  await sql`
    INSERT INTO declaration_publications AS t (id, data)
    VALUES (${pageId}, ${sql.json(set as never)})
    ON CONFLICT (id) DO UPDATE
      SET data = (t.data || EXCLUDED.data) - ${textArray(unset)}::text[],
          updated_at = clock_timestamp()`;
}

/** Updates top-level fields of an existing publication record. */
async function updatePublication(
  sql: Tx | ReturnType<typeof useDb>,
  pageId: string,
  set: Data,
  unset: string[] = [],
): Promise<void> {
  await sql`
    UPDATE declaration_publications
    SET data = (data || ${sql.json(set as never)}::jsonb) - ${textArray(unset)}::text[],
        updated_at = clock_timestamp()
    WHERE id = ${pageId}`;
}

async function readPublication(
  sql: Tx | ReturnType<typeof useDb>,
  pageId: string,
  lock = false,
): Promise<StoredPublication | undefined> {
  const [row] = lock
    ? await sql<{ data: StoredPublication }[]>`
        SELECT data FROM declaration_publications WHERE id = ${pageId} FOR UPDATE`
    : await sql<{ data: StoredPublication }[]>`
        SELECT data FROM declaration_publications WHERE id = ${pageId}`;
  return row?.data;
}

/** Whether a people import may be writing pages now (`peopleImportRunning`
 * over `ops.job_runs`). A question that cannot be answered counts as yes. */
async function peopleImportBusy(now: Date): Promise<boolean> {
  try {
    const runs = await useDb()<Row[]>`
      SELECT id, data FROM ops.job_runs WHERE data -> 'state' = '"running"'::jsonb`;
    return runs.some(({ id, data }) => {
      const run = runFromDoc(id, data);
      if (!run || !PEOPLE_WRITING_JOBS.includes(run.job)) return false;
      const definition = jobDefinition(run.job);
      return !definition || !isStalled(run, definition, now);
    });
  } catch (error) {
    console.error(
      "[declarations] cannot tell whether a people import is running; " +
        "publishing nothing",
      error,
    );
    return true;
  }
}

/** The live person pages the ids name, each once, followed through merges. */
async function livePages(ids: readonly string[]): Promise<LivePage[]> {
  const pages = new Map<string, LivePage>();
  for (const id of unique(ids)) {
    const { id: final, data } = await resolveMergedNodeDoc(id);
    if (!data || data.type !== "person" || data.deleted === true) continue;
    pages.set(final, { id: final, data });
  }
  return [...pages.values()];
}

async function readExtract(id: string): Promise<Data | undefined> {
  const [row] = await useDb()<{ data: Data }[]>`
    SELECT data FROM declaration_extracts WHERE id = ${id}`;
  return row?.data;
}

// ---------------------------------------------------------------------------
// Comparing a settled reading with its pages
// ---------------------------------------------------------------------------

/**
 * Compares the date readers agreed on with each page the crop is for, and
 * acts on what it finds (see the top of this file).
 *
 * Idempotent: a second run over the same state writes nothing. The note is
 * filed once per crop and page, a declaration is linked once, and the crop is
 * written only when what it says about its pages changes. That is what lets
 * every caller - the answer that settled the crop, the upload of a crop that
 * came settled, the sweep - call it without asking whether another did.
 *
 * A crop that left any page undated or born on another day is marked to be
 * compared again (`pageRecheck`): the import may bring the undated page a
 * date, and a reviewer may correct the other one, and either can make the
 * crop a match - or a second page with its date, which holds both.
 *
 * A date an admin settled holds every draft born that day, for somebody to
 * publish by hand (`admin_decision`), and joins no record that readers or
 * the job made (`nextPublication`). A public page born that day gets no
 * record at all: it is up already, the admin's date links nothing on it, and
 * a hold would sit on the admin's list of held pages asking for nothing. A
 * page born on another day is flagged as for any reading.
 */
export async function matchPagesPg(
  extractId: string,
  now: Date = new Date(),
): Promise<MatchResult> {
  const extract = await readExtract(extractId);
  const agreed = agreedDay(extract);
  if (!extract || !agreed) {
    return { extractId, pageMatch: null, outcomes: {}, changed: false };
  }
  const byAdmin = settledByAdmin(extract);
  const pages = await livePages(asStrings(extract.personIds));
  const outcomes: Record<string, PageOutcome> = {};
  const born: LivePage[] = [];
  for (const page of pages) {
    const stored = birthDateOf(page.data);
    if (!stored) outcomes[page.id] = "no_date";
    else if (stored !== agreed) outcomes[page.id] = "different";
    else born.push(page);
  }
  for (const page of born) {
    outcomes[page.id] =
      byAdmin || born.length > 1
        ? "held"
        : pageIsPublic(page.data)
          ? "confirmed"
          : "queued";
  }

  const declaration = declarationOf(extract);
  let changed = false;
  for (const page of pages) {
    const outcome = outcomes[page.id]!;
    if (outcome === "no_date") continue;
    if (outcome === "held" && byAdmin && pageIsPublic(page.data)) continue;
    const wrote =
      outcome === "different"
        ? await flagAnotherDate(page.id, extractId, extract, now)
        : await recordPublication(page.id, {
            outcome,
            byAdmin,
            extractId,
            declaration,
            now,
          });
    changed = wrote || changed;
  }

  const pageMatch: PageMatch =
    born.length > 0
      ? "same"
      : Object.values(outcomes).includes("different")
        ? "different"
        : "no_date";
  const pageRecheck = Object.values(outcomes).some(
    (outcome) => outcome === "no_date" || outcome === "different",
  );
  if (
    extract.pageMatch !== pageMatch ||
    extract.pageRecheck !== pageRecheck ||
    !sameOutcomes(extract.pageOutcomes, outcomes)
  ) {
    const patch = {
      pageMatch,
      pageOutcomes: outcomes,
      pageRecheck,
      pageCheckedAt: now.toISOString(),
    };
    await useDb()`
      UPDATE declaration_extracts
      SET data = data || ${useDb().json(patch as never)}::jsonb, updated_at = clock_timestamp()
      WHERE id = ${extractId}`;
    changed = true;
  }
  return { extractId, pageMatch, outcomes, changed };
}

/** `flagAnotherDate`: one entry per crop in the automation's note on the
 * page, under the note's row lock. */
async function flagAnotherDate(
  pageId: string,
  extractId: string,
  extract: Data,
  now: Date,
): Promise<boolean> {
  const id = `${pageId}_${DECLARATION_ACTOR}`;
  return editorialTx(async (tx, log) => {
    const note = (await readDoc(tx, "notes", id, true)) as Note | undefined;
    const sources = note?.sources ?? [];
    if (sources.some((entry) => entry.declarationExtractId === extractId)) {
      return false;
    }
    const url = typeof extract.url === "string" ? extract.url : "";
    const entry: NoteSource = {
      kind: "change_request",
      ...(url ? { url } : {}),
      note: anotherDateNote(extract),
      declarationExtractId: extractId,
    };
    const at = now.toISOString();
    await storeDoc(tx, log, "notes", id, {
      ...(note ?? {}),
      userUid: DECLARATION_ACTOR,
      nodeId: pageId,
      sources: [...sources, entry],
      ...(note ? { updatedAt: at } : { createdAt: at }),
    });
    return true;
  });
}

/** `recordPublication`: the crop added to the page's record under its lock. */
async function recordPublication(
  pageId: string,
  args: Parameters<typeof nextPublication>[2],
): Promise<boolean> {
  let wrote = false;
  await useDb().begin(async (tx) => {
    const existing = await readPublication(tx, pageId, true);
    const next = nextPublication(existing, pageId, args, {
      at: (at) => at.toISOString(),
      removed: () => REMOVED,
    });
    if (!next) return;
    const { set, unset } = asPatch(next);
    await mergePublication(tx, pageId, set, unset);
    wrote = true;
  });
  return wrote;
}

/** `creditFinds`: the reader credited with each live page of the crop whose
 * birth date the typed date does not contradict. How many. */
export async function creditFindsPg(
  find: {
    uid: string;
    extractId: string;
    personIds: readonly string[];
    value: string;
  },
  now: Date = new Date(),
): Promise<number> {
  const found = (await livePages(find.personIds)).filter(
    (page) => !contradicts(find.value, birthDateOf(page.data)),
  );
  if (found.length === 0) return 0;
  const sql = useDb();
  const at = now.toISOString();
  const rows = Object.fromEntries(
    found.map((page) => [
      `${find.uid}_${page.id}`,
      { uid: find.uid, personId: page.id, extractId: find.extractId, at },
    ]),
  );
  await sql`
    INSERT INTO declaration_reader_finds AS t (id, data)
    SELECT key, value FROM jsonb_each(${sql.json(rows)}::jsonb)
    ON CONFLICT (id) DO UPDATE
      SET data = t.data || EXCLUDED.data, updated_at = clock_timestamp()`;
  return found.length;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/**
 * Publishes queued pages, oldest first, while the Warsaw day's count is under
 * `limit`. Takes up no new page at a limit of 0, which is how the automatic
 * publication is switched off, and does nothing at all inside
 * `PEOPLE_IMPORT_WINDOW` or while a people import is running
 * (`peopleImportRunning`).
 *
 * Two steps a page. A transaction claims it - `queued` to `publishing` - and
 * takes a slot of the day, only while slots are left; then `publishPagePg` does
 * the writes, which are too many for one transaction. A page held on the way
 * gives its slot back, so a day's limit counts pages that went up. A pass that
 * dies after the claim leaves the page `publishing`; the first pass
 * `STUCK_PUBLISHING_MS` later takes it up again under the slot it already
 * holds, and `publishPagePg` carries on from wherever the writes stopped. That
 * one is finished at a limit of 0 too where the page is public already: the
 * page went up under the limit of its day, and leaving it without the
 * relations it went up for is the one state nobody chose.
 *
 * `pressedBy` makes the pass an admin's press of „Opublikuj z kolejki” on
 * /admin/oswiadczenia, with the admin's uid: publishing from the queue is an
 * admin's decision. A press takes up the queue past the limit, at 0 too, and
 * in no slot of the day: the slots are the automation's, which „Dziś” on the
 * overview counts, so a page held on the way has none to give back. Its claim
 * names the admin, and a page it puts up is not one the site published on its
 * own (`autoPublished`). The night window and a running import stop it as
 * they stop every pass, since the import's stale write would take the page
 * down again, and `publishPagePg` holds a page for it as for the automation.
 * A stuck page is finished on the terms it was claimed on, whichever pass
 * takes it up again: the automation's under its slot, a press's without one.
 * A press ends by counting the pages still waiting (`waiting`), for the admin
 * to press again.
 *
 * `maxPages` bounds the pages one call takes up; the reader whose answer
 * settled a crop is waiting for their next one, and the admin who pressed for
 * the page to answer (`PRESS_BATCH`).
 */
export async function drainPublicationsPg(
  now: Date,
  limit: number,
  options: { maxPages?: number; pressedBy?: string } = {},
): Promise<DrainResult> {
  const sql = useDb();
  const pressedBy = options.pressedBy || null;
  const on = limit > 0 || pressedBy !== null;
  const result: DrainResult = {
    day: warsawDate(now),
    limit,
    skipped: on ? null : "off",
    published: [],
    held: [],
    confirmed: [],
    failed: [],
    capReached: false,
    waiting: null,
  };
  const withWaiting = async (pass: DrainResult): Promise<DrainResult> =>
    pressedBy ? { ...pass, waiting: await stillWaiting() } : pass;
  if (inPeopleImportWindow(now)) {
    return withWaiting({ ...result, skipped: "night" });
  }

  const maxPages = options.maxPages ?? DRAIN_BATCH;
  const stuckBefore = new Date(
    now.getTime() - STUCK_PUBLISHING_MS,
  ).toISOString();
  const [stuck, queued] = await Promise.all([
    sql<{ id: string }[]>`
      SELECT id FROM declaration_publications
      WHERE jsonb_text(data -> 'status') = 'publishing'
        AND jsonb_text(data -> 'claimedAt') COLLATE "C" <= ${stuckBefore}
      ORDER BY jsonb_text(data -> 'claimedAt') COLLATE "C", id LIMIT ${maxPages}`,
    on
      ? sql<{ id: string }[]>`
          SELECT id FROM declaration_publications
          WHERE jsonb_text(data -> 'status') = 'queued'
            AND jsonb_text(data -> 'queuedAt') IS NOT NULL
          ORDER BY jsonb_text(data -> 'queuedAt') COLLATE "C", id LIMIT ${maxPages}`
      : Promise.resolve([] as { id: string }[]),
  ]);
  const stuckIds = stuck.map((row) => row.id);
  const ids = [
    ...(on ? stuckIds : await publicPages(stuckIds)),
    ...queued.map((row) => row.id),
  ];
  if (ids.length === 0) return withWaiting(result);
  if (await peopleImportBusy(now)) {
    return withWaiting({ ...result, skipped: "import" });
  }

  let taken = 0;
  for (const id of ids) {
    if (taken >= maxPages) break;
    const claim = await claimPublication(id, now, limit, pressedBy);
    if (claim === "cap") {
      result.capReached = true;
      break;
    }
    if (!claim) continue;
    taken += 1;
    try {
      const outcome = await publishPagePg(id, now);
      if (outcome.status === "published") {
        result.published.push(id);
        continue;
      }
      await releaseClaim(id, claim, outcome, now);
      if (outcome.status === "held") {
        result.held.push({ personId: id, reason: outcome.reason });
      } else {
        result.confirmed.push(id);
      }
    } catch (error) {
      console.error(`[declarations] publishing ${id} failed`, error);
      result.failed.push(id);
    }
  }
  return withWaiting(result);
}

/** Pages waiting in the queue: queued, or taken up and not finished. */
async function stillWaiting(): Promise<number> {
  const [row] = await useDb()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM declaration_publications
    WHERE jsonb_text(data -> 'status') IN ('queued', 'publishing')`;
  return row?.n ?? 0;
}

/** `claimPublication`, under the record's lock; the day's slot taken in the
 * same transaction. */
async function claimPublication(
  pageId: string,
  now: Date,
  limit: number,
  pressedBy: string | null,
): Promise<Claim | "cap" | null> {
  let claim: Claim | "cap" | null = null;
  await useDb().begin(async (tx) => {
    const publication = await readPublication(tx, pageId, true);
    const at = now.toISOString();
    if (publication?.status === "publishing") {
      if (millisOf(publication.claimedAt) > now.getTime() - STUCK_PUBLISHING_MS)
        return;
      await updatePublication(tx, pageId, { claimedAt: at, updatedAt: at });
      claim = {
        day: publication.pressedBy
          ? null
          : (publication.day ?? warsawDate(now)),
        claimedAt: at,
      };
      return;
    }
    if (publication?.status !== "queued") return;
    if (publication.declinedAt) {
      await updatePublication(tx, pageId, {
        status: "held",
        reason: publication.reason ?? "admin_decision",
        heldAt: at,
        updatedAt: at,
      });
      return;
    }
    if (pressedBy) {
      await updatePublication(
        tx,
        pageId,
        { status: "publishing", claimedAt: at, pressedBy, updatedAt: at },
        ["day"],
      );
      claim = { day: null, claimedAt: at };
      return;
    }
    const day = warsawDate(now);
    if (
      !(await takeCount(tx, "declaration_publish_limits", day, day, limit, {
        updatedAt: at,
      }))
    ) {
      claim = "cap";
      return;
    }
    await updatePublication(
      tx,
      pageId,
      { status: "publishing", claimedAt: at, day, updatedAt: at },
      ["pressedBy"],
    );
    claim = { day, claimedAt: at };
  });
  return claim;
}

/** `releaseClaim`: the slot given back and why the page did not go up, while
 * the page is still this pass's. */
async function releaseClaim(
  pageId: string,
  claim: Claim,
  outcome: Exclude<PublishOutcome, { status: "published" }>,
  now: Date,
): Promise<void> {
  await useDb().begin(async (tx) => {
    const publication = await readPublication(tx, pageId, true);
    if (
      publication?.status !== "publishing" ||
      millisOf(publication.claimedAt) !== Date.parse(claim.claimedAt)
    ) {
      return;
    }
    const at = now.toISOString();
    if (claim.day) {
      await tx`
        UPDATE declaration_publish_limits
        SET data = data || jsonb_build_object(
              'day', ${claim.day}::text, 'updatedAt', ${at}::text,
              'count', greatest(0, coalesce(docstore_num(data -> 'count'), 0) - 1)),
            updated_at = clock_timestamp()
        WHERE id = ${claim.day}`;
    }
    await updatePublication(
      tx,
      pageId,
      outcome.status === "held"
        ? { status: "held", reason: outcome.reason, heldAt: at, updatedAt: at }
        : { status: "confirmed", reason: null, updatedAt: at },
    );
  });
}

async function readNodes(ids: readonly string[]): Promise<Map<string, Data>> {
  const wanted = unique(ids.filter((id) => typeof id === "string" && id));
  if (wanted.length === 0) return new Map();
  const rows = await useDb()<Row[]>`
    SELECT id, data FROM nodes WHERE id = ANY(${textArray(wanted)}::text[])`;
  return new Map(rows.map((row) => [row.id, row.data]));
}

async function publicPages(ids: readonly string[]): Promise<string[]> {
  const found = publicAmong(await readNodes(ids));
  return ids.filter((id) => found.has(id));
}

// ---------------------------------------------------------------------------
// A held page, looked at again
// ---------------------------------------------------------------------------

/** `recheckPublication`: an admin's „Sprawdź ponownie” on a held page. */
export async function recheckPublicationPg(
  pageId: string,
  pressedBy: string,
  now: Date = new Date(),
): Promise<RecheckResult> {
  if (inPeopleImportWindow(now)) {
    return { outcome: "skipped", skipped: "night" };
  }
  if (await peopleImportBusy(now)) {
    return { outcome: "skipped", skipped: "import" };
  }
  const { claim, reason } = await claimHeld(pageId, now, pressedBy);
  let outcome: PublishOutcome;
  try {
    outcome =
      reason === "two_pages" && (await stillTwoPages(pageId))
        ? held("two_pages")
        : await publishPagePg(pageId, now);
  } catch (error) {
    const page = await readNodes([pageId]).then(
      (nodes) => nodes.get(pageId),
      () => undefined,
    );
    if (reason && page && !pageIsPublic(page)) {
      await releaseClaim(pageId, claim, { status: "held", reason }, now).catch(
        () => {},
      );
    }
    throw error;
  }
  if (outcome.status === "published") return { outcome: "published" };
  await releaseClaim(pageId, claim, outcome, now);
  return outcome.status === "held"
    ? { outcome: "held", reason: outcome.reason }
    : { outcome: "confirmed" };
}

async function stillTwoPages(pageId: string): Promise<boolean> {
  const [publication, nodes] = await Promise.all([
    readPublication(useDb(), pageId),
    readNodes([pageId]),
  ]);
  const born = birthDateOf(nodes.get(pageId));
  const matching = (
    await agreedExtracts(asStrings(publication?.extractIds))
  ).filter((extract) => agreedDay(extract) === born);
  return matching.length > 0 && anotherPageBornThatDay(pageId, matching);
}

/** `claimHeld`: a held page claimed for the admin who asked, under its lock. */
async function claimHeld(
  pageId: string,
  now: Date,
  pressedBy: string,
): Promise<{ claim: Claim; reason: PublicationHoldReason | null }> {
  let claimed: { claim: Claim; reason: PublicationHoldReason | null };
  await useDb().begin(async (tx) => {
    const publication = await readPublication(tx, pageId, true);
    if (!publication) {
      throw createError({
        statusCode: 404,
        message: "Nie ma takiej publikacji.",
      });
    }
    if (publication.status !== "held") {
      throw createError({
        statusCode: 409,
        message: "Ta publikacja nie jest już wstrzymana.",
      });
    }
    if (publication.declinedAt) {
      throw createError({
        statusCode: 409,
        message: "Ta osoba jest odłożona: najpierw ją przywróć.",
      });
    }
    if (
      publication.reason === "admin_decision" &&
      !pageIsPublic((await readDoc(tx, "nodes", pageId)) ?? {})
    ) {
      throw createError({
        statusCode: 409,
        message: "Datę ustalił administrator: tę stronę publikuje się ręcznie.",
      });
    }
    const at = now.toISOString();
    await updatePublication(
      tx,
      pageId,
      {
        status: "publishing",
        reason: null,
        claimedAt: at,
        pressedBy,
        updatedAt: at,
      },
      ["day"],
    );
    claimed = {
      claim: { day: null, claimedAt: at },
      reason: publication.reason ?? null,
    };
  });
  return claimed!;
}

// ---------------------------------------------------------------------------
// Publishing one page
// ---------------------------------------------------------------------------

/**
 * Publishes a queued page with its KRS jobs and the candidacies its
 * declarations were filed for, as `pipeline-declarations` - or holds it.
 *
 * Everything is read again rather than trusted from when the page was queued,
 * and the page is held, with the first reason that applies, unless:
 *
 * - it is still a live person page nobody marked as two people (`needs_split`);
 * - it still has a date one of its settled crops agreed on
 *   (`no_longer_matches`), and no other live page those crops name has that
 *   date too (`two_pages`) - asked again here, since a page can gain its date
 *   after the crop was compared;
 * - nobody kept it off the site: no unpublication on record, and no revision a
 *   person approved while it is a draft (`kept_hidden`) - an approval by the
 *   import, a migration or this automation is nobody's decision to hide it;
 * - no reviewer turned down a revision of it, short of a request to remove it
 *   (`revision_rejected`);
 * - no person's proposal about it is waiting, a removal included, however old
 *   (`pending_proposal`), and its newest revision was written automatically,
 *   so it is the import's and not a person's;
 * - it shows that newest revision as it stands (`no_revision`, also when there
 *   is none): that is the revision approved on the way up where the page has
 *   none approved, so what goes live is what was checked;
 * - the name readers agreed on, where they gave one, fits the page
 *   (`name_differs`);
 * - no settled crop that names the page, or that this automation flagged on
 *   it, was read as another birth date (`conflicting_reading`);
 * - somebody is paid for a public post on it (`no_public_post`): a live
 *   `employed` edge, drafts included, at a company the register shows the
 *   public sector owns, and not a seat on an organ nobody is paid to sit on -
 *   the site's own employment rule (`publicEmployment` in shared/stats.ts,
 *   `paidPublicPost` here). Every councillor files a declaration, so without
 *   this the queue publishes people whose page says nothing koryta.pl is for.
 *   A post that has ended counts: what the site records is that the money was
 *   public, not that it still is. Asked ahead of the candidacies, since a page
 *   this holds is one no candidacy would put up either;
 * - it has the candidacy the declaration was filed for - same year, the
 *   powiat or województwo the election edges point at, the office or a bare
 *   local one - and one only for each election (`no_candidacy_on_page`,
 *   `ambiguous_candidacy`);
 * - no reviewer rejected a revision of that candidacy and no person's own is
 *   waiting on it (`candidacy_reviewed`);
 * - none of its candidacies, drafts included, stand in two places in one
 *   election (`two_places`): the night's `test_nobody_stands_in_two_places_at_once`
 *   counts the published ones, and a draft beside them is a namesake's record
 *   on the page - whose committee the pipeline adds to the page's parties. A
 *   candidacy a reviewer rejected is not the page's and is left out. 169 of
 *   the 2,492 dated drafts with a candidacy on 2026-10-29 are held for this.
 *
 * Then the page goes up the way /api/nodes/publish puts it up: the import's
 * newest revision approved first, where the page has none approved or an
 * older one, in a commit of its own, then `published` with the audit row.
 * That commit also files „Inne” on a page that would go up naming no party
 * beside its candidacy and paid post (`partyFloor` in shared/partyFloor.ts).
 * `stats.isApproved` is left to the trigger in functions/src/nodes.ts, which
 * sets it on every change of visibility, as it does for that endpoint. The
 * relations follow in batches: the chosen candidacies as a reviewer's publish
 * would put them up (`publishEdgeInBatch`), and every job at a public company
 * that the people import's own rule for verified people would put live
 * (`approveWaitingEdge`) - where the page's birth date came with the register
 * entry the jobs are listed under (`dateCameWithEntry`). A job that rule
 * refuses, or at a company still in draft, stays off the site and is listed on
 * the record.
 *
 * A page found public already was published by somebody else while it waited
 * (`confirmed`), unless the last publication on record is this automation's:
 * then a pass was cut short after the page went up, and this one finishes the
 * relations. Such a page is never held - it went up under its day's slot, or
 * at an admin's press, and a hold would give the slot back for a page that is
 * live. What came in between holds the relations it is about instead: a
 * candidacy reviewed or standing in two places, every relation of a page
 * marked as two people.
 *
 * The record says whether the site published the page on its own
 * (`autoPublished`): not where the claim it went up under is an admin's press
 * (`pressedBy`), whose name the record keeps. The audit row and the approvals
 * are still this automation's: it is what read and checked the page, and what
 * the next pass recognises as its own work to finish or put back. The publish
 * row names the admin beside it (`pressed_by`), so that /aktywnosc and
 * /eksploruj/statystyki count the press as the admin's publication.
 */
export async function publishPagePg(
  pageId: string,
  now: Date = new Date(),
): Promise<PublishOutcome> {
  const sql = useDb();
  const [publication, nodes] = await Promise.all([
    readPublication(sql, pageId),
    readNodes([pageId]),
  ]);
  const page = nodes.get(pageId);
  if (!page || page.type !== "person") return held("needs_split");

  const audit = await pageAudit(pageId);
  const resumed = pageIsPublic(page);
  if (resumed && !lastPublishedHere(audit)) return { status: "confirmed" };
  if (!resumed && (page.deleted === true || page.merged_into)) {
    return held("needs_split");
  }

  const [extracts, revisions] = await Promise.all([
    agreedExtracts(publication?.extractIds ?? []),
    nodeRevisionsPg(sql, pageId),
  ]);
  const matching = extracts.filter(
    (extract) => agreedDay(extract) === birthDateOf(page),
  );

  let approve: StoredRevision | null = null;
  if (!resumed) {
    const check = await pageCheck({
      pageId,
      page,
      publication,
      audit,
      revisions,
      matching,
    });
    if ("reason" in check) return held(check.reason);
    approve = check.approve;
  }

  const edges = (
    await sql<
      Row[]
    >`SELECT id, data FROM edges WHERE source = ${pageId} ORDER BY id`
  ).map((row) => ({ id: row.id, data: row.data as unknown as Edge }));
  const jobs = edges.filter(
    (edge) => edge.data.type === "employed" && edge.data.deleted !== true,
  );
  const companyNodes = await readNodes(jobs.map((job) => job.data.target));
  if (
    !resumed &&
    !jobs.some((job) =>
      isPublicEmployment(job.data, companyNodes.get(job.data.target)),
    )
  ) {
    return held("no_public_post");
  }

  const elections = edges.filter(
    (edge) => edge.data.type === "election" && edge.data.deleted !== true,
  );
  const units = unitsOf(matching);
  const regions = publicAmong(
    await readNodes(units.map((unit) => regionOf(unit))),
  );
  const choice = chooseCandidacies(elections, units, regions);
  const chosen = "chosen" in choice ? choice.chosen : [];
  if (!resumed && "reason" in choice) return held(choice.reason);

  const companies = publicAmong(companyNodes);
  const heldEdges: { id: string; reason: PublicationEdgeHold }[] = [];
  const waitingJobs = jobs.filter((job) => {
    const settled = settledEdgeRefusal(job.data as unknown as Data);
    if (settled === "live" || settled === "deleted") return false;
    if (!companies.has(job.data.target)) {
      heldEdges.push({ id: job.id, reason: "company_draft" });
      return false;
    }
    if (settled) {
      heldEdges.push({ id: job.id, reason: settled });
      return false;
    }
    return true;
  });
  const waitingCandidacies = chosen.filter((edge) => !pageIsPublic(edge.data));
  const edgeRevisions = await edgeRevisionsForManyPg(sql, [
    ...elections.map((edge) => edge.id),
    ...waitingJobs.map((job) => job.id),
  ]);

  const reviewed = new Map<string, PublicationEdgeHold>();
  for (const edge of waitingCandidacies) {
    const own = edgeRevisions.get(edge.id) ?? [];
    if (own.some((each) => each.status === "rejected")) {
      reviewed.set(edge.id, "rejected");
    } else if (
      own.some((each) => each.status === "pending" && writtenByPerson(each))
    ) {
      reviewed.set(edge.id, "by_hand");
    }
  }
  const chosenIds = new Set(chosen.map((edge) => edge.id));
  const clashing = clashingCandidacies(
    pageId,
    elections.filter(
      (edge) =>
        chosenIds.has(edge.id) ||
        !(edgeRevisions.get(edge.id) ?? []).some(
          (each) => each.status === "rejected",
        ),
    ),
  );
  if (!resumed) {
    if (reviewed.size > 0) return held("candidacy_reviewed");
    if (clashing.size > 0) return held("two_places");
  }
  const stopped = resumed && !!page.needs_split;
  const candidaciesToPublish = waitingCandidacies.filter((edge) => {
    const reason: PublicationEdgeHold | undefined = stopped
      ? "needs_split"
      : (reviewed.get(edge.id) ??
        (clashing.has(edge.id) ? "two_places" : undefined));
    if (reason) heldEdges.push({ id: edge.id, reason });
    return !reason;
  });

  const fromEntry = dateCameWithEntry(page, revisions);
  const jobsToPublish = waitingJobs.filter((job) => {
    const refusal = waitingEdgeRefusal(
      job.data as unknown as Data,
      edgeRevisions.get(job.id) ?? [],
    );
    if (refusal === "live" || refusal === "deleted") return false;
    const reason: PublicationEdgeHold | null =
      refusal ??
      (stopped ? "needs_split" : fromEntry ? null : "date_not_from_entry");
    if (reason) heldEdges.push({ id: job.id, reason });
    return !reason;
  });

  const up = { approvedRevision: null as string | null, floored: false };
  if (!resumed) {
    const shown = [
      ...elections.filter(({ data }) => pageIsPublic(data)),
      ...candidaciesToPublish,
      ...jobs.filter(({ data }) => pageIsPublic(data)),
      ...jobsToPublish,
    ].map(({ data }) => ({ ...data, published: true }));
    await editorialTx(async (tx, log) => {
      if (approve) {
        await applyRevisionPg(tx, log, approve.id, approve, actor);
        up.approvedRevision = approve.id;
      }
      if (
        partyFloor(page) !== null &&
        showsCandidacyAndPaidPost(shown, (id) => companyNodes.get(id))
      ) {
        const stored = await readDoc(tx, "nodes", pageId, true);
        const parties = stored ? partyFloor(stored) : null;
        if (stored && parties) {
          await createRevisionPg(
            tx,
            log,
            actor,
            { collection: "nodes", id: pageId },
            { ...withoutInternalFields(stored), parties },
            { automatic: true, approve: true, stored },
          );
          up.floored = true;
        }
      }
      await patchDoc(tx, log, "nodes", pageId, {
        published: true,
        [CONTENT_CHANGED_AT]: now.toISOString(),
      });
      await recordAuditPg(tx, {
        action: "publish",
        collection: "nodes",
        target_id: pageId,
        user: DECLARATION_ACTOR,
        ...(publication?.status === "publishing" && publication.pressedBy
          ? { pressed_by: publication.pressedBy }
          : {}),
      });
    });
  }

  const published = await publishRelations(
    [
      ...candidaciesToPublish.map((edge) => ({
        ...edge,
        kind: "candidacy" as const,
      })),
      ...jobsToPublish.map((job) => ({ ...job, kind: "job" as const })),
    ],
    edgeRevisions,
  );

  const at = now.toISOString();
  const edgesRecord = {
    published: unique([...(publication?.edges?.published ?? []), ...published]),
    held: heldEdges,
  };
  await mergePublication(sql, pageId, {
    personId: pageId,
    status: "published",
    reason: null,
    publishedAt: at,
    ...(publication?.pressedBy
      ? {}
      : { day: publication?.day ?? warsawDate(now) }),
    autoPublished: !publication?.pressedBy,
    ...(resumed ? {} : { approvedRevision: up.approvedRevision }),
    edges: edgesRecord,
    updatedAt: at,
  });
  console.info(
    `[declarations] published ${pageId} with ${published.length} relation(s), ` +
      `${heldEdges.length} held${up.floored ? ", party Inne" : ""}`,
  );
  return {
    status: "published",
    approvedRevision: up.approvedRevision,
    edges: edgesRecord,
  };
}

/** `pageCheck`: the checks on the page before it first goes up. */
async function pageCheck(args: {
  pageId: string;
  page: Data;
  publication: StoredPublication | undefined;
  audit: readonly AuditEntry[];
  revisions: readonly StoredRevision[];
  matching: readonly Data[];
}): Promise<
  { reason: PublicationHoldReason } | { approve: StoredRevision | null }
> {
  const { pageId, page, publication, audit, revisions, matching } = args;
  if (page.needs_split) return { reason: "needs_split" };
  if (matching.length === 0) return { reason: "no_longer_matches" };
  if (
    publication?.reason === "two_pages" ||
    (await anotherPageBornThatDay(pageId, matching))
  ) {
    return { reason: "two_pages" };
  }
  if (await keptHidden(page, audit, revisions)) {
    return { reason: "kept_hidden" };
  }
  if (
    revisions.some(
      (revision) =>
        revision.status === "rejected" &&
        (revision.data as Data | undefined)?.deleted !== true,
    )
  ) {
    return { reason: "revision_rejected" };
  }
  if (
    revisions.some(
      (revision) => revision.status === "pending" && writtenByPerson(revision),
    )
  ) {
    return { reason: "pending_proposal" };
  }
  const newest = latestPublishableRevision([...revisions]);
  if (newest && newest.update_automatic !== true) {
    return { reason: "pending_proposal" };
  }
  if (!newest || !holdsRevision(page, newest.data)) {
    return { reason: "no_revision" };
  }
  const misnamed = matching.some(
    (extract) =>
      typeof extract.agreedName === "string" &&
      extract.agreedName.trim() !== "" &&
      !nameFitsPage(extract.agreedName, String(page.name ?? "")),
  );
  if (misnamed) return { reason: "name_differs" };
  const other = await readingsOfAnotherDayPg(pageId, birthDateOf(page));
  if (other.length > 0) return { reason: "conflicting_reading" };
  return {
    approve: approvedRevisionId(page.revision_id) === newest.id ? null : newest,
  };
}

/** The page's own rows of the audit log. */
async function pageAudit(pageId: string): Promise<AuditEntry[]> {
  const rows = await useDb()<{ data: AuditEntry }[]>`
    SELECT data FROM audit
    WHERE jsonb_text(data -> 'target_id') = ${pageId}
      AND data -> 'collection' = '"nodes"'::jsonb
    ORDER BY id`;
  return rows.map((row) => row.data);
}

async function keptHidden(
  page: Data,
  audit: readonly AuditEntry[],
  revisions: readonly StoredRevision[],
): Promise<boolean> {
  if (audit.some((row) => row.action === "unpublish")) return true;
  const approved = approvedRevisionId(page.revision_id);
  if (!approved) return false;
  const revision =
    revisions.find((each) => each.id === approved) ??
    ((await readDoc(useDb(), "revisions", approved)) as Revision | undefined);
  return !isAutomatedUid(revision?.review_user);
}

async function anotherPageBornThatDay(
  pageId: string,
  extracts: readonly Data[],
): Promise<boolean> {
  for (const extract of extracts) {
    const agreed = agreedDay(extract);
    const pages = await livePages(asStrings(extract.personIds));
    if (
      pages.some(
        (page) => page.id !== pageId && birthDateOf(page.data) === agreed,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** The settled crops the page is named on, or that this automation flagged on
 * it, that were read as a date the page does not have: what
 * `conflicting_reading` holds a page for, and what /admin/oswiadczenia shows on
 * its row. A declaration of the same person that disagrees is a doubt the
 * matching one does not settle, and the note the automation filed about it is
 * still waiting for somebody. The flagged ones are read again rather than
 * counted, so a page whose date a reviewer has since corrected to the reading
 * is not held for it. */
export async function readingsOfAnotherDayPg(
  pageId: string,
  born: string,
): Promise<Row[]> {
  const sql = useDb();
  const [notes, named] = await Promise.all([
    sql<{ data: Note }[]>`
      SELECT data FROM notes WHERE id = ${`${pageId}_${DECLARATION_ACTOR}`}`,
    sql<Row[]>`
      SELECT id, data FROM declaration_extracts
      WHERE data @> ${sql.json({ personIds: [pageId] })}
      ORDER BY id LIMIT ${READINGS_PER_PAGE}`,
  ]);
  const crops = new Map<string, Row>(named.map((row) => [row.id, row]));
  const flagged = unique(
    (notes[0]?.data.sources ?? [])
      .map((entry) => entry.declarationExtractId)
      .filter((id): id is string => typeof id === "string" && !crops.has(id)),
  );
  if (flagged.length > 0) {
    const rows = await sql<Row[]>`
      SELECT e.id, e.data
      FROM unnest(${textArray(flagged)}::text[]) WITH ORDINALITY AS w(id, at)
      JOIN declaration_extracts e ON e.id = w.id ORDER BY w.at`;
    for (const row of rows) crops.set(row.id, row);
  }
  return [...crops.values()].filter((crop) => {
    const day = agreedDay(crop.data);
    return day !== null && day !== born;
  });
}

/** `agreedExtracts`: the crops still settled on a full date, of those named,
 * an admin's left out unless `byAdmin`. */
async function agreedExtracts(
  ids: readonly string[],
  { byAdmin = false }: { byAdmin?: boolean } = {},
): Promise<Data[]> {
  if (ids.length === 0) return [];
  const rows = await useDb()<Row[]>`
    SELECT e.id, e.data
    FROM unnest(${textArray(unique(ids))}::text[]) WITH ORDINALITY AS w(id, at)
    JOIN declaration_extracts e ON e.id = w.id ORDER BY w.at`;
  return rows
    .map((row) => row.data)
    .filter(
      (data) => agreedDay(data) !== null && (byAdmin || !settledByAdmin(data)),
    );
}

/** The relations up, in one transaction: candidacies as a reviewer's
 * publish puts them up, jobs by `approveWaitingEdge`'s rule. The ids that
 * went up. */
async function publishRelations(
  relations: readonly (StoredEdge & { kind: "candidacy" | "job" })[],
  revisions: Map<string, StoredRevision[]>,
): Promise<string[]> {
  if (relations.length === 0) return [];
  return editorialTx(async (tx, log) => {
    const done: string[] = [];
    for (const relation of relations) {
      const stored = relation.data as unknown as Data;
      const own = revisions.get(relation.id) ?? [];
      if (relation.kind === "candidacy") {
        await publishEdgePg(tx, log, relation.id, stored, own, actor, false);
        done.push(relation.id);
      } else if (
        await approveWaitingEdgePg(tx, log, relation.id, stored, actor, own)
      ) {
        done.push(relation.id);
      }
    }
    return done;
  });
}

// ---------------------------------------------------------------------------
// A publication a stale write undid
// ---------------------------------------------------------------------------

/** `restoreReverted`: pages this automation published lately that are drafts
 * again with nobody on record taking them down, put back up or held with
 * their relations taken down. */
export async function restoreRevertedPg(
  now: Date,
): Promise<SweepResult["reverted"]> {
  const result: SweepResult["reverted"] = { restored: [], held: [] };
  if (inPeopleImportWindow(now)) return result;
  const since = new Date(
    now.getTime() - REVERT_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const recent = await useDb()<{ id: string }[]>`
    SELECT id FROM declaration_publications
    WHERE jsonb_text(data -> 'status') = 'published'
      AND jsonb_text(data -> 'publishedAt') COLLATE "C" >= ${since}
    ORDER BY jsonb_text(data -> 'publishedAt') COLLATE "C", id
    LIMIT ${SWEEP_BATCH}`;
  if (recent.length === 0) return result;
  const pages = await readNodes(recent.map((row) => row.id));
  const reverted: string[] = [];
  for (const { id } of recent) {
    const page = pages.get(id);
    if (!page || pageIsPublic(page) || page.deleted === true) continue;
    if (page.merged_into) continue;
    if (lastPublishedHere(await pageAudit(id))) reverted.push(id);
  }
  if (reverted.length === 0) return result;
  if (await peopleImportBusy(now)) return result;

  for (const pageId of reverted) {
    console.info(`[declarations] ${pageId} is a draft again; putting it back`);
    try {
      const outcome = await publishPagePg(pageId, now);
      const at = now.toISOString();
      if (outcome.status === "published") {
        await updatePublication(useDb(), pageId, { revertedAt: at });
        result.restored.push(pageId);
      } else if (outcome.status === "held") {
        await editorialTx((tx, log) =>
          cascadeUnpublishEdgesPg(tx, log, pageId, actor),
        );
        await updatePublication(useDb(), pageId, {
          status: "held",
          reason: outcome.reason,
          heldAt: at,
          revertedAt: at,
          updatedAt: at,
        });
        result.held.push({ personId: pageId, reason: outcome.reason });
      }
    } catch (error) {
      console.error(`[declarations] putting ${pageId} back failed`, error);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// After an answer, an upload, and on the job's schedule
// ---------------------------------------------------------------------------

/** Compares the crops just settled with their pages, moves the other crops
 * of the people they reached to their new place in the readers' queue, then
 * takes up the publication queue once. What both the answer that settles a
 * crop and the upload of crops that come settled do. */
export async function matchAndDrainPg(
  extractIds: readonly string[],
  now: Date,
  limit: number,
  options: { maxPages?: number } = {},
): Promise<{ matched: MatchResult[]; drain: DrainResult }> {
  const matched: MatchResult[] = [];
  try {
    for (const id of unique(extractIds)) {
      matched.push(await matchPagesPg(id, now));
    }
  } finally {
    await requeueQuietlyPg(pagesNewlyReached(matched));
  }
  return { matched, drain: await drainPublicationsPg(now, limit, options) };
}

/** `sweepDeclarations`: what the job calls after every upload. */
export async function sweepDeclarationsPg(
  now: Date,
  limit: number,
  options: { batch?: number } = {},
): Promise<SweepResult & { touched: string[] }> {
  const sql = useDb();
  const size = options.batch ?? SWEEP_BATCH;
  const [unmatched, recheck] = await Promise.all([
    sql<{ id: string }[]>`
      SELECT id FROM declaration_extracts
      WHERE status = 'agreed' AND data #> '{agreed,kind}' = '"date"'::jsonb
        AND data -> 'pageMatch' = 'null'::jsonb
      ORDER BY id LIMIT ${size}`,
    sql<{ id: string }[]>`
      SELECT id FROM declaration_extracts
      WHERE status = 'agreed' AND data -> 'pageRecheck' = 'true'::jsonb
        AND jsonb_text(data -> 'pageCheckedAt') IS NOT NULL
      ORDER BY jsonb_text(data -> 'pageCheckedAt') COLLATE "C", id LIMIT ${size}`,
  ]);

  let changed = 0;
  const matched: MatchResult[] = [];
  try {
    for (const { id } of unmatched) {
      const match = await matchPagesPg(id, now);
      matched.push(match);
      if (match.changed) changed += 1;
    }
    for (const { id } of recheck) {
      const match = await matchPagesPg(id, now);
      matched.push(match);
      if (match.changed) {
        changed += 1;
      } else {
        await sql`
          UPDATE declaration_extracts
          SET data = jsonb_set(data, '{pageCheckedAt}', to_jsonb(${now.toISOString()}::text)),
              updated_at = clock_timestamp()
          WHERE id = ${id}`;
      }
    }
  } finally {
    await requeueQuietlyPg(pagesNewlyReached(matched));
  }

  const reverted = await restoreRevertedPg(now);
  const drain = await drainPublicationsPg(now, limit);
  return {
    checked: unmatched.length + recheck.length,
    changed,
    reverted,
    drain,
    touched: pagesTouched({ matched, drain, reverted }),
  };
}
