import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type postgres from "postgres";
import { notifyUser } from "~~/server/utils/notifications";
import { notifyRevisionReviewed } from "~~/server/utils/revisionNotifications";
import type { NotificationEvent } from "~~/shared/notifications";
import {
  closeTestDatabase,
  Collections,
  openTestDatabase,
  PG_TEST_DATABASE_URL,
} from "./pgHarness";

/** The mail a review queues on Postgres: who gets it, what it says and under
 * which id, and that it never fails the review it reports on.
 *
 *   PG_TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/koryta_test \
 *     npx vitest run tests/server/db/revisionNotifications.pg.test.ts
 */

/** Firebase Auth's accounts, by uid; a uid with none makes getUser throw. */
const accounts = new Map<string, { email?: string; emailVerified?: boolean }>();
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async (uid: string) => {
      const account = accounts.get(uid);
      if (!account) throw new Error(`no account ${uid}`);
      return { uid, ...account };
    },
  }),
}));

const store = new Collections();
const table = store.table.bind(store);
let sql: postgres.Sql;

type Mail = {
  to: string[];
  kind: string;
  uid: string;
  message: { subject: string; text: string; html: string };
};
const mail = async () =>
  sql<{ id: string; data: Mail }[]>`SELECT id, data FROM mail ORDER BY id`;

const APPROVED: NotificationEvent = {
  kind: "revisionApproved",
  target: { name: "Jan Kowalski", path: "/osoba/jan-kowalski-n1" },
  published: true,
};
const OPTIONS = { dedupeKey: "rev-1", siteUrl: "https://koryta.pl" };
const send = (event = APPROVED, options: Record<string, unknown> = {}) =>
  notifyUser("author-uid", event, { ...OPTIONS, ...options });

describe.runIf(PG_TEST_DATABASE_URL)("review notifications on Postgres", () => {
  beforeAll(async () => {
    sql = await openTestDatabase("revw_notify");
  }, 120_000);
  afterAll(async () => {
    await closeTestDatabase(sql);
  });
  beforeEach(async () => {
    store.clear();
    await store.sync(sql);
    accounts.clear();
    accounts.set("author-uid", {
      email: "autor@example.com",
      emailVerified: true,
    });
  });

  describe("notifyUser", () => {
    it("queues a message the outbox can deliver, keyed by kind and revision", async () => {
      expect(await send()).toBe("sent");
      const [row] = await mail();
      expect(row!.id).toBe("revisionApproved_rev-1");
      expect(row!.data.to).toEqual(["autor@example.com"]);
      expect(row!.data.message.subject).toContain("Jan Kowalski");
      expect(row!.data.message.html).toContain("https://koryta.pl/osoba");
      expect(row!.data).toMatchObject({
        kind: "revisionApproved",
        uid: "author-uid",
      });
    });

    it("sends to a user who has never opened their settings", async () => {
      expect(await sql`SELECT 1 FROM users`).toHaveLength(0);
      expect(await send()).toBe("sent");
    });

    it("respects an opt out, and only for the kind opted out of", async () => {
      table("users")["author-uid"] = {
        notifications: { revisionApproved: false },
      };
      await store.sync(sql);
      expect(await send()).toBe("opted-out");
      expect(await mail()).toHaveLength(0);
      expect(
        await send({
          kind: "revisionRejected",
          target: { name: "Jan Kowalski" },
          reason: "brak źródła",
        }),
      ).toBe("sent");
    });

    it("refuses an unverified address, and has nothing to do without one", async () => {
      accounts.set("author-uid", {
        email: "ktos@example.com",
        emailVerified: false,
      });
      expect(await send()).toBe("unverified-address");
      accounts.set("author-uid", { emailVerified: false });
      expect(await send()).toBe("no-address");
      expect(await mail()).toHaveLength(0);
    });

    it("does not tell an admin what they just did themselves", async () => {
      expect(await send(APPROVED, { actorUid: "author-uid" })).toBe("self");
      expect(await mail()).toHaveLength(0);
    });

    it("sends once for the same decision, and keeps the queued one", async () => {
      expect(await send()).toBe("sent");
      await sql`UPDATE mail SET data = data || '{"delivery":{"state":"SUCCESS"}}'`;
      expect(await send()).toBe("duplicate");
      const rows = await mail();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data).toHaveProperty("delivery");
    });

    it("never fails the action it reports on, when the outbox cannot be written", async () => {
      await sql`ALTER TABLE mail RENAME TO mail_away`;
      try {
        await expect(send()).resolves.toBe("failed");
      } finally {
        await sql`ALTER TABLE mail_away RENAME TO mail`;
      }
    });

    it("survives an auth lookup that throws", async () => {
      accounts.clear();
      await expect(send()).resolves.toBe("failed");
      expect(await mail()).toHaveLength(0);
    });
  });

  describe("notifyRevisionReviewed", () => {
    const approve = (
      revision: Record<string, unknown>,
      target: { collection: "nodes" | "edges"; id: string } = {
        collection: "nodes",
        id: "node-1",
      },
    ) =>
      notifyRevisionReviewed({
        decision: "approved",
        published: true,
        revisionId: "rev-1",
        revision,
        target,
        reviewerUid: "admin-uid",
        siteUrl: "https://koryta.pl",
      });
    const reject = (reason: string, data: Record<string, unknown> = {}) =>
      notifyRevisionReviewed({
        decision: "rejected",
        reason,
        revisionId: "rev-1",
        revision: { update_user: "author-uid", data },
        target: { collection: "nodes", id: "node-1" },
        reviewerUid: "admin-uid",
        siteUrl: "https://koryta.pl",
      });
    const arrange = async (docs: Record<string, Record<string, unknown>>) => {
      for (const [path, data] of Object.entries(docs)) {
        const [name, id] = path.split("/") as ["nodes" | "edges", string];
        table(name)[id!] = data;
      }
      await store.sync(sql);
    };
    const only = async () => {
      const rows = await mail();
      expect(rows).toHaveLength(1);
      return rows[0]!;
    };

    it("writes to the author about the page they changed, keyed on the revision", async () => {
      expect(
        await approve({
          update_user: "author-uid",
          data: { name: "Jan Kowalski", type: "person" },
        }),
      ).toBe("sent");
      const row = await only();
      expect(row.id).toBe("revisionApproved_rev-1");
      expect(row.data.uid).toBe("author-uid");
      expect(row.data.message.text).toContain(
        "https://koryta.pl/osoba/jan-kowalski-node-1",
      );
      // Published: nothing about the page not being visible yet.
      expect(row.data.message.text).not.toContain("nie jest jeszcze widoczna");
      // The reviewer approving their own edit hears nothing.
      await sql`TRUNCATE mail`;
      expect(
        await notifyRevisionReviewed({
          decision: "approved",
          published: true,
          revisionId: "rev-1",
          revision: { update_user: "admin-uid", data: {} },
          target: { collection: "nodes", id: "node-1" },
          reviewerUid: "admin-uid",
          siteUrl: "https://koryta.pl",
        }),
      ).toBe("self");
    });

    it("carries the reason through a rejection, named from the stored page", async () => {
      await arrange({
        "nodes/node-1": { name: "Jan Kowalski", type: "person" },
      });
      await reject("brak źródła");
      const row = await only();
      expect(row.data.kind).toBe("revisionRejected");
      expect(row.data.message.subject).toContain("Jan Kowalski");
      expect(row.data.message.text).toContain("Powód: brak źródła");
    });

    it("re-sends a rejection whose reason has changed, but not one repeated", async () => {
      await reject("brak źródła", { name: "X" });
      expect(await reject("brak źródła", { name: "X" })).toBe("duplicate");
      await reject("źródło nie potwierdza daty", { name: "X" });
      const ids = (await mail()).map((r) => r.id);
      expect(ids).toHaveLength(2);
      for (const id of ids) expect(id).toMatch(/^revisionRejected_rev-1_/);
    });

    it("says nothing to a pipeline, or for a revision that predates update_user", async () => {
      expect(
        await approve({
          update_user: "datascience-sa",
          update_automatic: true,
          data: { name: "X", type: "person" },
        }),
      ).toBe("no-recipient");
      expect(await approve({ data: { name: "X", type: "person" } })).toBe(
        "no-recipient",
      );
      expect(await mail()).toHaveLength(0);
    });

    it("prefers the name being proposed over the one on the page", async () => {
      await arrange({
        "nodes/node-1": { name: "Jan Kowaski", type: "person" },
      });
      await approve({
        update_user: "author-uid",
        data: { name: "Jan Kowalski", type: "person" },
      });
      expect((await only()).data.message.subject).toContain("„Jan Kowalski”");
    });

    it("fills the gaps in a partial revision from the stored page", async () => {
      await arrange({
        "nodes/node-1": { name: "Jan Kowalski", type: "person" },
      });
      await approve({ update_user: "author-uid", data: { content: "opis" } });
      expect((await only()).data.message.text).toContain(
        "https://koryta.pl/osoba/jan-kowalski-node-1",
      );
    });

    it("describes a relation by the node at its source, stored or proposed", async () => {
      await arrange({
        "nodes/person-1": { name: "Jan Kowalski", type: "person" },
        "edges/edge-1": {
          type: "employed",
          source: "person-1",
          target: "place-1",
        },
      });
      await approve(
        {
          update_user: "author-uid",
          data: { name: "Członek zarządu", source: "person-1", target: "p" },
        },
        { collection: "edges", id: "edge-1" },
      );
      const proposed = await only();
      expect(proposed.data.message.subject).toContain("Jan Kowalski");
      expect(proposed.data.message.text).toContain(
        "/osoba/jan-kowalski-person-1",
      );

      await sql`TRUNCATE mail`;
      await approve(
        { update_user: "author-uid", data: { end_date: "2024-01-01" } },
        { collection: "edges", id: "edge-1" },
      );
      expect((await only()).data.message.subject).toContain("Jan Kowalski");
    });

    it("still writes when there is no page to link to", async () => {
      await approve({ update_user: "author-uid", data: {} });
      const row = await only();
      expect(row.data.message.subject).toContain("„node-1”");
      expect(row.data.message.text).not.toContain("Zobacz stronę");
    });
  });
});
