/**
 * The Firestore merge of two pages, for scripts/migrate/merge-duplicate-people.ts,
 * which repairs the `koryta-pl` Firestore database before the cut-over. The
 * site merges in Postgres (server/db/nodeMerge.ts); the rules both share are
 * server/utils/merge.ts.
 */
import type { Firestore, WriteBatch } from "firebase-admin/firestore";
import {
  carriedFields,
  countDispositions,
  planEdgeMoves,
  votesToMove,
  type MergePlan,
} from "../../../server/utils/merge";
import { withoutInternalFields } from "../../../server/utils/revisions";
import { createRevisionTransaction, recordAudit } from "./firestoreRevisions";

/** Every relation with the given node at either end. */
export async function edgesTouching(db: Firestore, nodeId: string) {
  const [asSource, asTarget] = await Promise.all([
    db.collection("edges").where("source", "==", nodeId).get(),
    db.collection("edges").where("target", "==", nodeId).get(),
  ]);

  const byId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of [...asSource.docs, ...asTarget.docs]) byId.set(doc.id, doc);
  return [...byId.values()];
}

/** Every vote cast on a node, as `votesToMove` reads them. */
export async function nodeVotes(
  db: Firestore,
  nodeId: string,
): Promise<{ id: string; user: string; data: Record<string, unknown> }[]> {
  const snap = await db.collection("votes").where("nodeId", "==", nodeId).get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    user: String(doc.data().userUid ?? ""),
    data: doc.data(),
  }));
}

/** What merging `duplicateId` into `survivorId` would do, without doing it.
 *
 * Split from the write so the same reasoning backs the endpoint, its dry run
 * and the one-off migration - a merge is not a thing to work out twice.
 *
 * A relation removed earlier (`deleted`) is left where it is: it asserts
 * nothing, so moving it would only add a second dead copy to the survivor, and
 * the reason it was removed was recorded against the page it was removed from.
 */
export async function planNodeMerge(
  db: Firestore,
  duplicateId: string,
  survivorId: string,
): Promise<MergePlan> {
  const [duplicateDoc, survivorDoc] = await db.getAll(
    db.collection("nodes").doc(duplicateId),
    db.collection("nodes").doc(survivorId),
  );

  const [duplicateEdges, survivorEdges, duplicateVotes, survivorVotes] =
    await Promise.all([
      edgesTouching(db, duplicateId),
      edgesTouching(db, survivorId),
      nodeVotes(db, duplicateId),
      nodeVotes(db, survivorId),
    ]);

  const edges = planEdgeMoves(
    duplicateEdges,
    survivorEdges,
    duplicateId,
    survivorId,
  );

  return {
    duplicate_id: duplicateId,
    survivor_id: survivorId,
    duplicate_name: duplicateDoc?.data()?.name as string | undefined,
    survivor_name: survivorDoc?.data()?.name as string | undefined,
    edges,
    counts: countDispositions(edges),
    votes: votesToMove(duplicateVotes, survivorVotes, survivorId),
    carried: carriedFields(
      duplicateDoc?.data() ?? {},
      survivorDoc?.data() ?? {},
    ),
  };
}

/** Carry out the plan: move the relations, then put the duplicate to rest.
 *
 * A moved relation is updated in place rather than rewritten at the document id
 * its new ends would hash to. `findEdgeMatches` looks an edge up by
 * `(source, target, type)` and not by id, so a stale id costs nothing: the next
 * ingest still finds the relation and reuses it. Rewriting it would cost the
 * revisions filed against the old id, which are the only record of who said
 * this and when.
 *
 * A collapsed relation is soft-deleted with a revision, exactly as
 * `/api/edges/delete` removes one - the reason it went is worth keeping, and it
 * is the half of the merge most likely to have been wrong.
 */
export function applyNodeMerge(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  plan: MergePlan,
  reason: string,
  storedEdges: Map<string, Record<string, unknown>>,
  /** The surviving node as stored, needed only to layer `plan.carried` over it
   * - a revision is written with `set`, so it has to state the whole document.
   * Omitted by a caller with nothing to carry. */
  storedSurvivor?: Record<string, unknown>,
  /** The duplicate's vote documents by id, for the human ones being re-filed. */
  storedVotes?: Map<string, Record<string, unknown>>,
): void {
  const moved: string[] = [];
  const collapsed: string[] = [];
  const enriched: string[] = [];

  for (const edge of plan.edges) {
    const edgeRef = db.collection("edges").doc(edge.edge_id);
    const stored = storedEdges.get(edge.edge_id);
    if (!stored) continue;

    if (edge.disposition === "moved" || edge.disposition === "review") {
      const update: Record<string, string> = {};
      if (stored.source === plan.duplicate_id) update.source = plan.survivor_id;
      if (stored.target === plan.duplicate_id) update.target = plan.survivor_id;
      batch.update(edgeRef, update);
      moved.push(edge.edge_id);
      continue;
    }

    // An enriched relation is two writes: the survivor's copy learns what this
    // one knew, and this one goes the way a collapsed one does. Written as a
    // revision, approved, because it changes what a relation asserts and that
    // is the one thing revisions exist to record.
    if (edge.disposition === "enriched" && edge.enriches_into) {
      const target = storedEdges.get(edge.duplicate_of ?? "");
      if (target) {
        createRevisionTransaction(
          db,
          batch,
          user,
          db.collection("edges").doc(edge.duplicate_of!),
          edge.enriches_into,
          { stored: target, approve: true },
        );
        enriched.push(edge.duplicate_of!);
      }
    }

    // `deleted` and `delete_reason` are withheld from `stored` so this revision
    // is the one that states them; carrying them back would undo the removal on
    // the way out. Same reasoning as /api/edges/delete.
    const {
      deleted: _wasDeleted,
      delete_reason: _oldReason,
      ...carried
    } = stored;
    createRevisionTransaction(
      db,
      batch,
      user,
      edgeRef,
      {
        ...withoutInternalFields(stored),
        deleted: true,
        delete_reason:
          edge.disposition === "self"
            ? `Scalenie stron: powiązanie prowadziło samo do siebie. ${reason}`
            : edge.disposition === "enriched"
              ? `Scalenie stron: to samo, pełniej, mówi powiązanie ${edge.duplicate_of}. ${reason}`
              : `Scalenie stron: to samo mówi już powiązanie ${edge.duplicate_of}. ${reason}`,
      },
      // An admin merging two pages *is* the review of what the merge removes.
      { stored: carried, approve: true, published: false },
    );
    collapsed.push(edge.edge_id);
  }

  // What the duplicate knew and the survivor did not, written onto the survivor
  // before the duplicate is put beyond reach. A revision rather than an update,
  // because it changes what the page says and that is what revisions are for -
  // and approved as it is written, on the same authority as the rest of the
  // merge.
  if (storedSurvivor && Object.keys(plan.carried).length > 0) {
    createRevisionTransaction(
      db,
      batch,
      user,
      db.collection("nodes").doc(plan.survivor_id),
      { ...withoutInternalFields(storedSurvivor), ...plan.carried },
      { stored: storedSurvivor, approve: true },
    );
  }

  // Each human vote re-filed under the survivor's id and removed from the
  // duplicate's. A vote document is `${nodeId}_${userUid}` and carries `nodeId`
  // in its body, so both have to change; a plain update would leave the id
  // disagreeing with the field and the next vote by that person would write a
  // second document.
  for (const vote of plan.votes) {
    const stored = storedVotes?.get(vote.from_id);
    if (!stored) continue;
    batch.set(db.collection("votes").doc(vote.to_id), {
      ...stored,
      nodeId: plan.survivor_id,
    });
    batch.delete(db.collection("votes").doc(vote.from_id));
  }

  // The duplicate keeps its document, and keeps pointing at the survivor. Its
  // url still resolves, its votes and revisions still have something to hang
  // off, and `pageIsPublic` already reads `deleted` - so it leaves the public
  // site on the next read without anything else learning a new rule.
  const duplicateRef = db.collection("nodes").doc(plan.duplicate_id);
  batch.update(duplicateRef, {
    deleted: true,
    delete_reason: reason,
    merged_into: plan.survivor_id,
    published: false,
  });

  recordAudit(
    db,
    {
      action: "merge",
      collection: "nodes",
      target_id: plan.duplicate_id,
      user: user.uid,
      reason,
      merge: { into: plan.survivor_id, moved, collapsed, enriched },
    },
    batch,
  );
}
