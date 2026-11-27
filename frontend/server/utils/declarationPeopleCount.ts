import { warsawDate } from "~~/shared/dates";
import {
  isPublicationStatus,
  millisOf,
  personEntrySchema,
  type PersonEntry,
  type PublicationState,
} from "~~/shared/declarationPeople";
import type { DeclarationFactsIngest } from "~~/shared/declarations";

type Data = Record<string, unknown>;

/**
 * The people snapshot, counted on the site (decision on 2026-11-17): whole
 * from the facts the night sends (`countDeclarationPeople`), and for the
 * people a daytime event touches (`restageDeclarationPeople`): a reading
 * settles, a page is published or held, an admin decides a crop, an upload
 * brings crops. The rules are shared/declarationPeople.ts.
 *
 * Each counted person's entry is kept in the `declaration_people` row
 * `shard-<n>`, what re-staging them needs; the snapshot is derived from all
 * of them into `stats/declaration_people`, which the GET reads. The reads
 * and writes are server/db/declarationPeopleCount.ts; these are the parts
 * that need no store.
 *
 * The night counts on autopush, and readers and admins move people on prod
 * too, each on its own release. Re-staging writes nothing while any entry
 * does not read under this release's strict schema: it would rewrite the
 * shards and the snapshot without them. The next count writes them all.
 */

export const PEOPLE_META = "meta";
export const PEOPLE_SHARDS = 8;

/** The shard a page's entry is kept in: FNV-1a of its id, the same on every
 * instance and release. */
export function shardOf(pageId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < pageId.length; i++) {
    hash ^= pageId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % PEOPLE_SHARDS;
}

export function mergedInto(node: Data | null | undefined): string | null {
  const next = node?.merged_into;
  return typeof next === "string" && next ? next : null;
}

/** The entries a shard holds, and how many do not read as one. */
export function entriesOf(data: Data | undefined): {
  entries: [string, PersonEntry][];
  unread: number;
} {
  const stored: unknown = data?.entries;
  const entries: [string, PersonEntry][] = [];
  let unread = 0;
  if (stored && typeof stored === "object") {
    for (const [page, raw] of Object.entries(stored)) {
      const parsed = personEntrySchema.safeParse(raw);
      if (parsed.success) entries.push([page, parsed.data]);
      else unread += 1;
    }
  }
  return { entries, unread };
}

/** The entries by shard, as each shard document is written. */
export function shardData(
  entries: Iterable<readonly [string, PersonEntry]>,
): { entries: Record<string, PersonEntry> }[] {
  const shards = Array.from({ length: PEOPLE_SHARDS }, () => ({
    entries: {} as Record<string, PersonEntry>,
  }));
  for (const [page, entry] of entries) {
    shards[shardOf(page)]!.entries[page] = entry;
  }
  return shards;
}

/** The Warsaw day of a stored instant: a Timestamp, a Date or ISO text. */
function warsawDayOf(value: unknown): string | null {
  const ms = millisOf(value);
  return ms === null ? null : warsawDate(new Date(ms));
}

export function publicationOf(data: Data | undefined): PublicationState | null {
  const status = data?.status;
  if (!isPublicationStatus(status)) return null;
  return {
    status,
    reason:
      typeof data?.reason === "string" && data.reason ? data.reason : null,
    publishedOn: warsawDayOf(data?.publishedAt),
    ...(data?.declinedAt ? { declined: true } : {}),
  };
}

/** Whether the facts are older than the ones counted last, and not forced. */
export function olderThanCounted(
  meta: Data | undefined,
  body: Pick<DeclarationFactsIngest, "generation" | "force">,
): boolean {
  if (body.force) return false;
  const counted =
    typeof meta?.generation === "string" ? Date.parse(meta.generation) : NaN;
  return Number.isFinite(counted) && Date.parse(body.generation) < counted;
}

export function refuseOlder(
  meta: Data | undefined,
  body: DeclarationFactsIngest,
): void {
  if (olderThanCounted(meta, body)) {
    throw createError({
      statusCode: 409,
      statusMessage: "Conflict",
      message: `facts of ${body.generation} are older than the ones counted (${String(meta?.generation)}); send force to count them`,
    });
  }
}
