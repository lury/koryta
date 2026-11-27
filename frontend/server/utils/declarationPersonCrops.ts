import { createHash } from "node:crypto";
import {
  candidacyStatuses,
  cropOrder,
  DECLARATION_SEARCH_SINCE,
  localOffices,
  pageOutcomes,
  publicationHoldReasons,
  settledBy,
  type CandidacyStatus,
  type LocalOffice,
  type PageOutcome,
  type PersonDeclarationCrop,
  type PersonDeclarationLink,
  type PersonDeclarationSearch,
  type PersonPublicationState,
  type PublicationHoldReason,
  type SettledBy,
} from "~~/shared/declarations";
import { unitOf } from "./declarationMatch";

/** What /api/nodes/<id>/declaration-crops makes of the documents
 * server/db/declarationPages.ts reads: plain functions, no store. */

type Doc = Record<string, unknown>;

/** Links to declarations readers found by hand, one document a page and
 * address (`linkId`): what the crawl should fetch for a draft it has no crop
 * of. Server only, as every declarations collection is. */
export const LINKS = "declarationLinks";

/** Links one reader may give in a Warsaw day: far more than a sitting of
 * research by hand, few enough that one account cannot flood the crawl's
 * list. */
export const LINKS_PER_DAY = 50;

/** One document a page and address: the same link given twice, by anybody,
 * is one link. */
export function linkId(personId: string, url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return `${personId}_${hash}`;
}

/** The crops filed for the page, none an admin took back, the ones that
 * tell most first. A crop the cutter failed on stays: its declaration is
 * linked all the same. */
export function cropsOf(
  extracts: readonly { id: string; data: Doc }[],
  personId: string,
): PersonDeclarationCrop[] {
  return extracts
    .filter(({ data }) => data.status !== "withdrawn")
    .map(({ id, data }) => cropOf(id, data, personId))
    .sort((a, b) => cropOrder(a) - cropOrder(b) || b.answers - a.answers);
}

function cropOf(
  id: string,
  data: Doc,
  personId: string,
): PersonDeclarationCrop {
  const size = data.imageSize as PersonDeclarationCrop["imageSize"] | undefined;
  const outcome = (data.pageOutcomes as Record<string, unknown> | undefined)?.[
    personId
  ];
  const agreed = data.agreed as { value?: unknown; by?: unknown } | undefined;
  return {
    id,
    status: data.status as PersonDeclarationCrop["status"],
    failure: typeof data.failure === "string" ? data.failure : null,
    ...unitOf(data),
    documentUrl: String(data.url ?? ""),
    answers: Number(data.answerCount ?? 0),
    agreed: typeof agreed?.value === "string" ? agreed.value : null,
    agreedBy: (settledBy as readonly unknown[]).includes(agreed?.by)
      ? (agreed?.by as SettledBy)
      : null,
    outcome: (pageOutcomes as readonly unknown[]).includes(outcome)
      ? (outcome as PageOutcome)
      : null,
    imageSize: size?.date ? { date: size.date, name: size.name ?? null } : null,
  };
}

/** The status the page's record says something of a draft with: waiting in
 * the queue, taken up, held or declined; null for a publication that went
 * through, or a page public when its date matched. */
export function draftPublicationStatus(
  data: Doc | undefined,
): PersonPublicationState["status"] | null {
  if (!data) return null;
  const status =
    data.status === "held" && data.declinedAt ? "declined" : data.status;
  return status === "queued" ||
    status === "publishing" ||
    status === "held" ||
    status === "declined"
    ? status
    : null;
}

/** The record's state, with whether a paid post is on the page now; asked
 * only of a held page (`pagesWithAPublicPostPg`). */
export function publicationOf(
  data: Doc | undefined,
  paidPost: boolean,
): PersonPublicationState | null {
  const status = draftPublicationStatus(data);
  if (!status || !data) return null;
  const reason = (publicationHoldReasons as readonly unknown[]).includes(
    data.reason,
  )
    ? (data.reason as PublicationHoldReason)
    : null;
  return { status, reason, paidPost: status === "held" && paidPost };
}

/** The links readers gave for the page, the oldest first, the asking
 * reader's own marked so. */
export function linksOf(
  links: readonly Doc[],
  uid: string,
): PersonDeclarationLink[] {
  return links
    .map((data) => ({
      url: String(data.url ?? ""),
      at: isoOf(data.createdAt),
      mine: data.uid === uid,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** A stored instant as ISO, or "". */
function isoOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? "" : new Date(ms).toISOString();
}

const isLocalOffice = (value: unknown): value is LocalOffice =>
  (localOffices as readonly unknown[]).includes(value);

/** The election edges `searchesOf` needs the region names of: the targets
 * of the local wins since 2014. */
export function localWins(elections: readonly Doc[]) {
  return elections
    .filter(
      (edge) =>
        edge.elected === true &&
        edge.deleted !== true &&
        isLocalOffice(edge.position) &&
        Number(String(edge.start_date ?? "").slice(0, 4)) >=
          DECLARATION_SEARCH_SINCE,
    )
    .map((edge) => ({
      year: Number(String(edge.start_date).slice(0, 4)),
      office: edge.position as LocalOffice,
      region: String(edge.target ?? ""),
    }));
}

/**
 * The local elections the person won since 2014, newest first: each
 * candidacy the crawler looked for (`declarationCandidacies`, the won ones
 * of the terms it searches), and each win on the page it never looked for.
 *
 * The two meet by year, office and place: the crawler files a candidacy
 * under its gmina's six digits, the page under the powiat (`teryt` and four
 * digits) or, for a sejmik, the województwo (two), which the gmina's digits
 * start with. A win the crawler never looked for is named after that region,
 * as the page's history names it.
 */
export function searchesOf(
  candidacies: readonly Doc[],
  wins: ReturnType<typeof localWins>,
  regionNames: ReadonlyMap<string, string>,
): PersonDeclarationSearch[] {
  const searched: { search: PersonDeclarationSearch; teryt: string }[] =
    candidacies.flatMap((data) => {
      const year = Number(data.year);
      if (!isLocalOffice(data.office) || !(year >= DECLARATION_SEARCH_SINCE)) {
        return [];
      }
      const bipUrls = Array.isArray(data.bipUrls) ? data.bipUrls : [];
      return [
        {
          search: {
            year,
            office: data.office,
            unit: String(data.unitName ?? `TERYT ${String(data.teryt ?? "")}`),
            status: (candidacyStatuses as readonly unknown[]).includes(
              data.status,
            )
              ? (data.status as CandidacyStatus)
              : null,
            reason: typeof data.reason === "string" ? data.reason : null,
            files: Number(data.files ?? 0),
            bipUrl: typeof bipUrls[0] === "string" ? bipUrls[0] : null,
          },
          teryt: String(data.teryt ?? ""),
        },
      ];
    });

  const unsearched: PersonDeclarationSearch[] = wins
    .filter(
      (win) =>
        !searched.some(
          ({ search, teryt }) =>
            search.year === win.year &&
            search.office === win.office &&
            teryt.startsWith(win.region.replace(/^teryt/, "")),
        ),
    )
    .map((win) => ({
      year: win.year,
      office: win.office,
      unit: regionNames.get(win.region) ?? win.region,
      status: null,
      reason: null,
      files: 0,
      bipUrl: null,
    }));

  const seen = new Set<string>();
  return [...searched.map(({ search }) => search), ...unsearched]
    .filter((search) => {
      // Two by-elections of one term, or a win the page lists twice.
      const key = `${search.year}|${search.office}|${search.unit}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.year - a.year);
}
