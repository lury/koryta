import {
  settledBy,
  type DeclarationOverview,
  type DeclarationPublicationRow,
  type DeclarationReviewRow,
  type ExtractStatus,
  type PublicationHoldReason,
  type SettledBy,
} from "~~/shared/declarations";
import { instantOf } from "../db/editorial";

/** The overview's pure parts: the rows and how they add up. The reads are
 * server/db/declarationOverview.ts. */

type Data = Record<string, unknown>;
/** A stored document and its id. */
export type StoredDoc = { id: string; data: Data };

/** Why a search found nothing, in the crawler's words
 * (jobs/bip_crawler/people.py). Counted one by one so an unknown code still
 * shows, as what is left over. */
export const NOT_FOUND_REASONS = [
  "no_seed",
  "unreachable",
  "robots",
  "no_declarations",
  "not_listed",
  "download_failed",
  "timeout",
  "error",
] as const;

/** Why nothing could be cut from a file, in the cutter's words. */
export const FAILED_REASONS = [
  "blank_form",
  "scan_in_word",
  "no_label",
  "blank_field",
  "no_date_line",
  "not_fetched",
  "unreadable",
] as const;

export const LIST_SIZE = 20;
export const DAYS = 30;

/** The overview but for the lists an admin works through, and the counts
 * read off them. */
export type OverviewTotals = Omit<
  DeclarationOverview,
  "lists" | "publications"
> & {
  publications: Omit<
    DeclarationOverview["publications"],
    "held" | "setAside" | "heldBy"
  >;
};

/** The overview from its counts and the lists read at `at`. What waits is
 * read off the pages, row by row, so it is the lists that say: every hold is
 * listed. */
export function withLists(
  totals: OverviewTotals,
  lists: DeclarationOverview["lists"],
  at: Date,
): DeclarationOverview {
  // Somebody published since the counts were taken has left the held lists
  // already: counted as published too, so the chain adds up meanwhile.
  const since = lists.recent.filter((row) => row.at > totals.at).length;
  return {
    ...totals,
    at: at.toISOString(),
    publications: {
      ...totals.publications,
      published: totals.publications.published + since,
      held: lists.held.length,
      setAside: lists.setAside.length,
      heldBy: countByReason(lists.held),
    },
    lists,
  };
}

export type PersonFacts = {
  id: string;
  name: string;
  published: boolean;
  birthDate: string | null;
  /** Merged into another page or removed: a record left on it is nobody's. */
  gone: boolean;
};

export function isoOf(value: unknown): string {
  const at = instantOf(value);
  if (at) return at.toISOString();
  return typeof value === "string" ? value : "";
}

/** Who settled a crop's date, as its row says it: null for a crop nothing
 * settled, or for a writer this does not know. */
function settledByOf(value: unknown): SettledBy | null {
  return (settledBy as readonly unknown[]).includes(value)
    ? (value as SettledBy)
    : null;
}

export function reviewRow(
  doc: StoredDoc,
  people: Map<string, PersonFacts>,
): DeclarationReviewRow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = doc.data as Record<string, any>;
  const unit = Array.isArray(data.units) ? data.units[0] : undefined;
  const readings = Object.entries(
    (data.answers?.readings as Record<string, number> | undefined) ?? {},
  )
    .map(([value, readers]) => ({ value, readers }))
    .sort((a, b) => b.readers - a.readers);
  return {
    id: doc.id,
    unit: unit?.unitName ?? (unit?.teryt ? `TERYT ${unit.teryt}` : ""),
    office: unit?.office ?? null,
    declarationYear: data.declarationYear ?? null,
    documentUrl: String(data.url ?? ""),
    status: data.status as ExtractStatus,
    readings,
    unreadable:
      Number(data.answers?.unreadable ?? 0) + Number(data.answers?.empty ?? 0),
    agreed: (data.agreed?.value as string | undefined) ?? null,
    agreedBy: settledByOf(data.agreed?.by),
    machine: data.machine
      ? {
          birthDate: data.machine.birthDate ?? null,
          confidence: data.machine.confidence ?? null,
          method: data.machine.method ?? null,
        }
      : null,
    people: ((data.personIds as string[] | undefined) ?? []).flatMap((id) => {
      const person = people.get(id);
      return person
        ? [
            {
              id: person.id,
              name: person.name,
              published: person.published,
              birthDate: person.birthDate,
            },
          ]
        : [];
    }),
    updatedAt: isoOf(data.updatedAt),
  };
}

/** `paid` is for a held page: the pages with a paid public post on them. A
 * held record an admin declined is a row of its own status. Its time is when
 * it came to the state it is listed in. */
export function publicationRow(
  doc: StoredDoc,
  people: Map<string, PersonFacts>,
  paid?: ReadonlySet<string>,
): DeclarationPublicationRow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = doc.data as Record<string, any>;
  const first = Array.isArray(data.declarations) ? data.declarations[0] : {};
  const declined = data.status === "held" && !!data.declinedAt;
  return {
    personId: doc.id,
    name: people.get(doc.id)?.name ?? doc.id,
    status: declined ? "declined" : data.status,
    reason: (data.reason as PublicationHoldReason | undefined) ?? null,
    pagePublic: people.get(doc.id)?.published ?? false,
    ...(paid ? { paidPost: paid.has(doc.id) } : {}),
    at: isoOf(
      declined
        ? data.declinedAt
        : data.status === "held"
          ? (data.heldAt ?? data.queuedAt)
          : data.status === "published"
            ? data.publishedAt
            : data.queuedAt,
    ),
    unit: String(first?.unit ?? ""),
    documentUrl: String(first?.url ?? ""),
    edges: {
      published: Array.isArray(data.edges?.published)
        ? data.edges.published.length
        : 0,
      held: Array.isArray(data.edges?.held) ? data.edges.held.length : 0,
    },
    pressed: typeof data.pressedBy === "string" && data.pressedBy !== "",
    ...(data.handPublished ? { byHand: true } : {}),
  };
}

/** What the rows are held for, most first. */
function countByReason(
  rows: readonly DeclarationPublicationRow[],
): DeclarationOverview["publications"]["heldBy"] {
  const counts = new Map<PublicationHoldReason, number>();
  for (const { reason } of rows) {
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

/** Millis of a stored instant, 0 where there is none. */
export function millisOf(value: unknown): number {
  const iso = isoOf(value);
  return iso ? Date.parse(iso) : 0;
}
