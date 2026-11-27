import { z } from "zod";
import { createError } from "h3";
import { isAutomatedUid, isPipelineUid } from "~~/shared/stats";
import type { VoteDocument } from "~~/shared/model";

/** What firestore.rules enforced on `votes`, as checks the API runs on both
 * backends (decision on 2026-11-26: the browser writes only through /api).
 * Each check names the rule it replaces; tests/server/voteRules.test.ts
 * holds one test per rule. */

export type VoteKind = "node" | "extraction";

/** -5..5, the range the UI clamps to (`isSaneVote`). */
export const VOTE_MIN = -5;
export const VOTE_MAX = 5;
/** At most 40 categories on one vote (`isSaneVote`): every vote on a target
 * is re-read whenever one changes. */
export const VOTE_KEYS_MAX = 40;

export const voteValue = z.number().int().min(VOTE_MIN).max(VOTE_MAX);
const category = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);

export const voteBody = z.object({
  kind: z.enum(["node", "extraction"]).default("node"),
  /** Merged into the stored map, category by category. */
  categoryVotes: z.record(category, voteValue).optional(),
  comment: z.string().max(4000).optional(),
});
export type VoteBody = z.infer<typeof voteBody>;

/** One document per target per person, at `<target>_<uid>` (`isOwnVote`). */
export function voteDocId(targetId: string, uid: string): string {
  return `${targetId}_${uid}`;
}

const targetField = (kind: VoteKind) =>
  kind === "extraction" ? "extractionId" : "nodeId";

export function assertVoteTarget(targetId: string): void {
  // A slash would name another path in Firestore; `_` cannot be refused, ids
  // of extractions carry it.
  if (!targetId || targetId.length > 400 || targetId.includes("/")) {
    throw createError({ statusCode: 400, message: "Nieprawidłowy cel głosu." });
  }
}

/** A person's own vote: never under a model's or a migration's uid, which
 * the stats read as not human (`isPipelineVote` is the way in for those). */
export function assertHumanVoter(uid: string): void {
  if (isAutomatedUid(uid)) {
    throw createError({
      statusCode: 403,
      message: "Głosy modeli zapisuje /api/votes/pipeline.",
    });
  }
}

/** `isSaneVote`, judged on the whole map after the merge: a value already out
 * of range turns away a vote in another category until it is put right. */
export function assertSaneVote(categoryVotes: Record<string, unknown>): void {
  const values = Object.values(categoryVotes);
  if (Object.keys(categoryVotes).length > VOTE_KEYS_MAX) {
    throw createError({
      statusCode: 400,
      message: `Głos może mieć najwyżej ${VOTE_KEYS_MAX} kategorii.`,
    });
  }
  if (!values.every((value) => voteValue.safeParse(value).success)) {
    throw createError({
      statusCode: 400,
      message: `Głos musi być liczbą całkowitą od ${VOTE_MIN} do ${VOTE_MAX}.`,
    });
  }
}

/** The vote after `body` is merged into what is stored, as `setDoc(…,
 * {merge: true})` did; refused when the result would break a rule.
 *
 * `isOwnVote`: the uid is the token's and exactly one target is named, so a
 * stored document that names the other kind of target is not this one. */
export function mergeVote(
  stored: VoteDocument | null,
  input: { targetId: string; uid: string; body: VoteBody; now: string },
): VoteDocument {
  const { targetId, uid, body, now } = input;
  const field = targetField(body.kind);
  const other = targetField(body.kind === "node" ? "extraction" : "node");
  if (stored && (other in stored || (stored[field] ?? targetId) !== targetId)) {
    throw createError({
      statusCode: 409,
      message: "Ten głos dotyczy innego celu.",
    });
  }
  const categoryVotes = {
    ...(stored?.categoryVotes ?? {}),
    ...(body.categoryVotes ?? {}),
  };
  assertSaneVote(categoryVotes);
  const merged: VoteDocument = {
    ...(stored ?? {}),
    [field]: targetId,
    userUid: uid,
    categoryVotes,
    updatedAt: now,
  };
  if (body.comment !== undefined) merged.comment = body.comment;
  return merged;
}

/** Whether the stored document is this person's vote on this target, for a
 * delete, which carries no payload (`isOwnVote` on `resource.data`). */
export function isOwnStoredVote(
  stored: VoteDocument,
  targetId: string,
  uid: string,
): boolean {
  if (stored.userUid !== uid) return false;
  const node = typeof stored.nodeId === "string";
  const extraction = typeof stored.extractionId === "string";
  if (node === extraction) return false;
  return (node ? stored.nodeId : stored.extractionId) === targetId;
}

/** A scoring model's uploads (`isPipelineVote`): nodes only, under a uid the
 * stats read as a model. */
export const pipelineVotesBody = z.object({
  model: z
    .string()
    .min(1)
    .max(128)
    .refine((uid) => isPipelineUid(uid), {
      message: "Model musi mieć uid z „pipeline”.",
    }),
  set: z
    .array(
      z.object({
        nodeId: z.string().min(1).max(400),
        score: z.number().finite(),
      }),
    )
    .max(5000)
    .default([]),
  retract: z.array(z.string().min(1).max(400)).max(5000).default([]),
});
export type PipelineVotesBody = z.infer<typeof pipelineVotesBody>;

/** Own votes, by target id, as GET /api/votes/mine answers. */
export type OwnVotes = Record<
  string,
  Pick<VoteDocument, "categoryVotes" | "comment" | "updatedAt">
>;

/** How many of one person's votes `GET /api/votes/mine` hands out whole. */
export const OWN_VOTES_CAP = 5000;
