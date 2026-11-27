import { createHash } from "node:crypto";
import type { Edge, Node } from "~~/shared/model";
import { pageIsPublic } from "../../shared/model";

/** Puts a value into the shape Firestore will accept.
 *
 * Two things are not storable: `undefined`, anywhere, and an array whose
 * element is itself an array — Firestore has no array-of-arrays. Null and
 * undefined are dropped; a directly nested array becomes a map keyed by index,
 * which is the only shape left that keeps the order.
 *
 * A *top-level* array field is left as an array, and that distinction matters:
 * `parties`, `activity` and `categories` are queried with `array-contains`,
 * which matches nothing against a map and does not raise, so rewriting them
 * makes the node vanish from the filter rather than fail loudly. Until
 * 2026-07-28 this function rewrote every array it saw, which is how 461 people
 * ended up unreachable by any party filter — see
 * `scripts/migrate/unwrap-array-fields.ts`, which repairs the ones already
 * written, and `data/pipelines/src/tests/pipelines/test_invariants.py`.
 */
export function sanitizeFirestoreData<T>(
  data: Record<string, unknown> | T,
): Record<string, unknown> | T;

export function sanitizeFirestoreData<T>(
  data: Record<string, unknown> | T | undefined | null,
): Record<string, unknown> | T | undefined {
  return sanitizeValue(data, false) as Record<string, unknown> | T | undefined;
}

/** @param insideArray whether `value` is an element of an array, in which case
 * an array of its own has nowhere to go and has to become a map. */
function sanitizeValue(value: unknown, insideArray: boolean): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return value;

  // Firestore's own value types - Timestamp, DocumentReference, GeoPoint,
  // FieldValue, Buffer - are objects, but they are values rather than maps, and
  // the generic branch below would take one apart into its private fields: a
  // `Timestamp` became `{_seconds, _nanoseconds}`, which is a map as far as
  // Firestore is concerned. Maps sort *after* every timestamp, so an article
  // dated that way pinned itself above every properly dated one on /zrodla's
  // `orderBy("publishedDate", "desc")`, read back undated wherever `toDate` is
  // called, and looked "already dated" to backfill-article-dates.ts forever.
  // Every article node written through `ensureArticleNode` was one of these.
  //
  // Told apart by prototype rather than by `instanceof` against the imported
  // classes. Data destined for Firestore is plain objects all the way down - it
  // comes from `doc.data()`, from a zod parse, from ld+json - so a custom
  // prototype is the thing that marks a value type, and testing for it needs no
  // list to keep in step with the SDK. It also keeps this working under a test
  // that mocks the module, where `Timestamp` is not a constructor at all.
  // Arrays are checked first: one has a prototype of its own and would
  // otherwise be handed back whole, unsanitized.
  if (Array.isArray(value)) {
    // Elements that sanitize away leave no hole: Firestore rejects an
    // `undefined` element outright, and the previous implementation dropped
    // them too, by way of the map it built.
    const items = value
      .map((item) => sanitizeValue(item, true))
      .filter((item) => item !== undefined);
    if (!insideArray) return items;
    return Object.fromEntries(
      items.map((item, index) => [String(index), item]),
    );
  }

  if (!isPlainObject(value)) return value;

  // The fields of an object are not array elements, however deeply that object
  // is nested — only an array directly inside an array is a problem.
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, val]) => [key, sanitizeValue(val, false)])
      .filter(([, val]) => val !== undefined),
  );
}

/** Whether a value is a map to descend into, as opposed to a value to keep.
 *
 * `Object.create(null)` counts: `doc.data()` never returns one, but a caller
 * building a payload with it means a bag of fields, not a value type. */
function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Computed or bookkeeping fields that belong to the node, not to a revision.
 * They are regenerated (search chunks, stats) or managed elsewhere (revision
 * pointers, votes), so copying them into revision data would freeze a stale
 * snapshot. */
export const INTERNAL_FIELDS = new Set([
  "stats",
  "revision_id",
  "published",
  "revisions",
  "votes",
  "id",
  "deleted",
  "delete_reason",
  "visibility",
  "merged_into", // where a duplicate page's readers are sent, see utils/merge
  "needs_split", // an admin's note that the page is two people, see nodes/split
  "nameChunksLower", // used for search indexing
  // When the page last visibly changed, see shared/lastmod.ts. Stamped by the
  // write rather than stated by a revision, so leaving it out would carry it
  // into every revision's `data` through `withoutInternalFields` - and from
  // there back onto the node whenever an old revision was re-approved,
  // restoring a stale date over the live one.
  "content_changed_at",
]);

/** A document's fields as a revision states them: what it owns left out.
 *
 * Dropping `revision_id` in particular is what keeps a proposal honest: a
 * revision is a statement of what the document should say, and carrying the
 * pointer to the revision it currently says it by would freeze a stale answer
 * into it. Whether the change publishes is decided at write time, not copied
 * in from the past.
 */
export function withoutInternalFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!INTERNAL_FIELDS.has(key)) {
      base[key] = value;
    }
  }
  return base;
}

/** The half of a stored document that `withoutInternalFields` leaves behind.
 *
 * The two partition it: a revision describes the data, and this is everything
 * else the document owns - the counters the triggers maintain, the votes,
 * whether the page is live, whether it has been removed. None of it is in any
 * revision, and a revision is written to its target with `set`, so a write that
 * does not put this back does not leave those fields alone: it deletes them.
 *
 * `stats` is the one that hurts. `/api/nodes` filters every listing on
 * `stats.isApproved == true`, and a Firestore equality filter does not match a
 * document that lacks the field at all - so a re-ingested person kept their
 * page, kept their visibility, and disappeared from every list that led to it.
 * The trigger in `functions/src/nodes.ts` only rewrites `stats.isApproved` when
 * visibility *changes*, so once visibility is carried across correctly it stops
 * covering for this.
 */
export function nodeOwnedFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const owned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (INTERNAL_FIELDS.has(key)) {
      owned[key] = value;
    }
  }
  return owned;
}

/** The counters a node has to carry before anything can find it, for a node
 * whose counters nothing has computed yet.
 *
 * `/api/stats/computeNodes` is what really works these out, and it writes them
 * for every node - but it is an admin endpoint somebody runs by hand, so
 * between two runs every node created in between carries no `stats` at all.

 * Only fields that are missing are filled in. A real count computed by
 * `computeNodes`, or one carried across from the stored document, always wins:
 * zero here means "nobody has counted yet", never "counted, and it is none".
 */
export function withSeededNodeStats(
  targetData: Record<string, unknown>,
): Record<string, unknown> {
  const stats = {
    ...((targetData.stats as Record<string, unknown> | undefined) ?? {}),
  };
  if (stats.nodeGroupSize === undefined) stats.nodeGroupSize = 0;
  if (stats.isApproved === undefined)
    stats.isApproved = pageIsPublic(targetData);
  // People only, because an extracted fact is matched to a person node and to
  // nothing else. /eksploruj/tabela orders by this one, and an `orderBy` drops
  // a document that lacks the field instead of sorting it last - so a person
  // ingested between two `computeNodes` runs would not be low down that table,
  // they would be absent from it.
  if (targetData.type === "person" && stats.factsCount === undefined) {
    stats.factsCount = 0;
  }
  return { ...targetData, stats };
}

export interface RevisionWriteOptions {
  /** Written by a pipeline rather than by a person. */
  automatic?: boolean;
  /** Approve the revision as it is written, and point the target at it. */
  approve?: boolean;
  /** The document being overwritten, where the caller is updating one that
   * already exists rather than creating it. Everything the document owns rather
   * than states is taken from here - see `nodeOwnedFields`, and note that this
   * includes its current visibility, so an update that says nothing about
   * `published` leaves it alone rather than deleting it. */
  stored?: Record<string, unknown>;
  /** Visibility, where the caller decides it rather than carrying the stored
   * document's: a document being created has none to carry, and a caller
   * publishing or hiding one is making exactly this decision. */
  published?: boolean;
}

/** Value equality for what a Firestore document holds.
 *
 * `JSON.stringify` will not do. Property order there follows insertion, and a
 * revision is assembled by spreading a payload over the stored document, so a
 * field the payload merely restates moves to the end and every comparison would
 * report a change. Firestore's own values - `Timestamp`, `DocumentReference`,
 * `GeoPoint` - are class instances that compare by identity and carry an
 * `isEqual` of their own, which is used where both sides have one: a
 * `Timestamp` stringifies to a shape that happens to work, and a
 * `DocumentReference` to one deep enough that stringifying it throws.
 */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return (
      a.length === b.length && a.every((item, i) => sameStoredValue(item, b[i]))
    );
  }

  const isEqual = (a as { isEqual?: unknown }).isEqual;
  if (typeof isEqual === "function") {
    return (
      typeof (b as { isEqual?: unknown }).isEqual === "function" &&
      isEqual.call(a, b) === true
    );
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(right, key) && sameStoredValue(left[key], right[key]),
  );
}

/** Whether a stored document says exactly what a revision says.
 *
 * The question to ask before calling a revision the one a document is shown
 * by - before its `revision_id` points there, or it is marked approved on the
 * strength of the document. A revision written onto its document passes:
 * the document is its data plus the fields the document owns, which
 * `withoutInternalFields` takes off again. A proposal does not until somebody
 * applies it, because filing one leaves the document alone, so the committee or the correction it carries is exactly what the document
 * lacks.
 *
 * Equal, rather than "every field the revision states is on the document",
 * because a proposal can take a field away: a contributor unticking a win
 * files a revision with no `elected` at all, which every field of a candidacy
 * still carrying `elected: true` would agree with. The price is 167 draft
 * edges on the 10-09 export whose `update_time` and `update_user` an old edit
 * path stamped straight onto the edge: none of their revisions states those,
 * so none is held, and publishing one leaves it pointing at no revision, which
 * is how an edge written before revisions has always been published.
 */
export function holdsRevision(
  stored: Record<string, unknown>,
  data: unknown,
): boolean {
  return sameStoredValue(
    withoutInternalFields((data ?? {}) as Record<string, unknown>),
    withoutInternalFields(stored),
  );
}

/** The document id a standing proposal is stored under.
 *
 * Derived from the target and what is being proposed, so restating the same
 * offer lands on the same document. Two genuinely different proposals about one
 * document stay two documents, which is what a reviewer needs to see.
 *
 * `key` is what "the same offer" means, when the caller has a better answer
 * than the literal content. An edge does: PKW writes one committee in whatever
 * case the spreadsheet had, so hashing the raw text would file the same
 * proposal again under every spelling, while `edgeIdentity` already folds that
 * away. Without one the content is used, with its keys sorted - it is assembled
 * by spreading objects together, and property order there follows insertion,
 * which the id should not depend on.
 */
export function proposalId(
  targetId: string,
  data: Record<string, unknown> | Node | Edge,
  key?: string,
): string {
  const subject =
    key ??
    JSON.stringify(
      Object.entries(data as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  const digest = createHash("sha1")
    .update(subject)
    .digest("base64url")
    .slice(0, 10);
  return `proposal_${targetId}_${digest}`;
}

/** What a proposal write (server/db/proposals.ts) did with an offer. */
export type ProposalOutcome =
  /** Nothing stood at its address, so it is filed there now - or, for a
   * person asking again what a reviewer has already answered, under an
   * address of its own. */
  | "created"
  /** A proposal still waiting stood there saying something else, and now
   * says this. */
  | "refreshed"
  /** A proposal still waiting already says exactly this. Nothing written. */
  | "unchanged"
  /** A reviewer has approved or rejected the pipeline's proposal. Nothing
   * written: the same ask is not asked again. */
  | "decided";
