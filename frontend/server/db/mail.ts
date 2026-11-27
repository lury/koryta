import { useDb } from "./client";
import { newDocId } from "./ids";
import { textArray } from "./textArray";
import { userDocumentSchema } from "../../shared/documents";

/** The mail, newsletter and campaign statements (server/utils/mailTokens.ts,
 * newsletterSubscribers.ts, mailCampaigns.ts, mailAudience.ts), one for each
 * use case. Instants are stored as ISO strings. */

type Data = Record<string, unknown>;

// --- tokens ----------------------------------------------------------------

export async function readMailTokenPg(id: string): Promise<string | null> {
  const [row] = await useDb()<{ token: string | null }[]>`
    SELECT jsonb_text(data -> 'token') AS token FROM mail_tokens WHERE id = ${id}`;
  return row?.token ?? null;
}

/** Stores `token` for `id` unless it has one; the token that stands. */
export async function createMailTokenPg(
  id: string,
  token: string,
  at: string,
): Promise<string | null> {
  const sql = useDb();
  const [created] = await sql<{ token: string }[]>`
    INSERT INTO mail_tokens (id, data)
    VALUES (${id}, ${sql.json({ token, created_at: at })})
    ON CONFLICT (id) DO NOTHING
    RETURNING jsonb_text(data -> 'token') AS token`;
  return created?.token ?? (await readMailTokenPg(id));
}

// --- accounts and subscribers ------------------------------------------------

/** Takes an account off `topic` and off team mail, keeping the rest of its
 * document: the merge Firestore's `set(…, {merge: true})` made. */
export async function unsubscribeAccountPg(
  uid: string,
  topic: string,
  at: string,
): Promise<void> {
  const sql = useDb();
  const change = {
    newsletter: { [topic]: false },
    teamMail: false,
    newsletterUpdated: { at, via: "wypisz" },
  };
  const [row] = await sql<{ data: Data }[]>`
    INSERT INTO users (id, data) VALUES (${uid}, ${sql.json(change)})
    ON CONFLICT (id) DO UPDATE
      SET data = jsonb_merge_deep(users.data, EXCLUDED.data), updated_at = now()
    RETURNING data`;
  userDocumentSchema.parse(row!.data);
}

/** Takes a reader without an account off `topic`; with no topic left the
 * address is unsubscribed. `topics` are every topic there is. */
export async function withdrawSubscriberTopicPg(args: {
  id: string;
  topic: string;
  topics: readonly string[];
  at: string;
}): Promise<void> {
  const sql = useDb();
  await sql`
    WITH next AS (
      SELECT id, (CASE WHEN jsonb_typeof(data -> 'topics') = 'object'
          THEN data -> 'topics' ELSE '{}'::jsonb END)
        || jsonb_build_object(${args.topic}::text, false) AS topics
      FROM newsletter_subscribers WHERE id = ${args.id} FOR UPDATE)
    UPDATE newsletter_subscribers s
    SET data = s.data || jsonb_build_object('topics', next.topics)
        || CASE WHEN EXISTS (
              SELECT 1 FROM unnest(${textArray([...args.topics])}::text[]) t
              WHERE next.topics -> t = 'true'::jsonb)
            THEN '{}'::jsonb
            ELSE jsonb_build_object('status', 'unsubscribed', 'unsubscribedAt', ${args.at}::text) END,
        updated_at = now()
    FROM next WHERE s.id = next.id`;
}

/** Adds `uid` to the readers a campaign lost; false when there is no such
 * campaign. */
export async function countCampaignUnsubscribePg(
  campaignId: string,
  uid: string,
): Promise<boolean> {
  const sql = useDb();
  const rows = await sql`
    UPDATE mail_campaigns
    SET data = jsonb_set(data, '{unsubscribed}',
          jsonb_array_union(data -> 'unsubscribed', ${sql.json([uid])})),
        updated_at = now()
    WHERE id = ${campaignId} RETURNING id`;
  return rows.length > 0;
}

export type SubscriptionRequest = {
  id: string;
  email: string;
  where: string;
  topics: readonly string[];
  now: Date;
  /** Decides from the stored document and the day's count, under the locks. */
  decide: (
    stored: Data | undefined,
    sentToday: number,
  ) => { outcome: string; confirmationsSent?: string[] };
  expireAt: string;
  day: string;
};

/** One request from the form, in one transaction: the address's document and
 * the day's count are locked while `decide` judges them, and written only
 * when it says "sent". Two requests for one new address are serialised by
 * an advisory lock on its id, as there is no row to lock yet. */
export async function requestSubscriptionPg(
  request: SubscriptionRequest,
): Promise<string> {
  return useDb().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`newsletter_subscribers/${request.id}`}))`;
    const [stored] = await tx<{ data: Data }[]>`
      SELECT data FROM newsletter_subscribers WHERE id = ${request.id} FOR UPDATE`;
    await tx`
      INSERT INTO newsletter_limits (id, data)
      VALUES (${request.day}, jsonb_build_object('count', 0, 'day', ${request.day}::text))
      ON CONFLICT (id) DO NOTHING`;
    const [limit] = await tx<{ count: number | null }[]>`
      SELECT (data ->> 'count')::int AS count FROM newsletter_limits
      WHERE id = ${request.day} FOR UPDATE`;
    const sentToday = limit?.count ?? 0;
    const { outcome, confirmationsSent } = request.decide(
      stored?.data,
      sentToday,
    );
    if (outcome !== "sent") return outcome;

    await tx`
      UPDATE newsletter_limits
      SET data = data || jsonb_build_object('count', ${sentToday + 1}::int, 'day', ${request.day}::text),
          updated_at = now()
      WHERE id = ${request.day}`;
    const fields = {
      email: request.email,
      status: "pending",
      topics: Object.fromEntries(request.topics.map((t) => [t, true])),
      where: request.where,
      createdAt: stored?.data.createdAt ?? request.now.toISOString(),
      confirmationsSent,
      expireAt: request.expireAt,
    };
    await tx`
      INSERT INTO newsletter_subscribers (id, data)
      VALUES (${request.id}, ${tx.json(fields as never)})
      ON CONFLICT (id) DO UPDATE
        SET data = jsonb_merge_deep(newsletter_subscribers.data, EXCLUDED.data),
            updated_at = now()`;
    return "sent";
  });
}

export async function readSubscriberPg(id: string): Promise<Data | undefined> {
  const [row] = await useDb()<{ data: Data }[]>`
    SELECT data FROM newsletter_subscribers WHERE id = ${id}`;
  return row?.data;
}

/** Confirms a pending request; false when it is no longer pending. */
export async function confirmSubscriberPg(
  id: string,
  at: string,
): Promise<boolean> {
  const rows = await useDb()`
    UPDATE newsletter_subscribers
    SET data = (data || jsonb_build_object('status', 'confirmed', 'confirmedAt', ${at}::text)) - 'expireAt',
        updated_at = now()
    WHERE id = ${id} AND data -> 'status' = '"pending"'::jsonb
    RETURNING id`;
  return rows.length > 0;
}

export async function confirmedSubscribersPg(): Promise<
  { id: string; data: Data }[]
> {
  return useDb()<{ id: string; data: Data }[]>`
    SELECT id, data FROM newsletter_subscribers
    WHERE data @> '{"status": "confirmed"}' ORDER BY id`;
}

/** The two fields campaigns read off each `users` document, by uid. */
export async function readMailPreferencesPg(
  uids: string[],
): Promise<Map<string, Data>> {
  if (uids.length === 0) return new Map();
  const rows = await useDb()<{ id: string; data: Data }[]>`
    SELECT id, jsonb_strip_nulls(jsonb_build_object(
        'newsletter', data -> 'newsletter', 'teamMail', data -> 'teamMail')) AS data
    FROM users WHERE id = ANY(${textArray(uids)}::text[])`;
  return new Map(rows.map((row) => [row.id, row.data]));
}

// --- the outbox ----------------------------------------------------------------

/** Queues a message; with `id`, only once (false when it is there already). */
export async function queueMailPg(
  doc: Data,
  id: string = newDocId(),
): Promise<boolean> {
  const sql = useDb();
  const rows = await sql`
    INSERT INTO mail (id, data) VALUES (${id}, ${sql.json(doc as never)})
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  return rows.length > 0;
}

/** The fields of a campaign's messages that the delivery list reads. */
export async function campaignMailPg(campaignId: string): Promise<Data[]> {
  const sql = useDb();
  const rows = await sql<{ data: Data }[]>`
    SELECT jsonb_build_object('uid', data -> 'uid', 'created_at', data -> 'created_at',
        'delivery', jsonb_strip_nulls(jsonb_build_object(
          'state', data #> '{delivery,state}', 'endTime', data #> '{delivery,endTime}',
          'error', data #> '{delivery,error}'))) AS data
    FROM mail WHERE data @> ${sql.json({ campaign: campaignId })} ORDER BY id`;
  return rows.map((row) => row.data);
}

// --- campaigns -------------------------------------------------------------------

export async function listCampaignsPg(): Promise<{ id: string; data: Data }[]> {
  return useDb()<{ id: string; data: Data }[]>`
    SELECT id, data FROM mail_campaigns ORDER BY id`;
}

export async function readCampaignPg(id: string): Promise<Data | undefined> {
  const [row] = await useDb()<{ data: Data }[]>`
    SELECT data FROM mail_campaigns WHERE id = ${id}`;
  return row?.data;
}

/** The ids taken that start with `prefix`, which a new id must not be. */
export async function campaignIdsLikePg(prefix: string): Promise<string[]> {
  const rows = await useDb()<{ id: string }[]>`
    SELECT id FROM mail_campaigns WHERE starts_with(id, ${prefix})`;
  return rows.map((row) => row.id);
}

/** Creates a campaign; false when the id is taken. */
export async function createCampaignPg(
  id: string,
  data: Data,
): Promise<boolean> {
  const sql = useDb();
  const rows = await sql`
    INSERT INTO mail_campaigns (id, data) VALUES (${id}, ${sql.json(data as never)})
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  return rows.length > 0;
}

/** Sets top-level fields of a campaign; the campaign after, or undefined. */
export async function updateCampaignPg(
  id: string,
  fields: Data,
): Promise<Data | undefined> {
  const sql = useDb();
  const [row] = await sql<{ data: Data }[]>`
    UPDATE mail_campaigns SET data = data || ${sql.json(fields as never)}, updated_at = now()
    WHERE id = ${id} RETURNING data`;
  return row?.data;
}

/** Records a send: the queued uids join the recipients, the send the list. */
export async function recordCampaignSendPg(
  id: string,
  send: Data,
  queued: string[],
): Promise<Data | undefined> {
  const sql = useDb();
  const recipients =
    queued.length > 0
      ? sql`|| jsonb_build_object('recipients',
          jsonb_array_union(data -> 'recipients', ${sql.json(queued)}))`
      : sql``;
  const [row] = await sql<{ data: Data }[]>`
    UPDATE mail_campaigns
    SET data = data || jsonb_build_object(
          'sends', jsonb_array_union(data -> 'sends', ${sql.json([send] as never)}),
          'updatedAt', ${send.at as string}::text) ${recipients},
        updated_at = now()
    WHERE id = ${id} RETURNING data`;
  return row?.data;
}
