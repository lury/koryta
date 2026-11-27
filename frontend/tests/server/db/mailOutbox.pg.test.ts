import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import type { Transporter } from "nodemailer";
import { collectionTables } from "~~/server/db/collections";
import {
  campaignDeliveries,
  queueCampaign,
  queueTest,
  saveCampaign,
} from "~~/server/utils/mailCampaigns";
import { requestSubscription } from "~~/server/utils/newsletterSubscribers";
import { drainOutbox, mailSettings } from "~~/server/utils/mailOutbox";
import { emptyActivityCounts } from "~~/shared/activity";
import type { AudienceMember, CampaignContent } from "~~/shared/campaigns";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** The SMTP outbox draining what the mail code queued on Postgres (dry run,
 * a failing server, the backlog left alone, two workers at once). The mail
 * code itself is tests/server/db/opsMail.pg.test.ts's.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/mailOutbox.pg.test.ts
 */

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (err: { message: string }) =>
    Object.assign(new Error(err.message), err);
});

const NOW = new Date("2026-11-26T12:00:00.000Z");
const CONTENT: CampaignContent = {
  subject: "Wracamy do kolejki!",
  body: "Cześć,\n\nkolejka czeka.",
  ctaLabel: "Sprawdź kolejną osobę",
  ctaPath: "/eksploruj/nowe",
  topic: "callsToAction",
  includeStats: false,
};

function member(
  uid: string,
  overrides: Partial<AudienceMember> = {},
): AudienceMember {
  return {
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    disabled: false,
    displayName: null,
    admin: false,
    newAdmin: false,
    owner: false,
    createdAt: null,
    lastSignInAt: null,
    lastSeenAt: null,
    activity: { counts: { ...emptyActivityCounts(), vote: 4 }, total: 4 },
    preferences: { newsletter: { callsToAction: true } },
    ...overrides,
  };
}

let sql: postgres.Sql;

/** What the outbox is given to send: a confirmation, a campaign to three
 * people and the owner's test. */
async function queueSome() {
  await requestSubscription({
    email: "czytelnik@example.com",
    where: "home",
    siteUrl: "https://koryta.pl",
    now: NOW,
  });
  const campaign = await saveCampaign({
    content: CONTENT,
    by: "owner",
    now: NOW,
  });
  const args = {
    campaign,
    community: null,
    siteUrl: "https://koryta.pl",
    now: NOW,
  };
  await queueCampaign({
    ...args,
    members: [member("a"), member("b"), member("c", { emailVerified: false })],
    uids: ["a", "b", "c"],
    by: "owner",
  });
  await queueTest({ ...args, member: member("owner", { owner: true }) });
  return campaign.id;
}

let campaignId: string;

describe.runIf(PG_TEST_DATABASE_URL)("mail outbox on Postgres", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    sql = await openTestDatabase("mail_outbox");
    campaignId = await queueSome();
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    await closeTestDatabase(sql);
  });

  it("drains the outbox: dry run, retries, the backlog left alone", async () => {
    const before = NOW.toISOString();
    // The backlog: queued long before the worker started.
    await sql`INSERT INTO ${sql(collectionTables.mail)} (id, data) VALUES
      ('old', ${sql.json({ to: ["x@example.com"], message: { subject: "stare" }, created_at: "2026-01-01T00:00:00.000Z" })})`;
    const settings = { ...mailSettings({}), since: before };
    expect(settings.dryRun).toBe(true);
    const dry = await drainOutbox(sql, { settings, now: () => NOW });
    const states = await sql<
      { id: string; state: string; dry: boolean | null }[]
    >`
      SELECT id, delivery_state AS state, (data #> '{delivery,dryRun}')::boolean AS dry
      FROM mail ORDER BY id`;
    expect(dry.sent).toBe(states.filter((s) => s.id !== "old").length);
    expect(states.find((s) => s.id === "old")?.state).toBe("queued");
    expect(
      states
        .filter((s) => s.id !== "old")
        .every((s) => s.state === "SUCCESS" && s.dry),
    ).toBe(true);
    // The deliveries list reads what the worker wrote.
    const deliveries = await campaignDeliveries(campaignId);
    const states2 = Object.values(deliveries).map((d) => d.state);
    expect(states2.length).toBeGreaterThan(0);
    expect(states2.every((s) => s === "SUCCESS")).toBe(true);

    // A server that refuses: tried again later, an error after three.
    await sql`INSERT INTO mail (id, data) VALUES
      ('fails', ${sql.json({ to: ["y@example.com"], message: { subject: "x" }, created_at: NOW.toISOString() })})`;
    const refusing = {
      sendMail: async () => {
        throw new Error("421 try later");
      },
    } as unknown as Transporter;
    const live = { ...settings, dryRun: false };
    let at = NOW.getTime();
    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      outcomes.push(
        await drainOutbox(sql, {
          settings: live,
          transport: refusing,
          now: () => new Date(at),
        }),
      );
      at += 60 * 60_000;
    }
    expect(outcomes.map((o) => [o.retried, o.failed])).toEqual([
      [1, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ]);
    const [failed] = await sql<
      { state: string; attempts: number; error: string }[]
    >`
      SELECT delivery_state AS state, (data #>> '{delivery,attempts}')::int AS attempts,
        data #>> '{delivery,error}' AS error FROM mail WHERE id = 'fails'`;
    expect(failed).toEqual({
      state: "ERROR",
      attempts: 3,
      error: "421 try later",
    });

    // Two workers at once take each message once.
    await sql`INSERT INTO mail (id, data)
      SELECT 'many' || g, jsonb_build_object('to', jsonb_build_array('z@example.com'),
        'message', jsonb_build_object('subject', 'x'), 'created_at', ${NOW.toISOString()}::text)
      FROM generate_series(1, 30) g`;
    const seen: string[] = [];
    const counting = {
      sendMail: async (m: { subject: string; to: string[] }) => {
        seen.push(String(m.to));
        await new Promise((r) => setTimeout(r, 2));
        return {
          messageId: "m",
          accepted: m.to,
          rejected: [],
          pending: [],
          response: "250",
        };
      },
    } as unknown as Transporter;
    const [one, two] = await Promise.all([
      drainOutbox(sql, {
        settings: live,
        transport: counting,
        limit: 30,
        now: () => NOW,
      }),
      drainOutbox(sql, {
        settings: live,
        transport: counting,
        limit: 30,
        now: () => NOW,
      }),
    ]);
    expect(one.sent + two.sent).toBe(30);
    expect(seen).toHaveLength(30);
  });
});
