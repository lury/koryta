import { getAuth } from "firebase-admin/auth";
import { useDb } from "~~/server/db/client";
import {
  notificationEnabled,
  renderNotification,
  type NotificationEvent,
  type NotificationKind,
  type NotificationPreferences,
} from "~~/shared/notifications";

/** Why a message was not sent, so a log line says something more useful than
 * nothing happening. `sent` is the only outcome that queued anything. */
export type NotificationOutcome =
  | "sent"
  | "duplicate"
  | "opted-out"
  | "no-address"
  | "unverified-address"
  | "self"
  /** Nobody to write to: the change came from a pipeline, or from a revision
   * written before `update_user` was recorded. */
  | "no-recipient"
  | "failed";

/** Queues a message for `uid`, if they want it and we may write to them.
 *
 * Nothing is sent from here. The document lands in `mail`, the outbox
 * server/utils/mailOutbox.ts delivers and writes the outcome back onto.
 *
 * This never throws. A notification is a courtesy attached to an action that
 * has already been committed; failing the admin's request because an address
 * could not be looked up would undo nothing and help nobody.
 *
 * @param dedupeKey what makes two calls the same message. The same key writes
 * one email however many times it is passed, so a double-clicked review button
 * does not send twice; deciding what "the same" means is the caller's, since
 * only it knows whether a repeat says anything new.
 */
export async function notifyUser(
  uid: string,
  event: NotificationEvent,
  options: { dedupeKey: string; actorUid?: string; siteUrl: string },
): Promise<NotificationOutcome> {
  try {
    // Reviewing your own suggestion is how an admin edits a page, and mailing
    // somebody about what they just did themselves reads as a bug.
    if (options.actorUid && options.actorUid === uid) return "self";

    if (!(await wantsNotification(uid, event.kind))) return "opted-out";

    const address = await verifiedEmail(uid, event.kind);
    if ("refused" in address) return address.refused;

    const message = renderNotification(event, options.siteUrl);
    const mail = {
      to: [address.email],
      message,
      // Not read by the outbox - here so a failed delivery can be traced back
      // to what triggered it.
      kind: event.kind,
      uid,
      created_at: new Date().toISOString(),
    };
    // Never over a message already there: the id is the dedupe, and a
    // delivered one keeps its `delivery`.
    const sql = useDb();
    const queued = await sql`
      INSERT INTO mail (id, data)
      VALUES (${mailDocId(event.kind, options.dedupeKey)}, ${sql.json(mail as never)})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (queued.length === 0) return "duplicate";

    console.info(`Queued ${event.kind} notification for uid=${uid}`);
    return "sent";
  } catch (error) {
    console.error(
      `Failed to queue ${event.kind} notification for ${uid}`,
      error,
    );
    return "failed";
  }
}

/** Ids keep no slash, and a dedupe key derived from a document path can
 * have one. */
function mailDocId(kind: NotificationKind, dedupeKey: string): string {
  return `${kind}_${dedupeKey.replace(/\//g, "_")}`;
}

async function wantsNotification(
  uid: string,
  kind: NotificationKind,
): Promise<boolean> {
  const [user] = await useDb()<{ notifications: unknown }[]>`
    SELECT data -> 'notifications' AS notifications FROM users WHERE id = ${uid}`;
  const preferences = (user?.notifications ?? undefined) as
    NotificationPreferences | undefined;
  return notificationEnabled(kind, preferences);
}

/** The address to write to, refusing one whose owner never proved they own it.
 *
 * Firebase leaves an email/password signup unverified, and anybody may register
 * with anybody's address. Without this check, proposing a revision from an
 * account opened under someone else's email turns an admin's review into mail
 * that person did not ask for. `/profil` offers to send the verification link.
 */
async function verifiedEmail(
  uid: string,
  kind: NotificationKind,
): Promise<{ email: string } | { refused: NotificationOutcome }> {
  const user = await getAuth().getUser(uid);
  if (!user.email) return { refused: "no-address" };
  if (!user.emailVerified) {
    console.info(
      `Skipping ${kind} notification for uid=${uid}: address not verified`,
    );
    return { refused: "unverified-address" };
  }
  return { email: user.email };
}
