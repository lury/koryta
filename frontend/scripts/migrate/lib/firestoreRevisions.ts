/**
 * The Firestore statements of the revision flow that the data migrations in
 * scripts/migrate still run against the `koryta-pl` Firestore database
 * (README.md there): an audit entry, an edge's revisions, a revision and its
 * target in one batch. The site writes Postgres (server/db); these exist
 * only for the migrations that repair Firestore data before the cut-over,
 * as server/utils/{audit,edgePublication,revisions}.ts had them.
 */
import type {
  DocumentReference,
  Firestore,
  WriteBatch,
} from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { AuditEntry } from "../../../shared/audit";
import type { Edge, Node, Revision } from "../../../shared/model";
import {
  nodeOwnedFields,
  sanitizeFirestoreData,
  withSeededNodeStats,
  type RevisionWriteOptions,
} from "../../../server/utils/revisions";

/** One administrator decision in `audit`, in the batch of the change. */
export function recordAudit(
  db: Firestore,
  entry: Omit<AuditEntry, "at">,
  batch: WriteBatch,
): void {
  batch.set(db.collection("audit").doc(), {
    ...entry,
    at: new Date().toISOString(),
  } satisfies AuditEntry);
}

/** `update_time` is a Timestamp, an ISO string or missing depending on age. */
function revisionTime(revision: Revision): number {
  const value = revision.update_time as unknown;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") return Date.parse(value) || 0;
  if (value && typeof value === "object" && "_seconds" in value) {
    return (value as { _seconds: number })._seconds * 1000;
  }
  return 0;
}

/** Each edge's revisions, newest first, one `in` query per 30 ids. */
export async function edgeRevisionsForMany(
  db: Firestore,
  edgeIds: string[],
): Promise<Map<string, (Revision & { id: string })[]>> {
  const result = new Map<string, (Revision & { id: string })[]>();
  for (const id of edgeIds) result.set(id, []);
  for (let i = 0; i < edgeIds.length; i += 30) {
    const snap = await db
      .collection("revisions")
      .where("node_id", "in", edgeIds.slice(i, i + 30))
      .get();
    for (const doc of snap.docs) {
      const revision = { id: doc.id, ...(doc.data() as Revision) };
      if (revision.node_id) result.get(revision.node_id)?.push(revision);
    }
  }
  for (const revisions of result.values()) {
    revisions.sort((a, b) => revisionTime(b) - revisionTime(a));
  }
  return result;
}

/** A revision of `data` and the target rewritten from it, in `batch`. */
export function createRevisionTransaction(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  targetRef: DocumentReference,
  data: Record<string, unknown> | Node | Edge,
  options: RevisionWriteOptions = {},
): { revisionRef: DocumentReference; targetRef: DocumentReference } {
  const { automatic = false, approve = false } = options;
  const revisionRef = db.collection("revisions").doc();
  const timestamp = Timestamp.now();
  const revision: Revision = {
    node_id: targetRef.id,
    data: sanitizeFirestoreData(data),
    update_time: timestamp,
    update_user: user.uid,
    collection: targetRef.parent.id === "edges" ? "edges" : "nodes",
    status: approve ? "approved" : "pending",
  };
  if (approve) {
    revision.review_user = user.uid;
    revision.review_time = timestamp;
  }
  revision.update_automatic = automatic;
  batch.set(revisionRef, revision);

  const targetData: Record<string, unknown> = {
    ...(revision.data as Record<string, unknown>),
    ...nodeOwnedFields(options.stored ?? {}),
  };
  if (options.published !== undefined) targetData.published = options.published;
  const written =
    targetRef.parent.id === "edges"
      ? targetData
      : withSeededNodeStats(targetData);
  if (approve) written.revision_id = revisionRef;
  batch.set(targetRef, written);
  return { revisionRef, targetRef };
}
