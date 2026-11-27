import {
  edgeIdentity,
  edgeRelation,
  edgeSemantics,
  enrichedEdge,
  meetsEnrichFloor,
  type EdgeLike,
} from "./edges";
import { withoutInternalFields } from "./revisions";
// Imported explicitly rather than left to Nuxt's auto-import: this module is
// also loaded by scripts/migrate/merge-duplicate-people.ts under plain tsx,
// where there is no auto-import and a missing one is a ReferenceError at
// runtime that typecheck cannot see.
import { sortParties } from "../../shared/misc";
import { asArray } from "../../shared/model";
import { isPipelineUid } from "../../shared/stats";

/** What becomes of one relation when the page it hangs off is merged away.
 *
 * - `moved`: the survivor does not say this, so the relation is re-pointed at
 *   it and kept. The ordinary case.
 * - `collapsed`: the survivor already says exactly this, and the edge type is
 *   one where saying it twice asserts nothing new. Removed.
 * - `review`: the survivor already says exactly this, and the type is one where
 *   identical fields are *not* evidence of one fact. Kept, and reported - see
 *   `identicalMeansSame` in `server/utils/edges.ts`, which is the same
 *   judgement `scripts/migrate/dedupe-edges.ts` makes.
 * - `enriched`: the survivor states a poorer version of this - a candidacy with
 *   no committee against one with it - so the two are one fact and the better
 *   informed of them wins. The survivor's relation takes what this one knows and
 *   this one goes. Only for an `enrichable` type, where a blank means "not known
 *   yet" rather than "there was none".
 * - `self`: both ends were the duplicate, so the merge would leave the survivor
 *   pointing at itself. Removed; a loop is not a fact about anybody.
 */
export type MergeVoteMove = {
  /** The vote document on the duplicate, which is deleted once it is re-filed. */
  from_id: string;
  /** `${survivor}_${uid}`, the id the same vote takes on the surviving page. */
  to_id: string;
  user: string;
};

export type MergeDisposition =
  "moved" | "collapsed" | "enriched" | "review" | "self";

export type MergeEdgePlan = {
  edge_id: string;
  type: string;
  disposition: MergeDisposition;
  /** Which end of the relation named the duplicate. */
  role: "source" | "target" | "both";
  /** The survivor's relation that already says this, for a `collapsed`,
   * `enriched` or `review` verdict. */
  duplicate_of?: string;
  /** What the survivor's relation should say once this one's fields are folded
   * into it. Only on an `enriched` verdict. */
  enriches_into?: Record<string, unknown>;
};

export type MergePlan = {
  duplicate_id: string;
  survivor_id: string;
  /** Both names, for a dry run to print something a human can check. */
  duplicate_name?: string;
  survivor_name?: string;
  edges: MergeEdgePlan[];
  counts: Record<MergeDisposition, number>;
  /** Human votes on the duplicate that the survivor has none of, by the id the
   * moved document takes. See `votesToMove`. */
  votes: MergeVoteMove[];
  /** What the duplicate knows and the survivor does not, to be written onto the
   * survivor rather than left on the tombstone. See `carriedFields`. */
  carried: Record<string, unknown>;
};

/** The relation as it would read once the duplicate's id is replaced. */
function remapped(
  stored: Record<string, unknown>,
  duplicateId: string,
  survivorId: string,
): EdgeLike {
  return {
    ...stored,
    source: stored.source === duplicateId ? survivorId : stored.source,
    target: stored.target === duplicateId ? survivorId : stored.target,
  } as EdgeLike;
}

/** The votes worth re-filing onto the survivor, and only those.
 *
 * Human votes only. A model's vote is regenerated every scoring run and there
 * are six models; on the 171 pairs stored on 2026-08-31 they account for 535 of
 * the 565 votes, and carrying them would put a stale score on the survivor that
 * the next run overwrites anyway - while briefly making `stats.votes.models`
 * read as two models' worth of one. The 30 human votes are the ones nothing
 * regenerates.
 *
 * A vote already cast by that person on the survivor stops the move. The
 * document id is `${nodeId}_${userUid}`, so the two would collide, and the
 * vote on the page that survives is the one to keep: it is about the page the
 * reader will actually see. The duplicate's is left where it is rather than
 * deleted, so the record of what they thought is still readable on the
 * tombstone.
 */
export function votesToMove(
  duplicateVotes: { id: string; user: string }[],
  survivorVotes: { user: string }[],
  survivorId: string,
): MergeVoteMove[] {
  const alreadyVoted = new Set(survivorVotes.map((v) => v.user));
  return duplicateVotes
    .filter((v) => !isPipelineUid(v.user))
    .filter((v) => !alreadyVoted.has(v.user))
    .map((v) => ({
      from_id: v.id,
      to_id: `${survivorId}_${v.user}`,
      user: v.user,
    }));
}

/** Fields the merge moves across, and how.
 *
 * Relations are re-pointed, so nothing about them depends on which page wins.
 * Fields are not, and until they were carried the choice of survivor silently
 * decided how much the site still knew: against the 171 duplicate pairs stored
 * on 2026-08-31, 22 of them had party lists on the page that was about to
 * become a tombstone, and reordering the survivor rule to prefer the fuller
 * name took that to 71 - because the fuller name is usually the older page, and
 * the newer one is where the recent upload put the parties. Carrying them makes
 * the question moot rather than answering it better.
 *
 * `parties` is a set union, for the reason `updatedPerson` gives: two runs can
 * each find a different half of somebody's career and neither is a correction
 * of the other. Everything else is filled in only where the survivor has
 * nothing, so the surviving page never has a value overwritten - a merge is not
 * the place to overrule a reviewer.
 *
 * `name` is deliberately not carried. Which page survives *is* the decision
 * about what it is called, and renaming it here would quietly undo the choice
 * an admin just made in the dialog.
 */
export function carriedFields(
  duplicate: Record<string, unknown>,
  survivor: Record<string, unknown>,
): Record<string, unknown> {
  const carried: Record<string, unknown> = {};

  const parties = sortParties(
    new Set([
      ...asArray<string>(survivor.parties as string[]),
      ...asArray<string>(duplicate.parties as string[]),
    ]),
  );
  if (parties.length > asArray<string>(survivor.parties as string[]).length) {
    carried.parties = parties;
  }

  for (const [key, value] of Object.entries(withoutInternalFields(duplicate))) {
    if (key === "parties" || key === "name" || key === "type") continue;
    if (value === undefined || value === null || value === "") continue;
    const held = survivor[key];
    if (held === undefined || held === null || held === "")
      carried[key] = value;
  }

  return carried;
}

/** A relation as read. */
export type StoredEdgeDoc = { id: string; data(): Record<string, unknown> };

/** Where each of `moving` ends up once its `fromId` end reads `toId` instead.
 *
 * Pure, and shared by the merge and the split: both are the same question -
 * this relation is about to name a different page, does that page already say
 * it - and answering it two ways would let a merge remove what a split had just
 * decided to keep.
 *
 * `destination` is every relation the receiving page already holds, so the
 * count of what it says is the count this reasons against.
 */
export function planEdgeMoves(
  moving: StoredEdgeDoc[],
  destination: StoredEdgeDoc[],
  fromId: string,
  toId: string,
): MergeEdgePlan[] {
  // How many times the receiving page already asserts each thing. An occurrence
  // type may legitimately assert one twice, so this counts rather than just
  // records.
  const held = new Map<string, string[]>();
  //: The receiving page's relations by `(target, type)`, which is as close as
  //: two can be without asserting the same thing - that is the set `enriches`
  //: has to be searched over, because an edge that fills in a committee has a
  //: different identity from the one it is filling in.
  const byPair = new Map<string, { id: string; stored: EdgeLike }[]>();
  const claimed = new Set<string>();
  for (const doc of destination) {
    const stored = doc.data();
    if (stored.deleted === true) continue;
    const identity = edgeIdentity(stored as EdgeLike);
    held.set(identity, [...(held.get(identity) ?? []), doc.id]);
    const pair = `${stored.target}\u0000${stored.type}`;
    byPair.set(pair, [
      ...(byPair.get(pair) ?? []),
      { id: doc.id, stored: stored as EdgeLike },
    ]);
  }

  const edges: MergeEdgePlan[] = [];
  // Sorted so a dry run predicts the run that follows it, the way
  // `findEdgeMatches` sorts for the same reason.
  for (const doc of [...moving].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    const stored = doc.data();
    if (stored.deleted === true) continue;

    const role: MergeEdgePlan["role"] =
      stored.source === fromId && stored.target === fromId
        ? "both"
        : stored.source === fromId
          ? "source"
          : "target";

    const next = remapped(stored, fromId, toId);
    const type = String(stored.type);

    if (next.source === next.target) {
      edges.push({ edge_id: doc.id, type, role, disposition: "self" });
      continue;
    }

    const identity = edgeIdentity(next);
    const alreadySaid = held.get(identity) ?? [];

    if (alreadySaid.length > 0) {
      const { identicalMeansSame } = edgeSemantics(next.type);
      const duplicate_of = alreadySaid[0];
      if (identicalMeansSame) {
        edges.push({
          edge_id: doc.id,
          type,
          role,
          disposition: "collapsed",
          duplicate_of,
        });
        continue;
      }
      // Kept, and counted as held: two of the moving page's candidacies that
      // look alike are still two, and only the first of them is worth
      // reporting against the receiving page's one.
      held.set(identity, [...alreadySaid, doc.id]);
      edges.push({
        edge_id: doc.id,
        type,
        role,
        disposition: "review",
        duplicate_of,
      });
      continue;
    }

    // Nothing says exactly this, but the survivor may say a better-informed
    // version of it. `TY8bMoaheJqzINdOTIoJ` held three candidacies with no
    // party and no committee against the same three on `XGPwmZjJII22uoMWvZWz`
    // with both, and identity alone cannot see that they are one fact: party
    // and committee are discriminators, so the poorer copy hashes elsewhere and
    // lands beside the richer one. This is the same question
    // `findEdgeOrCreate` asks of an incoming payload row, asked of a relation
    // arriving from the other page, and answered by the same function.
    const { enrichable } = edgeSemantics(next.type);
    if (enrichable) {
      const candidates = (byPair.get(`${next.target}\u0000${next.type}`) ?? [])
        .filter((c) => !claimed.has(c.id))
        .filter((c) => meetsEnrichFloor(c.stored));
      // Claimed one for one: two candidacies the survivor holds are two facts,
      // and letting both of the duplicate's fold onto the first would lose one.
      const match = candidates.find(
        (c) => edgeRelation(c.stored, next) !== "conflict",
      );
      if (match) {
        claimed.add(match.id);
        const relation = edgeRelation(match.stored, next);
        if (relation === "same") {
          edges.push({
            edge_id: doc.id,
            type,
            role,
            disposition: "collapsed",
            duplicate_of: match.id,
          });
          continue;
        }
        edges.push({
          edge_id: doc.id,
          type,
          role,
          disposition: "enriched",
          duplicate_of: match.id,
          // Both sides stripped. `next` is the stored document as it was read,
          // so it still carries `revision_id`, which `enrichedEdge` would copy
          // across because the stripped survivor lacks one.
          enriches_into: enrichedEdge(
            withoutInternalFields(match.stored as Record<string, unknown>),
            withoutInternalFields(next as Record<string, unknown>) as EdgeLike,
          ),
        });
        continue;
      }
    }

    held.set(identity, [doc.id]);
    byPair.set(`${next.target}\u0000${next.type}`, [
      ...(byPair.get(`${next.target}\u0000${next.type}`) ?? []),
      { id: doc.id, stored: next },
    ]);
    edges.push({ edge_id: doc.id, type, role, disposition: "moved" });
  }

  return edges;
}

/** How many of each verdict a plan reached. */
export function countDispositions(
  edges: MergeEdgePlan[],
): Record<MergeDisposition, number> {
  const counts: Record<MergeDisposition, number> = {
    moved: 0,
    collapsed: 0,
    enriched: 0,
    review: 0,
    self: 0,
  };
  for (const edge of edges) counts[edge.disposition]++;
  return counts;
}

/** A page as read. */
export type StoredNodeDoc = {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
};

/** Why a merge cannot be made, or nothing. */
export function mergeRefusal(
  plan: { duplicate_id: string; survivor_id: string },
  duplicate: StoredNodeDoc | undefined,
  survivor: StoredNodeDoc | undefined,
): string | undefined {
  if (plan.duplicate_id === plan.survivor_id) {
    return "Nie można scalić strony z nią samą.";
  }
  if (!duplicate?.exists) {
    return `Nie ma strony o id: ${plan.duplicate_id}`;
  }
  if (!survivor?.exists) {
    return `Nie ma strony o id: ${plan.survivor_id}`;
  }

  const duplicateData = duplicate.data() ?? {};
  const survivorData = survivor.data() ?? {};

  if (duplicateData.type !== survivorData.type) {
    return (
      `Strony są różnego rodzaju: ${duplicateData.type} i ` +
      `${survivorData.type}. Scalać można tylko strony tego samego rodzaju.`
    );
  }
  if (typeof duplicateData.merged_into === "string") {
    return `Strona ${plan.duplicate_id} została już scalona z ${duplicateData.merged_into}.`;
  }
  return undefined;
}
