import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type postgres from "postgres";
import {
  campaignDeliveries,
  queueCampaign,
  queueTest,
  saveCampaign,
} from "~~/server/utils/mailCampaigns";
import { mailToken, unsubscribe } from "~~/server/utils/mailTokens";
import {
  DAILY_CONFIRMATIONS_CAP,
  confirmSubscription,
  confirmedSubscribers,
  requestSubscription,
  subscriberId,
} from "~~/server/utils/newsletterSubscribers";
import { readMailPreferences } from "~~/server/utils/mailAudience";
import { recordQaReleasesPg } from "~~/server/db/ops";
import summaryHandler from "~~/server/api/admin/searches.get";
import { emptyActivityCounts } from "~~/shared/activity";
import type {
  AudienceMember,
  CampaignContent,
  CampaignRecord,
  CommunityStats,
} from "~~/shared/campaigns";
import {
  closeTestDatabase,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";
import { Mirror } from "./mirror";

/** Campaigns, unsubscribe tokens, the newsletter without an account, the
 * search log's summary and the QA changelog's record, on Postgres.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/opsMail.pg.test.ts
 */

const { owner } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);
  return { owner: { yes: true } };
});

vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
  getQuery: (event: { query?: unknown }) => event.query ?? {},
  setResponseHeader: () => {},
}));

vi.mock("~~/server/utils/auth", () => ({
  requireOwner: async (event: { headers?: Record<string, string> }) => {
    if (!event.headers?.authorization) {
      throw Object.assign(new Error("401"), { statusCode: 401 });
    }
    if (!owner.yes) {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    }
    return { uid: "owner" };
  },
}));

/** Firestore's collection names, as the ported cases name them. */
const TABLES: Record<string, string> = {
  mail: "mail",
  mailCampaigns: "mail_campaigns",
  mailTokens: "mail_tokens",
  users: "users",
  newsletterSubscribers: "newsletter_subscribers",
  newsletterLimits: "newsletter_limits",
  searchQueries: "ops.search_queries",
  qaReleases: "qa_releases",
};

let sql: postgres.Sql;
const mirror = new Mirror(() => sql, Object.values(TABLES));

/** The documents of every table by `collection/id`, as the Firestore fakes
 * kept them; read back after each call. */
const store = {
  get: (key: string) => {
    const [collection, id] = split(key);
    return mirror.docs(collection).get(id);
  },
  set: (key: string, data: Record<string, unknown>) => {
    const [collection, id] = split(key);
    mirror.docs(collection).set(id, data);
  },
  has: (key: string) => store.get(key) !== undefined,
  entries: () =>
    Object.entries(TABLES).flatMap(([collection, table]) =>
      [...mirror.docs(table)].map(
        ([id, data]) => [`${collection}/${id}`, data] as const,
      ),
    ),
};
function split(key: string): [string, string] {
  const at = key.indexOf("/");
  return [TABLES[key.slice(0, at)]!, key.slice(at + 1)];
}
const around = <T>(run: () => Promise<T>) => mirror.around(run);

describe.runIf(PG_TEST_DATABASE_URL)("mail and ops on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("ops_mail");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(() => {
    mirror.clear();
    owner.yes = true;
  });

  describe("campaigns", () => {
    const CONTENT: CampaignContent = {
      subject: "Wracamy do kolejki!",
      body: "Cześć,\n\nkolejka czeka.",
      ctaLabel: "Sprawdź kolejną osobę",
      ctaPath: "/eksploruj/nowe",
      topic: "callsToAction",
      includeStats: true,
    };
    const COMMUNITY: CommunityStats = {
      days: 30,
      votes: 100,
      voters: 5,
      publications: 3,
      toCheck: 40,
    };
    const NOW = new Date("2026-10-09T12:00:00Z");

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
        preferences: {},
        ...overrides,
      };
    }
    const draft = (): Promise<CampaignRecord> =>
      around(() => saveCampaign({ content: CONTENT, by: "owner", now: NOW }));
    const send = (
      campaign: CampaignRecord,
      members: AudienceMember[],
      uids: string[],
    ) =>
      around(() =>
        queueCampaign({
          campaign,
          members,
          community: COMMUNITY,
          uids,
          by: "owner",
          siteUrl: "https://koryta.pl",
          now: NOW,
        }),
      );

    it("names a new campaign after its day and subject", async () => {
      const campaign = await draft();
      expect(campaign.id).toBe("2026-10-09-wracamy-do-kolejki");
      expect(campaign).toMatchObject({ ...CONTENT, recipients: [], sends: [] });
      // The same subject the same day is a second campaign, not an overwrite.
      expect((await draft()).id).toBe("2026-10-09-wracamy-do-kolejki-2");
    });

    it("edits the text of an existing one and keeps its history", async () => {
      const campaign = await draft();
      await send(campaign, [member("a", { admin: true })], ["a"]);
      const edited = await around(() =>
        saveCampaign({
          id: campaign.id,
          content: { ...CONTENT, subject: "Poprawiony temat" },
          by: "owner",
          now: NOW,
        }),
      );
      expect(edited.subject).toBe("Poprawiony temat");
      expect(edited.recipients).toEqual(["a"]);
      await expect(
        around(() =>
          saveCampaign({
            id: "2020-01-01-nie-ma",
            content: CONTENT,
            by: "owner",
            now: NOW,
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("queues one message per eligible recipient, and says why the rest got none", async () => {
      const campaign = await draft();
      const { outcomes, campaign: after } = await send(
        campaign,
        [
          member("admin", { admin: true }),
          member("fan", {
            preferences: { newsletter: { callsToAction: true } },
          }),
          member("quiet"),
          member("unverified", { admin: true, emailVerified: false }),
        ],
        ["admin", "fan", "quiet", "unverified", "ghost"],
      );

      expect(outcomes).toEqual({
        admin: "queued",
        fan: "queued",
        // The page offered only eligible people, but the server does not
        // take the browser's word for it.
        quiet: "noConsent",
        unverified: "unverified",
        ghost: "unknown",
      });
      expect(after.recipients.sort()).toEqual(["admin", "fan"]);
      expect(after.sends).toEqual([
        {
          at: NOW.toISOString(),
          by: "owner",
          test: false,
          outcomes: { queued: 2, noConsent: 1, unverified: 1, unknown: 1 },
        },
      ]);

      const mail = store.get(`mail/campaign_${campaign.id}_fan`)!;
      expect(mail).toMatchObject({
        to: ["fan@example.com"],
        kind: "campaign",
        campaign: campaign.id,
        uid: "fan",
      });
      const message = mail.message as { subject: string; text: string };
      expect(message.subject).toBe("Wracamy do kolejki!");
      expect(message.text).toContain(
        "Twój wkład w ostatnich 90 dniach: 4 oceny.",
      );
      expect(message.text).toContain("W kolejce do sprawdzenia: 40 osób.");
      const token = (store.get("mailTokens/fan") as { token: string }).token;
      expect(message.text).toContain(
        `https://koryta.pl/wypisz?u=fan&t=${token}&k=callsToAction&c=${campaign.id}`,
      );
      expect(
        (mail.headers as Record<string, string>)["List-Unsubscribe"],
      ).toContain("/api/mail/unsubscribe?u=fan");
      expect(message.text).toContain(
        "bo Twoje konto na koryta.pl jest zapisane",
      );
      expect(
        (
          store.get(`mail/campaign_${campaign.id}_admin`)!.message as {
            text: string;
          }
        ).text,
      ).toContain("bo należysz do zespołu koryta.pl");
      // The outbox's own column says it is waiting (0402).
      const [{ state }] = await sql<{ state: string }[]>`
        SELECT delivery_state AS state FROM mail
        WHERE id = ${`campaign_${campaign.id}_fan`}`;
      expect(state).toBe("queued");
    });

    it("never sends one campaign to one person twice", async () => {
      const campaign = await draft();
      const members = [
        member("a", { admin: true }),
        member("b", { admin: true }),
      ];
      await send(campaign, members, ["a"]);
      const { outcomes, campaign: after } = await send(campaign, members, [
        "a",
        "b",
      ]);
      expect(outcomes).toEqual({ a: "duplicate", b: "queued" });
      expect(after.recipients).toEqual(["a", "b"]);
    });

    it("sends the owner their own copy, marked as a test, as often as asked", async () => {
      const campaign = await draft();
      const me = member("owner", { admin: true, owner: true });
      const test = (now: Date) =>
        around(() =>
          queueTest({
            campaign,
            member: me,
            community: COMMUNITY,
            siteUrl: "https://koryta.pl",
            now,
          }),
        );
      const first = await test(NOW);
      const second = await test(new Date(NOW.getTime() + 1000));

      expect([first.outcome, second.outcome]).toEqual(["queued", "queued"]);
      const tests = store
        .entries()
        .filter(([key]) => key.startsWith(`mail/campaignTest_${campaign.id}_`))
        .map(([, data]) => data);
      expect(tests).toHaveLength(2);
      expect((tests[0]!.message as { subject: string }).subject).toBe(
        "[Test] Wracamy do kolejki!",
      );
      // A test is not a send: nobody is recorded as having received it.
      expect(second.campaign.recipients).toEqual([]);
      expect(second.campaign.sends.map((s) => s.test)).toEqual([true, true]);
    });

    it("refuses an address the owner never confirmed", async () => {
      const campaign = await draft();
      const { outcome } = await around(() =>
        queueTest({
          campaign,
          member: member("owner", { owner: true, emailVerified: false }),
          community: COMMUNITY,
          siteUrl: "https://koryta.pl",
          now: NOW,
        }),
      );
      expect(outcome).toBe("unverified");
    });

    it("reads back what the outbox wrote on each message", async () => {
      const campaign = await draft();
      const at = NOW.toISOString();
      store.set(`mail/campaign_${campaign.id}_a`, {
        campaign: campaign.id,
        uid: "a",
        to: ["a@example.com"],
        created_at: at,
        delivery: { state: "SUCCESS", endTime: at },
      });
      store.set(`mail/campaign_${campaign.id}_b`, {
        campaign: campaign.id,
        uid: "b",
        created_at: at,
        delivery: { state: "ERROR", error: "550 mailbox unavailable" },
      });
      store.set(`mail/campaign_${campaign.id}_c`, {
        campaign: campaign.id,
        uid: "c",
        created_at: at,
      });
      store.set("mail/campaign_other_a", { campaign: "other", uid: "a" });

      expect(await around(() => campaignDeliveries(campaign.id))).toEqual({
        a: { state: "SUCCESS", queuedAt: at, finishedAt: at, error: null },
        b: {
          state: "ERROR",
          queuedAt: at,
          finishedAt: null,
          error: "550 mailbox unavailable",
        },
        // Nothing has picked it up yet.
        c: { state: "queued", queuedAt: at, finishedAt: null, error: null },
      });
    });
  });

  describe("mail tokens", () => {
    it("gives each account one token and keeps it", async () => {
      const first = await around(() => mailToken("a"));
      expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(await around(() => mailToken("a"))).toBe(first);
      expect(await around(() => mailToken("b"))).not.toBe(first);
      // Two sends racing for one new account agree on its token.
      const raced = await Promise.all([mailToken("c"), mailToken("c")]);
      expect(raced[0]).toBe(raced[1]);
    });

    it("unsubscribes the holder of the right token from the topic and from team mail", async () => {
      store.set("mailCampaigns/2026-10-09-temat", {
        subject: "Temat",
        unsubscribed: [],
      });
      const token = await around(() => mailToken("a"));
      store.set("users/a", {
        newsletter: { callsToAction: true, recentPeople: true },
        displayName: "Anna",
      });

      expect(
        await around(() =>
          unsubscribe({
            uid: "a",
            token,
            topic: "callsToAction",
            campaignId: "2026-10-09-temat",
          }),
        ),
      ).toBe("unsubscribed");
      expect(store.get("users/a")).toMatchObject({
        newsletter: { callsToAction: false, recentPeople: true },
        teamMail: false,
        displayName: "Anna",
        // Kept with the topics, so /profil can say when and where they
        // changed.
        newsletterUpdated: { via: "wypisz", at: expect.any(String) },
      });
      expect(store.get("mailCampaigns/2026-10-09-temat")!.unsubscribed).toEqual(
        ["a"],
      );
      // Counted once, however often the link is used.
      await around(() =>
        unsubscribe({
          uid: "a",
          token,
          topic: "callsToAction",
          campaignId: "2026-10-09-temat",
        }),
      );
      expect(store.get("mailCampaigns/2026-10-09-temat")!.unsubscribed).toEqual(
        ["a"],
      );
    });

    it("writes an account's choice even when it has no document yet", async () => {
      const token = await around(() => mailToken("new"));
      await around(() =>
        unsubscribe({ uid: "new", token, topic: "recentPeople" }),
      );
      expect(store.get("users/new")).toMatchObject({
        newsletter: { recentPeople: false },
        teamMail: false,
      });
    });

    it("refuses a wrong token, and an account that never got one", async () => {
      await around(() => mailToken("a"));
      expect(
        await around(() =>
          unsubscribe({ uid: "a", token: "nope", topic: "recentPeople" }),
        ),
      ).toBe("invalid");
      expect(
        await around(() =>
          unsubscribe({ uid: "b", token: "nope", topic: "recentPeople" }),
        ),
      ).toBe("invalid");
      expect(store.has("users/a")).toBe(false);
    });

    it("still unsubscribes when the campaign named in the link is gone", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const token = await around(() => mailToken("a"));
      expect(
        await around(() =>
          unsubscribe({
            uid: "a",
            token,
            topic: "recentPeople",
            campaignId: "2020-01-01-usunieta",
          }),
        ),
      ).toBe("unsubscribed");
    });
  });

  describe("the newsletter without an account", () => {
    const SITE = "https://koryta.pl";
    const NOW = new Date("2026-10-17T12:00:00Z");
    const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
    const mails = () =>
      store
        .entries()
        .filter(([key]) => key.startsWith("mail/"))
        .map(([, data]) => data);
    const ask = (email: string, now = NOW) =>
      around(() =>
        requestSubscription({ email, where: "home", siteUrl: SITE, now }),
      );
    const confirm = (id: string, token: string, now: Date) =>
      around(() => confirmSubscription({ id, token, now }));
    const tokenOf = (id: string) =>
      store.get(`mailTokens/sub_${id}`)!.token as string;

    it("keeps a new address as pending and mails it the confirmation link", async () => {
      expect(await ask("anna@example.com")).toBe("sent");

      const id = subscriberId("anna@example.com");
      const subscriber = store.get(`newsletterSubscribers/${id}`)!;
      expect(subscriber).toMatchObject({
        email: "anna@example.com",
        status: "pending",
        topics: { callsToAction: true, recentPeople: true },
        where: "home",
        createdAt: NOW.toISOString(),
        confirmationsSent: [NOW.toISOString()],
      });
      // expire_documents (0403) removes it once this is past.
      expect(Date.parse(subscriber.expireAt as string)).toBe(
        NOW.getTime() + 7 * 24 * 60 * 60 * 1000,
      );
      expect(store.get("newsletterLimits/2026-10-17")).toEqual({
        count: 1,
        day: "2026-10-17",
      });

      const [mail] = mails();
      expect(mail).toMatchObject({
        to: ["anna@example.com"],
        kind: "newsletterConfirmation",
        subscriber: id,
      });
      expect((mail!.message as { text: string }).text).toContain(
        `${SITE}/newsletter/potwierdz?s=${id}&t=${encodeURIComponent(tokenOf(id))}`,
      );
    });

    it("sends one address its link at most every ten minutes, and three times a day", async () => {
      expect(await ask("anna@example.com")).toBe("sent");
      expect(await ask("anna@example.com", minutes(5))).toBe("throttled");
      expect(await ask("anna@example.com", minutes(11))).toBe("sent");
      expect(await ask("anna@example.com", minutes(22))).toBe("sent");
      expect(await ask("anna@example.com", minutes(40))).toBe("throttled");
      // A day after the first, the oldest no longer counts.
      expect(await ask("anna@example.com", minutes(24 * 60 + 1))).toBe("sent");
      expect(mails()).toHaveLength(4);
    });

    it("sends one confirmation when the form is sent twice at once", async () => {
      await mirror.push();
      const outcomes = await Promise.all([
        requestSubscription({
          email: "anna@example.com",
          where: "home",
          siteUrl: SITE,
          now: NOW,
        }),
        requestSubscription({
          email: "anna@example.com",
          where: "home",
          siteUrl: SITE,
          now: NOW,
        }),
      ]);
      await mirror.pull();
      expect(outcomes.sort()).toEqual(["sent", "throttled"]);
      expect(mails()).toHaveLength(1);
    });

    it("sends nothing to an address already confirmed", async () => {
      store.set(`newsletterSubscribers/${subscriberId("anna@example.com")}`, {
        email: "anna@example.com",
        status: "confirmed",
      });
      expect(await ask("anna@example.com")).toBe("alreadyConfirmed");
      expect(mails()).toHaveLength(0);
    });

    it("stops at the day's cap, whatever the address", async () => {
      store.set("newsletterLimits/2026-10-17", {
        count: DAILY_CONFIRMATIONS_CAP,
      });
      expect(await ask("anna@example.com")).toBe("capped");
      expect(mails()).toHaveLength(0);
      expect(
        store.has(`newsletterSubscribers/${subscriberId("anna@example.com")}`),
      ).toBe(false);
    });

    it("confirms with the link's token, once", async () => {
      await ask("anna@example.com");
      const id = subscriberId("anna@example.com");
      const token = tokenOf(id);
      expect(await confirm(id, token, minutes(5))).toBe("confirmed");
      const subscriber = store.get(`newsletterSubscribers/${id}`)!;
      expect(subscriber.status).toBe("confirmed");
      expect(subscriber).not.toHaveProperty("expireAt");
      expect(await confirm(id, token, minutes(6))).toBe("alreadyConfirmed");
      expect(
        (await around(() => confirmedSubscribers())).map((s) => s.email),
      ).toEqual(["anna@example.com"]);
    });

    it("refuses a wrong token, an expired link and a withdrawn request", async () => {
      await ask("anna@example.com");
      const id = subscriberId("anna@example.com");
      const token = tokenOf(id);
      expect(await confirm(id, "zly", minutes(5))).toBe("invalid");
      expect(await confirm(id, token, minutes(8 * 24 * 60))).toBe("invalid");
      store.set(`newsletterSubscribers/${id}`, {
        ...store.get(`newsletterSubscribers/${id}`),
        status: "unsubscribed",
      });
      expect(await confirm(id, token, minutes(5))).toBe("invalid");
      expect(await around(() => confirmedSubscribers())).toEqual([]);
    });

    it("takes the topic off, and the address off the list with the last one", async () => {
      await ask("anna@example.com");
      const id = subscriberId("anna@example.com");
      const token = tokenOf(id);
      await confirm(id, token, minutes(5));

      expect(
        await around(() =>
          unsubscribe({ uid: `sub_${id}`, token, topic: "callsToAction" }),
        ),
      ).toBe("unsubscribed");
      expect(store.get(`newsletterSubscribers/${id}`)).toMatchObject({
        status: "confirmed",
        topics: { callsToAction: false, recentPeople: true },
      });

      await around(() =>
        unsubscribe({ uid: `sub_${id}`, token, topic: "recentPeople" }),
      );
      expect(store.get(`newsletterSubscribers/${id}`)).toMatchObject({
        status: "unsubscribed",
        unsubscribedAt: expect.any(String),
      });
      // Nothing of the subscriber's lands in `users`.
      expect(mirror.docs("users").size).toBe(0);
    });
  });

  describe("the audience's choices", () => {
    it("reads the two fields campaigns read, and nothing else", async () => {
      store.set("users/ania", {
        newsletter: { callsToAction: true },
        teamMail: false,
        displayName: "Ania",
        photoURL: "https://example.com/a.png",
      });
      store.set("users/bez", { displayName: "Bez zgód" });
      const preferences = await around(() =>
        readMailPreferences(["ania", "bez", "ghost"]),
      );
      expect(preferences).toEqual({
        ania: { newsletter: { callsToAction: true }, teamMail: false },
        bez: {},
        ghost: {},
      });
    });
  });

  describe("GET /api/admin/searches", () => {
    const summary = (query: Record<string, string> = {}, as = "owner") =>
      around(() =>
        (summaryHandler as unknown as (event: unknown) => Promise<unknown>)({
          query,
          headers: as ? { authorization: as } : {},
        }),
      );
    let n = 0;
    /** A stored search, as the log route writes it. */
    const search = (at: string, fields: Record<string, unknown> = {}) =>
      store.set(`searchQueries/s${String(n++).padStart(5, "0")}`, {
        query: "jan kowalski",
        results: 1,
        unverified: 0,
        outcome: "pick",
        picked: "person",
        signedIn: false,
        at: new Date(at).toISOString(),
        ...fields,
      });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-14T15:30:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("is the owner's alone", async () => {
      expect(await summary({}, "").catch((e) => e.statusCode)).toBe(401);
      owner.yes = false;
      expect(await summary().catch((e) => e.statusCode)).toBe(403);
    });

    it("reads the window asked for and puts each query on one row", async () => {
      search("2026-10-14T10:00:00Z", {
        results: 2,
        unverified: 2,
        pickedUnverified: true,
        signedIn: true,
      });
      search("2026-10-13T10:00:00Z", {
        results: 0,
        outcome: "abandon",
        picked: undefined,
      });
      // Before the seven whole UTC days, today the seventh.
      search("2026-10-07T23:59:59Z");

      expect(await summary({ days: "7" })).toEqual({
        days: 7,
        total: 2,
        signedOut: 1,
        truncated: false,
        queries: [
          {
            query: "jan kowalski",
            count: 2,
            signedOut: 1,
            noResults: 1,
            onlyUnverified: 1,
            picks: 1,
            proposes: 0,
            lastAt: "2026-10-14T10:00:00.000Z",
          },
        ],
        daily: [
          {
            date: "2026-10-13",
            all: { opened: 0, notOpened: 0, nothing: 1 },
            signedOut: { opened: 0, notOpened: 0, nothing: 1 },
          },
          {
            date: "2026-10-14",
            all: { opened: 1, notOpened: 0, nothing: 0 },
            signedOut: { opened: 0, notOpened: 0, nothing: 0 },
          },
        ],
      });
    });

    it("charts from the first day it holds a search, quiet days as zeros", async () => {
      search("2026-10-14T09:00:00Z");
      search("2026-10-11T09:00:00Z", { outcome: "abandon", results: 0 });
      const answer = (await summary({ days: "30" })) as {
        daily: { date: string; all: Record<string, number> }[];
      };
      expect(answer.daily.map((day) => day.date)).toEqual([
        "2026-10-11",
        "2026-10-12",
        "2026-10-13",
        "2026-10-14",
      ]);
      expect(answer.daily[1]!.all).toEqual({
        opened: 0,
        notOpened: 0,
        nothing: 0,
      });
    });

    it("charts nothing for a window nobody searched in", async () => {
      expect(((await summary()) as { daily: unknown[] }).daily).toEqual([]);
    });

    it("leaves the oldest day off the chart when it read only part of it", async () => {
      for (let i = 0; i < 4999; i++) search("2026-10-14T09:00:00Z");
      search("2026-10-13T23:00:00Z");
      search("2026-10-13T22:00:00Z");
      const answer = (await summary()) as {
        total: number;
        truncated: boolean;
        daily: { date: string }[];
      };
      // The newest 5000: the oldest of the two on 10-13 is not read.
      expect(answer.total).toBe(5000);
      expect(answer.truncated).toBe(true);
      expect(answer.daily.map((day) => day.date)).toEqual(["2026-10-14"]);
    });

    it("will not read past what is kept", async () => {
      expect(await summary({ days: "365" }).catch((e) => e.statusCode)).toBe(
        400,
      );
    });
  });

  describe("the QA changelog's record", () => {
    const record = (backend: string, added: Record<string, string>) =>
      around(() => recordQaReleasesPg(backend, added));
    const updatedAt = async () =>
      (
        await sql<{ at: Date }[]>`
          SELECT updated_at AS at FROM qa_releases WHERE id = 'prod'`
      )[0]?.at.getTime();

    it("writes the entries nothing dates yet, and keeps a date already there", async () => {
      expect(
        await record("prod", { "new-1": "2026-09-27T08:00:00.000Z" }),
      ).toEqual({ "new-1": "2026-09-27T08:00:00.000Z" });
      store.set("qaReleases/prod", {
        items: {
          "new-1": "2026-09-27T08:00:00.000Z",
          "left-the-list": "2026-09-26T08:00:00.000Z",
        },
      });
      expect(
        await record("prod", {
          "new-2": "2026-09-30T19:00:00.000Z",
          "new-1": "2026-09-30T19:00:00.000Z",
        }),
      ).toEqual({
        "new-2": "2026-09-30T19:00:00.000Z",
        "new-1": "2026-09-27T08:00:00.000Z",
        "left-the-list": "2026-09-26T08:00:00.000Z",
      });
    });

    it("writes nothing once every entry is dated, and keeps one record per backend", async () => {
      store.set("qaReleases/prod", {
        items: { "new-1": "2026-09-27T08:00:00.000Z" },
      });
      await mirror.push();
      const before = await updatedAt();
      expect(
        await recordQaReleasesPg("prod", {
          "new-1": "2026-10-01T08:00:00.000Z",
        }),
      ).toEqual({ "new-1": "2026-09-27T08:00:00.000Z" });
      expect(await updatedAt()).toBe(before);
      expect(
        await recordQaReleasesPg("autopush", {
          "new-1": "2026-09-26T10:00:00.000Z",
        }),
      ).toEqual({ "new-1": "2026-09-26T10:00:00.000Z" });
      expect(await recordQaReleasesPg("local", {})).toEqual({});
    });

    it("agrees on one start when a rollout's instances start together", async () => {
      await mirror.push();
      const records = await Promise.all(
        ["a", "b", "c"].map((instance) =>
          recordQaReleasesPg("prod", {
            "new-1": `2026-10-01T08:00:0${instance === "a" ? 1 : instance === "b" ? 2 : 3}.000Z`,
          }),
        ),
      );
      expect(new Set(records.map((r) => r["new-1"])).size).toBe(1);
    });
  });
});
