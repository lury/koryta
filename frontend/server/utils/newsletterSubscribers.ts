import { createHash } from "node:crypto";
import {
  confirmSubscriberPg,
  confirmedSubscribersPg,
  queueMailPg,
  readSubscriberPg,
  requestSubscriptionPg,
} from "~~/server/db/mail";
import { mailTokenMatches, mailToken } from "~~/server/utils/mailTokens";
import { campaignTopics, type CampaignTopic } from "~~/shared/campaigns";
import {
  CONFIRMATION_DAYS,
  SUBSCRIBER_PREFIX,
  confirmationUrl,
  renderConfirmation,
} from "~~/shared/newsletterSignup";

/** One document per day, counting the confirmation mails sent on it. */
export const SUBSCRIBE_LIMITS = "newsletterLimits";

/** The most confirmation mails the site sends in a day, far above any real
 * day. Past it the form still answers as usual and nothing is sent: a script
 * pouring addresses in must not turn the site into somebody's spam cannon. */
export const DAILY_CONFIRMATIONS_CAP = 200;

/** One address is sent its confirmation at most this often... */
const RESEND_AFTER_MS = 10 * 60 * 1000;
/** ...and at most this many times in a day. */
const MAX_CONFIRMATIONS_A_DAY = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriberStatus = "pending" | "confirmed" | "unsubscribed";

export type Subscriber = {
  id: string;
  email: string;
  status: SubscriberStatus;
  topics: Partial<Record<CampaignTopic, boolean>>;
};

/** What became of a request. The form says the same thing for all of them -
 * which of these happened is nobody's business who only knows the address. */
export type SubscribeOutcome =
  "sent" | "alreadyConfirmed" | "throttled" | "capped";

/** The subscriber document's id for an address: the same address always
 * lands on the same document, so two quick submissions cannot make two. 128
 * bits of SHA-256, which no two addresses will share. */
export function subscriberId(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 32);
}

/** Takes an address from the form: a new one, or one whose earlier request
 * was never confirmed or later withdrawn, is sent the confirmation mail. */
export async function requestSubscription(args: {
  email: string;
  where: string;
  siteUrl: string;
  now: Date;
}): Promise<SubscribeOutcome> {
  const id = subscriberId(args.email);
  const sentAt = args.now.toISOString();

  const outcome = (await requestSubscriptionPg({
    id,
    email: args.email,
    where: args.where,
    topics: campaignTopics,
    now: args.now,
    day: sentAt.slice(0, 10),
    // Removes an address nobody confirmed (expire_documents, 0403). Cleared
    // when it is confirmed.
    expireAt: new Date(
      args.now.getTime() + CONFIRMATION_DAYS * DAY_MS,
    ).toISOString(),
    decide: (data, sentToday) => {
      if (data?.status === "confirmed") return { outcome: "alreadyConfirmed" };
      const recent = timestamps(data?.confirmationsSent).filter(
        (at) => args.now.getTime() - at.getTime() < DAY_MS,
      );
      const last = recent.at(-1);
      if (
        recent.length >= MAX_CONFIRMATIONS_A_DAY ||
        (last && args.now.getTime() - last.getTime() < RESEND_AFTER_MS)
      ) {
        return { outcome: "throttled" };
      }
      if (sentToday >= DAILY_CONFIRMATIONS_CAP) return { outcome: "capped" };
      return {
        outcome: "sent",
        confirmationsSent: [...recent.map((at) => at.toISOString()), sentAt],
      };
    },
  })) as SubscribeOutcome;
  if (outcome !== "sent") return outcome;

  const token = await mailToken(`${SUBSCRIBER_PREFIX}${id}`);
  await queueMailPg({
    to: [args.email],
    message: renderConfirmation({
      url: confirmationUrl(args.siteUrl, { id, token }),
    }),
    kind: "newsletterConfirmation",
    subscriber: id,
    created_at: sentAt,
  });
  return "sent";
}

export type ConfirmOutcome = "confirmed" | "alreadyConfirmed" | "invalid";

/** Confirms the address behind a confirmation link. */
export async function confirmSubscription(args: {
  id: string;
  token: string;
  now: Date;
}): Promise<ConfirmOutcome> {
  if (!(await mailTokenMatches(`${SUBSCRIBER_PREFIX}${args.id}`, args.token))) {
    return "invalid";
  }
  const data = await readSubscriberPg(args.id);
  if (!data) return "invalid";
  if (data.status === "confirmed") return "alreadyConfirmed";
  // A request withdrawn by its own link is not brought back by an old
  // confirmation mail: the form makes a new one.
  if (data.status !== "pending") return "invalid";
  const expireAt = instantOf(data.expireAt);
  if (expireAt && expireAt.getTime() < args.now.getTime()) return "invalid";

  // Pending no more since it was read: the other click confirmed it.
  if (!(await confirmSubscriberPg(args.id, args.now.toISOString()))) {
    return (await readSubscriberPg(args.id))?.status === "confirmed"
      ? "alreadyConfirmed"
      : "invalid";
  }
  return "confirmed";
}

/** Every confirmed subscriber, for the campaign audience. */
export async function confirmedSubscribers(): Promise<Subscriber[]> {
  return (await confirmedSubscribersPg()).map(({ id, data }) => {
    const stored = data.topics as Record<string, unknown> | undefined;
    const topics: Partial<Record<CampaignTopic, boolean>> = {};
    for (const topic of campaignTopics) {
      if (typeof stored?.[topic] === "boolean") {
        topics[topic] = stored[topic] as boolean;
      }
    }
    return { id, email: String(data.email ?? ""), status: "confirmed", topics };
  });
}

/** A stored instant (an ISO string) as a Date; null for anything else. */
function instantOf(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function timestamps(value: unknown): Date[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => instantOf(item))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());
}
