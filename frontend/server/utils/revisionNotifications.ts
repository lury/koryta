import { createHash } from "node:crypto";
import { generateEntityUrl } from "~~/shared/slugs";
import type { NodeType, Revision } from "~~/shared/model";
import type {
  NotificationEvent,
  NotificationTarget,
} from "~~/shared/notifications";
import {
  notifyUser,
  type NotificationOutcome,
} from "~~/server/utils/notifications";
import { useDb } from "~~/server/db/client";
import { readDocs } from "~~/server/db/editorial";
import type { RevisionTarget } from "~~/server/db/revisionWrites";

/** Tells the author of a revision what a reviewer decided about it.
 *
 * Called after the decision is committed, and deliberately not part of that
 * commit: a mail nobody could address is not a reason to refuse an approval
 * that is otherwise sound. `notifyUser` swallows its own failures for the same
 * reason.
 *
 * Revisions the pipeline wrote are skipped. `update_user` on those is a service
 * account, and the whole point of a proposal from a scraper is that no person
 * is waiting on the answer.
 */
export async function notifyRevisionReviewed(
  args: {
    revisionId: string;
    revision: Partial<Revision>;
    target: RevisionTarget;
    reviewerUid: string;
    siteUrl: string;
  } & (
    | { decision: "approved"; published: boolean }
    | {
        decision: "rejected";
        reason: string;
      }
  ),
): Promise<NotificationOutcome> {
  const author = args.revision.update_user;
  if (!author || args.revision.update_automatic === true) return "no-recipient";

  // `notifyUser` guards its own work, but resolving the target reads the
  // database before it is ever called, and the review is committed by the time we get
  // here - letting that read escape would report a successful approval to the
  // admin as a 500.
  try {
    const target = await revisionTarget(args.revision, args.target);
    const event: NotificationEvent =
      args.decision === "approved"
        ? { kind: "revisionApproved", target, published: args.published }
        : { kind: "revisionRejected", target, reason: args.reason };

    return await notifyUser(author, event, {
      dedupeKey: dedupeKey(args),
      actorUid: args.reviewerUid,
      siteUrl: args.siteUrl,
    });
  } catch (error) {
    console.error(
      `Failed to describe revision ${args.revisionId} for notification`,
      error,
    );
    return "failed";
  }
}

/** What counts as the same message about the same revision.
 *
 * The revision id alone for an approval, because approving is idempotent - a
 * double-clicked button is one decision and should be one email. A rejection
 * also carries its reason: an admin who turns the same suggestion down again
 * with a better explanation is saying something new, and keying only on the
 * revision would swallow it.
 */
function dedupeKey(args: {
  revisionId: string;
  decision: "approved" | "rejected";
  reason?: string;
}): string {
  if (args.decision === "approved") return args.revisionId;
  const digest = createHash("sha1")
    .update(args.reason ?? "")
    .digest("base64url")
    .slice(0, 8);
  return `${args.revisionId}_${digest}`;
}

/** What to call the thing a revision changed, and where to send its author.
 *
 * A node answers this itself. An edge does not: it has no page of its own, and
 * its `name` is a job title ("Członek zarządu") that means nothing without the
 * person it belongs to - so a relation is described by, and linked to, the node
 * at its source.
 */
async function revisionTarget(
  revision: Partial<Revision>,
  target: RevisionTarget,
): Promise<NotificationTarget> {
  const data = (revision.data ?? {}) as Record<string, unknown>;
  const read = async (collection: "nodes" | "edges", id: string) =>
    (await readDocs(useDb(), collection, [id])).get(id) ?? {};

  if (target.collection !== "edges") {
    return describeNode(target.id, data, () => read("nodes", target.id));
  }

  // An edge revision that changes a date carries no `source`, so fall back to
  // the stored one rather than dropping the link.
  const stored = await read("edges", target.id);
  const sourceId = stringField(data, "source") ?? stringField(stored, "source");
  if (!sourceId) {
    return { name: stringField(data, "name") ?? "powiązanie" };
  }
  return describeNode(sourceId, {}, () => read("nodes", sourceId));
}

/** A node's name and page, preferring what the revision says over what is
 * stored - a rename is exactly the change most likely to be under review, and
 * the author should see the name they proposed.
 *
 * The stored document is only read when the revision leaves a gap, which is the
 * common case for a partial update from the ingest endpoints.
 */
async function describeNode(
  id: string,
  data: Record<string, unknown>,
  fetch: () => Promise<Record<string, unknown>>,
): Promise<NotificationTarget> {
  let name = stringField(data, "name");
  let type = stringField(data, "type");

  if (!name || !type) {
    const stored = await fetch();
    name ??= stringField(stored, "name");
    type ??= stringField(stored, "type");
  }

  return {
    name: name ?? id,
    path:
      name && type ? generateEntityUrl(type as NodeType, id, name) : undefined,
  };
}

function stringField(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
