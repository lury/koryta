import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  campaignTopics,
  CAMPAIGN_ID_PATTERN,
  type CampaignTopic,
} from "~~/shared/campaigns";
import { SUBSCRIBER_PREFIX } from "~~/shared/newsletterSignup";
import {
  countCampaignUnsubscribePg,
  createMailTokenPg,
  readMailTokenPg,
  unsubscribeAccountPg,
  withdrawSubscriberTopicPg,
} from "~~/server/db/mail";

/** One document per account that has been sent a campaign, holding the secret
 * its unsubscribe links carry. Server-only, like `mail`.
 *
 * A random token kept here rather than a signature, so nothing needs a key in
 * Secret Manager, and so a leaked link can be revoked by deleting one document.
 * It lives apart from `users/{uid}` because that document is writable by its
 * owner, and a client save that replaced it whole would break every link in
 * their inbox.
 */
export const MAIL_TOKENS = "mailTokens";

/** The account's token, made on first use and kept for good. Two sends
 * racing for the same new account: the first one's stands. */
export async function mailToken(uid: string): Promise<string> {
  const existing = await readMailTokenPg(uid);
  if (existing) return existing;
  const token = randomBytes(24).toString("base64url");
  const stored = await createMailTokenPg(uid, token, new Date().toISOString());
  if (!stored) throw new Error(`mailTokens/${uid} holds no token`);
  return stored;
}

/** Whether `token` is the one `id`'s links carry. */
export async function mailTokenMatches(
  id: string,
  token: string,
): Promise<boolean> {
  const stored = await readMailTokenPg(id);
  return typeof stored === "string" && sameToken(stored, token);
}

export type UnsubscribeOutcome = "unsubscribed" | "invalid";

/** Takes the holder of `uid`'s token off `topic`, and off team mail.
 *
 * Both, because a reader who clicks "Wypisz się" under a team message expects
 * it to stop, and the link does not say which of the two grounds the message
 * was sent on. The other topic stays as it was: that one they chose separately.
 * /profil puts back whatever they did not mean.
 */
export async function unsubscribe(args: {
  uid: string;
  token: string;
  topic: CampaignTopic;
  campaignId?: string;
}): Promise<UnsubscribeOutcome> {
  if (!(await mailTokenMatches(args.uid, args.token))) return "invalid";

  const at = new Date().toISOString();
  if (args.uid.startsWith(SUBSCRIBER_PREFIX)) {
    // With no topic left, the address is unsubscribed, and the form can sign
    // it up again.
    await withdrawSubscriberTopicPg({
      id: args.uid.slice(SUBSCRIBER_PREFIX.length),
      topic: args.topic,
      topics: campaignTopics,
      at,
    });
  } else {
    await unsubscribeAccountPg(args.uid, args.topic, at);
  }

  if (args.campaignId && CAMPAIGN_ID_PATTERN.test(args.campaignId)) {
    // The reader is off the list either way; a campaign deleted since only
    // loses the count.
    if (!(await countCampaignUnsubscribePg(args.campaignId, args.uid))) {
      console.warn(
        `Unsubscribe from ${args.campaignId} not counted on the campaign`,
      );
    }
  }
  return "unsubscribed";
}

function sameToken(stored: string, given: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
