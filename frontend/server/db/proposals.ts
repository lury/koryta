/**
 * Proposals (a revision that leaves its target alone) and the question
 * whether a revision write would change anything, in SQL. The pure parts
 * come from server/utils/revisions.ts.
 */
import type { Edge, Node, Revision } from "../../shared/model";
import { revisionIsPending } from "../../shared/model";
import {
  nodeOwnedFields,
  proposalId,
  sameStoredValue,
  sanitizeFirestoreData,
  withSeededNodeStats,
  type ProposalOutcome,
  type RevisionWriteOptions,
} from "../utils/revisions";
import {
  readDoc,
  storeDoc,
  type Data,
  type Sql,
  type Tx,
  type WriteLog,
} from "./editorial";
import { newDocId } from "./ids";
import type { RevisionTarget } from "./revisionWrites";

export type ProposalResultPg = { revisionId: string; outcome: ProposalOutcome };

/** What filing a proposal would do, read but not written: the address it
 * goes to, its outcome, and the document to store there (none when nothing
 * is to be written). The address row is locked for the rest of the
 * transaction, so a verdict cannot land between the read and the write. */
export async function planProposalPg(
  sql: Sql,
  user: { uid: string },
  target: RevisionTarget,
  data: Data | Node | Edge,
  options: { automatic?: boolean; key?: string } = {},
): Promise<ProposalResultPg & { doc?: Data; create: boolean }> {
  const automatic = options.automatic === true;
  const address = automatic ? target.id : `${target.id}_${user.uid}`;
  const revisionId = proposalId(address, data, options.key);
  const proposed = sanitizeFirestoreData(data);
  const now = new Date().toISOString();
  const revision: Data = {
    node_id: target.id,
    data: proposed,
    update_time: now,
    update_user: user.uid,
    collection: target.collection,
    status: "pending",
    update_automatic: automatic,
  };

  const standing = await readDoc(sql, "revisions", revisionId, true);
  if (!standing) {
    return { revisionId, outcome: "created", doc: revision, create: true };
  }
  if (!revisionIsPending(standing as Partial<Revision>)) {
    if (automatic) return { revisionId, outcome: "decided", create: false };
    return {
      revisionId: newDocId(),
      outcome: "created",
      doc: revision,
      create: true,
    };
  }
  if (sameStoredValue(standing.data, proposed)) {
    return { revisionId, outcome: "unchanged", create: false };
  }
  return {
    revisionId,
    outcome: "refreshed",
    doc: { ...standing, data: proposed, update_time: now },
    create: false,
  };
}

/** Stores what `planProposalPg` planned, if anything. */
export async function storeProposalPg(
  tx: Tx,
  log: WriteLog,
  plan: { revisionId: string; doc?: Data; create: boolean },
): Promise<void> {
  if (!plan.doc) return;
  await storeDoc(tx, log, "revisions", plan.revisionId, plan.doc, {
    create: plan.create,
  });
}

/** Files a pending revision of `target` without touching it: under the
 * address its content gives it, a restatement writing nothing, a reviewer's
 * answer left alone (a person's second ask filed beside it). */
export async function proposeRevisionPg(
  tx: Tx,
  log: WriteLog,
  user: { uid: string },
  target: RevisionTarget,
  data: Data | Node | Edge,
  options: { automatic?: boolean; key?: string } = {},
): Promise<ProposalResultPg> {
  const plan = await planProposalPg(tx, user, target, data, options);
  await storeProposalPg(tx, log, plan);
  return { revisionId: plan.revisionId, outcome: plan.outcome };
}

/** Whether writing `data` to `target` would leave it exactly as it is
 * (`revisionChangesNothing`, by the target's collection). */
export function revisionChangesNothingPg(
  collection: RevisionTarget["collection"],
  data: Data | Node | Edge,
  options: RevisionWriteOptions = {},
): boolean {
  const { approve = false, stored } = options;
  if (!stored) return false;
  if (approve && stored.revision_id === undefined) return false;
  const next: Data = {
    ...(sanitizeFirestoreData(data) as Data),
    ...nodeOwnedFields(stored),
  };
  if (options.published !== undefined) next.published = options.published;
  return sameStoredValue(
    collection === "edges" ? next : withSeededNodeStats(next),
    stored,
  );
}
