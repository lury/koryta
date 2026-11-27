import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";
import { deleteByPrefix, putDocs } from "./helpers/db";
import { QA_ITEMS } from "../../shared/qa";

/** That /aktywnosc keeps a reader's own work out of the list until they untick
 * "Ukryj moje zmiany" and then shows it named, masks an administrator's
 * decision, and that only an administrator gets the filter for the
 * administrators on trial.
 *
 * The local fixtures seed no votes and no audit rows - the stats page's
 * visual baseline depends on that - so this spec files one of each, dated now,
 * and takes them away again. What a batch says and how it folds is the unit
 * tests' job; this is the page, the endpoint and the auth between them.
 *
 * The feed is memoized per window for five minutes, so the rows go in before
 * any page asks for it, and nothing warms /aktywnosc in global-setup.
 */
const RUN = Date.now();
const PREFIX = "actfeed";
const personId = `${PREFIX}${RUN}p`;
const personName = `Aktywna Osoba ${RUN}`;
const auditId = `${PREFIX}${RUN}a`;
/** `votes` rows are keyed `${target}_${uid}`; written here as the seeded
 * normal user's. */
const voteId = `${personId}_test-user`;

/** Everything any run of this spec left behind - a failed run skips its
 * `afterAll`, and a leftover vote dated inside the window would put a second
 * line where this one expects its own. */
async function clearPreviousRuns() {
  for (const collection of ["votes", "audit", "nodes"] as const) {
    await deleteByPrefix(collection, PREFIX);
  }
}

test.beforeAll(async () => {
  await clearPreviousRuns();
  const now = new Date().toISOString();
  await putDocs("nodes", {
    [personId]: {
      name: personName,
      type: "person",
      published: true,
      stats: { nodeGroupSize: 1, isApproved: true },
    },
  });
  await putDocs("votes", {
    [voteId]: {
      nodeId: personId,
      userUid: "test-user",
      categoryVotes: { interesting: 3 },
      updatedAt: now,
    },
  });
  await putDocs("audit", {
    [auditId]: {
      action: "publish",
      collection: "nodes",
      target_id: personId,
      user: "test-admin",
      at: now,
    },
  });
});

test.afterAll(async () => {
  await clearPreviousRuns();
});

/** This spec's line of one kind: another spec's vote or publication, left in
 * the database, says the same words about a different page. */
const lineOf = (page: Page, sentence: string) =>
  page
    .getByTestId("feed-item")
    .filter({ hasText: sentence })
    .filter({ has: page.getByRole("link", { name: personName }) });

test("a reader sees an admin's publication masked, and their own vote once they ask", async ({
  page,
}) => {
  await logIn(page, USERS.normal, "/aktywnosc");
  await expect(page.getByRole("heading", { name: "Aktywność" })).toBeVisible();

  const published = lineOf(page, "opublikował/a 1 osobę");
  await expect(published).toBeVisible({ timeout: 30_000 });
  await expect(published).toContainText("Anonim");
  await expect(published).not.toContainText("Admin User");

  // Loaded with the publication, and hidden until the box is unticked.
  const own = lineOf(page, "ocenił/a 1 osobę");
  await expect(own).toHaveCount(0);
  const hideMine = page.getByRole("checkbox", { name: "Ukryj moje zmiany" });
  await expect(hideMine).toHaveAttribute("aria-checked", "true");
  await hideMine.click();
  await expect(page).toHaveURL(/moje=tak/);
  await expect(own).toBeVisible();
  await expect(own).toContainText("Ty");

  await expect(page.getByTestId("activity-new-admins")).toHaveCount(0);
});

test("an administrator sees names and the filter for administrators on trial", async ({
  page,
}) => {
  await logIn(page, USERS.admin, "/aktywnosc");

  await expect(lineOf(page, "ocenił/a 1 osobę")).toContainText("Normal User", {
    timeout: 30_000,
  });
  // The publication is the administrator's own, so it waits for the box.
  const published = lineOf(page, "opublikował/a 1 osobę");
  await expect(published).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Ukryj moje zmiany" }).click();
  await expect(published).toBeVisible();
  await expect(published).toContainText("Admin User");

  await page.getByTestId("activity-new-admins").click();
  await expect(page).toHaveURL(/kto=nowi-admini/);
  await expect(page.getByTestId("activity-new-admin-list")).toContainText(
    "Nikt nie ma teraz statusu nowego administratora.",
  );
});

test("the newest change to the site is under the day this server started", async ({
  page,
}) => {
  // No rollout before the record shipped the newest entry, so the server
  // dated it itself as it started - which is today, on a fresh database. As
  // an administrator, who is told about every area of the site.
  const newest = QA_ITEMS[0]!;
  await logIn(page, USERS.admin, "/aktywnosc");

  const today = page
    .getByTestId("activity-day")
    .filter({ has: page.getByRole("heading", { name: "Dzisiaj" }) });
  const change = today
    .getByTestId("activity-site-change")
    .filter({ hasText: newest.title });
  await expect(change).toBeVisible({ timeout: 30_000 });

  await change.getByTestId("activity-site-change-toggle").click();
  await expect(change).toContainText(newest.description);
  await change.getByTestId("activity-site-change-qa").click();
  await expect(page).toHaveURL(new RegExp(`/qa#qa-${newest.id}$`));
});
