import type { Revision } from "~~/shared/model";
// Relative rather than through `~~/`, like revisions.ts: plain tsx cannot
// resolve the alias, and scripts/migrate/repair-unapplied-proposal-approvals.ts
// picks a revision for an edge by the same rule publishing does.
import { approvedRevisionId, pageIsPublic } from "../../shared/model";
import { holdsRevision } from "./revisions";

/** What an edge needs before it can be shown to the public.
 *
 * An edge is a claim about two pages, so publishing it publishes a statement
 * about both. Where one of them is still a draft the claim points at a page
 * nobody can open, which is why `publishable` is the conjunction rather than
 * the edge's own state alone.
 */
export interface EdgeEndpoints {
  id: string;
  source: string;
  target: string;
  sourceName: string | null;
  targetName: string | null;
  sourcePublished: boolean;
  targetPublished: boolean;
  /** Whether both ends are live, and so whether this edge may be published. */
  publishable: boolean;
  /** The end that is holding it back, for a message that says which. */
  blockedBy: { id: string; name: string | null }[];
}

/** The revision to approve when publishing an edge that points at none.
 *
 * The newest one that has not been rejected and that the edge already holds -
 * *not* the newest still marked pending. An edge can carry an approved
 * revision without pointing at it: the pointer is written by whatever applied
 * the revision, and the ingest paths, the dedupe script and every document
 * written before `status` existed have all left the two out of step. Asking
 * for `status === "pending"` found nothing for those, so the relation had no
 * candidate and the reviewer was told a proposal was waiting on a queue that
 * would never clear.
 *
 * Held, because publishing changes who may see the edge and not what it says.
 * A proposal says something the edge does not - filing one leaves the edge
 * alone - and it is also the revision most likely to be the
 * newest, since the pipeline files its committee proposals after the
 * candidacy. Taking the newest regardless had marked 33 committee proposals
 * and corrections approved by 2026-10-09 without any of them reaching its
 * edge, so they left the review queue unapplied, and the ingest, still finding
 * the edge without its committee, proposed it again. A proposal the edge does
 * not hold stays pending, in /admin/rewizje#powiazania, for whoever approves
 * it to apply.
 *
 * A rejected revision is skipped rather than resurrected - somebody said no to
 * it, and publishing the relation is not a reason to undo that. Where no
 * revision qualifies there is no candidate, and the edge is published on the
 * strength of its own document.
 */
export function publishCandidateRevision(
  revisions: (Revision & { id: string })[],
  stored: Record<string, unknown>,
): (Revision & { id: string }) | undefined {
  return revisions.find(
    (revision) =>
      revision.status !== "rejected" && holdsRevision(stored, revision.data),
  );
}

/** Whether somebody is actually waiting on a verdict for this relation.
 *
 * Stricter than `revisionIsPending`, on purpose: that treats a *missing*
 * `status` as pending, which is right when the question is "has this been
 * settled" but wrong when the question is "is there a proposal in the queue".
 * Every revision written before the field existed has no status - all 28k of
 * them - so the looser reading labelled every legacy relation as a proposal
 * awaiting review, which told the reviewer the same untrue thing about all of
 * them.
 */
export function hasPendingRevision(
  revisions: (Revision & { id: string })[],
): boolean {
  return revisions.some((revision) => revision.status === "pending");
}

/** Why `approveWaitingEdgePg` (server/db/revisionWrites.ts) leaves an edge
 * as it is.
 *
 * The first three need nothing but the edge: it is live already, it was
 * removed, or it carries an approved revision while it is off the site. The
 * rest are read off its revisions: a reviewer rejected one, one was not
 * written automatically, or the newest says something the edge does not. */
export type WaitingEdgeRefusal =
  "live" | "deleted" | "approved_hidden" | "rejected" | "by_hand" | "not_held";

/** The part of `waitingEdgeRefusal` the edge alone answers, so a caller can
 * skip reading the revisions of an edge it would refuse anyway. */
export function settledEdgeRefusal(
  stored: Record<string, unknown>,
): "live" | "deleted" | "approved_hidden" | null {
  if (pageIsPublic(stored)) return "live";
  if (stored.deleted === true) return "deleted";
  if (approvedRevisionId(stored.revision_id)) return "approved_hidden";
  return null;
}

/** Whether an edge still waiting for its first review may be put live by an
 * automatic rule, and if not why not; null when it may.
 *
 * Nothing anybody has decided is reopened. A live edge is done with; an
 * approved one that is not live was approved and kept off the site by
 * somebody, or taken off it; a rejected revision is a reviewer's no; and a
 * revision not written automatically is a person's word on the relation. Each
 * of those stays theirs.
 *
 * The newest revision is the one approved, and only where the edge already
 * holds it, so what goes live is what the page would show. Only the newest: an
 * older revision the edge holds would put the edge up past a newer one saying
 * something else, which is a change nobody has looked at.
 *
 * `revisions` are every revision of the edge, newest first, as
 * `edgeRevisionsForManyPg` returns them. */
export function waitingEdgeRefusal(
  stored: Record<string, unknown>,
  revisions: (Revision & { id: string })[],
): WaitingEdgeRefusal | null {
  const settled = settledEdgeRefusal(stored);
  if (settled) return settled;
  if (revisions.some((revision) => revision.status === "rejected")) {
    return "rejected";
  }
  if (revisions.some((revision) => revision.update_automatic !== true)) {
    return "by_hand";
  }
  if (!publishCandidateRevision(revisions.slice(0, 1), stored)) {
    return "not_held";
  }
  return null;
}

/** How many edges one request publishes or takes down, in one transaction. */
export const EDGE_PUBLISH_CHUNK = 100;
