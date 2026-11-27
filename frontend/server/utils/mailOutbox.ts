/**
 * Sends what the site queued in the `mail` table, over SMTP, in place of the
 * Trigger Email extension (which was never installed: every message stayed
 * `queued`). The documents keep the extension's shape - `to`, `message
 * {subject, html, text}` in, `delivery {state, attempts, startTime, endTime,
 * leaseExpireTime, error, info}` out - so /admin/poczta reads the same states
 * (`deliveryStates` in shared/campaigns.ts).
 *
 * Several instances may drain at once: a message is taken with `FOR UPDATE
 * SKIP LOCKED` and leased while it is sent. A lease that ran out (an instance
 * died sending) is taken again.
 *
 * Nothing leaves without `MAIL_DRY_RUN=false` and an `SMTP_HOST`: otherwise
 * each message is rendered by Nodemailer's JSON transport, logged and marked
 * sent with `delivery.dryRun`, so dev and the demo never mail anybody.
 *
 * Only what was queued since `MAIL_SEND_SINCE` (ISO; the worker's start
 * when unset) is sent: everything the site queued while no extension read it
 * is still `queued`, and mailing that backlog at the cut-over would send
 * people notifications and campaigns months late. Set it to the cut-over.
 */
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { Db } from "../db/client";

/** Messages one drain takes at most. */
export const OUTBOX_BATCH = 20;
/** Attempts before a message is left as an error. */
export const MAIL_MAX_ATTEMPTS = 3;
/** How long a message is leased to the instance sending it. */
const LEASE_MS = 2 * 60_000;
/** Wait before another attempt, times the attempts so far. */
const RETRY_AFTER_MS = 5 * 60_000;

export type MailSettings = {
  dryRun: boolean;
  /** Messages queued before this are left alone (ISO). */
  since: string;
  from: string;
  replyTo?: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
  };
};

/** The settings from the environment. Dry run unless asked otherwise and
 * there is a server to send through. */
export function mailSettings(
  env: Record<string, string | undefined> = process.env,
): MailSettings {
  const host = env.SMTP_HOST;
  const port = Number(env.SMTP_PORT ?? 587);
  return {
    dryRun: env.MAIL_DRY_RUN !== "false" || !host,
    since: env.MAIL_SEND_SINCE ?? new Date().toISOString(),
    from: env.MAIL_FROM ?? "koryta.pl <powiadomienia@koryta.pl>",
    replyTo: env.MAIL_REPLY_TO,
    smtp: host
      ? {
          host,
          port,
          secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
          user: env.SMTP_USER,
          password: env.SMTP_PASSWORD,
        }
      : undefined,
  };
}

export function mailTransport(settings: MailSettings): Transporter {
  if (settings.dryRun || !settings.smtp) {
    return nodemailer.createTransport({ jsonTransport: true });
  }
  const { host, port, secure, user, password } = settings.smtp;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass: password } : undefined,
  });
}

type Queued = {
  id: string;
  data: {
    to?: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    from?: string;
    replyTo?: string;
    /** `List-Unsubscribe` and its one-click partner, on campaigns. */
    headers?: Record<string, string>;
    message?: { subject?: string; html?: string; text?: string };
    delivery?: { attempts?: number };
  };
};

export type OutboxDrain = { sent: number; retried: number; failed: number };

/** Takes up to `limit` waiting messages, leasing them in one statement. */
async function lease(
  sql: Db,
  limit: number,
  now: Date,
  since: string,
): Promise<Queued[]> {
  const until = new Date(now.getTime() + LEASE_MS).toISOString();
  const at = now.toISOString();
  return sql<Queued[]>`
    WITH due AS (
      SELECT id FROM mail
      WHERE coalesce(data ->> 'created_at', '') COLLATE "C" >= ${since}
        AND (delivery_state IN ('queued', 'PENDING')
         OR (delivery_state = 'RETRY'
             AND coalesce(data #>> '{delivery,retryAt}', '') COLLATE "C" <= ${at})
         OR (delivery_state = 'PROCESSING'
             AND coalesce(data #>> '{delivery,leaseExpireTime}', '') COLLATE "C" <= ${at}))
      ORDER BY created_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    UPDATE mail m SET
      data = jsonb_set(m.data, '{delivery}',
        coalesce(m.data -> 'delivery', '{}'::jsonb) || jsonb_build_object(
          'state', 'PROCESSING',
          'startTime', ${at}::text,
          'leaseExpireTime', ${until}::text,
          'attempts', coalesce((m.data #>> '{delivery,attempts}')::int, 0) + 1)),
      updated_at = clock_timestamp()
    FROM due WHERE m.id = due.id
    RETURNING m.id, m.data`;
}

async function finish(sql: Db, id: string, delivery: Record<string, unknown>) {
  await sql`
    UPDATE mail SET
      data = jsonb_set(data, '{delivery}',
        (coalesce(data -> 'delivery', '{}'::jsonb) - 'leaseExpireTime' - 'retryAt')
          || ${sql.json(delivery as never)}::jsonb),
      updated_at = clock_timestamp()
    WHERE id = ${id}`;
}

/** Sends what is waiting, once: what the worker's timer and the CLI run. */
export async function drainOutbox(
  sql: Db,
  options: {
    settings?: MailSettings;
    transport?: Transporter;
    limit?: number;
    now?: () => Date;
  } = {},
): Promise<OutboxDrain> {
  const settings = options.settings ?? mailSettings();
  const transport = options.transport ?? mailTransport(settings);
  const now = options.now ?? (() => new Date());
  const result: OutboxDrain = { sent: 0, retried: 0, failed: 0 };
  const taken = await lease(
    sql,
    options.limit ?? OUTBOX_BATCH,
    now(),
    settings.since,
  );
  for (const mail of taken) {
    const { data } = mail;
    const attempts = data.delivery?.attempts ?? 1;
    try {
      const info = await transport.sendMail({
        from: data.from ?? settings.from,
        replyTo: data.replyTo ?? settings.replyTo,
        to: data.to,
        cc: data.cc,
        bcc: data.bcc,
        headers: data.headers,
        subject: data.message?.subject,
        html: data.message?.html,
        text: data.message?.text,
      });
      if (settings.dryRun) {
        console.info(
          `[mail] dry run: ${mail.id} to ${String(data.to)}: ${data.message?.subject ?? ""}`,
        );
      }
      await finish(sql, mail.id, {
        state: "SUCCESS",
        endTime: now().toISOString(),
        error: null,
        ...(settings.dryRun ? { dryRun: true } : {}),
        info: {
          messageId: info.messageId ?? null,
          accepted: (info.accepted ?? []).map(String),
          rejected: (info.rejected ?? []).map(String),
          pending: (info.pending ?? []).map(String),
          response: settings.dryRun ? "dry run" : (info.response ?? null),
        },
      });
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const last = attempts >= MAIL_MAX_ATTEMPTS;
      await finish(sql, mail.id, {
        state: last ? "ERROR" : "RETRY",
        endTime: now().toISOString(),
        error: message,
        ...(last
          ? {}
          : {
              retryAt: new Date(
                now().getTime() + RETRY_AFTER_MS * attempts,
              ).toISOString(),
            }),
      });
      console.error(`[mail] ${mail.id} attempt ${attempts} failed: ${message}`);
      if (last) result.failed += 1;
      else result.retried += 1;
    }
  }
  return result;
}
