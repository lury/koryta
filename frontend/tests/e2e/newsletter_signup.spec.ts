import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";
import { readDoc, readDocs } from "./helpers/db";

/** The newsletter for readers without an account: the form on the home
 * page, the confirmation mail (server/utils/newsletterSubscribers.ts),
 * the page that confirms, and the way out from a campaign's footer. */

async function confirmationMails(email: string) {
  return readDocs("mail", {
    kind: "newsletterConfirmation",
    to: [email],
  });
}

async function signUpOnTheHomePage(page: Page, email: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const form = page.locator("[data-newsletter-signup]");
  await expect(form).toBeVisible({ timeout: 30_000 });
  // Typed again until the field takes it: before hydration it drops input.
  const input = form.locator("[data-newsletter-signup-email] input");
  await expect(async () => {
    await input.fill(email);
    await expect(input).toHaveValue(email, { timeout: 500 });
    await form.locator("[data-newsletter-signup-submit]").click();
    await expect(page.locator("[data-newsletter-signup-done]")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}

test.describe("Newsletter without an account", () => {
  test("an address is confirmed from its mail, and can leave from a campaign's footer", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const email = `newsletter-bez-konta-${Date.now()}@example.com`;
    await signUpOnTheHomePage(page, email);
    await expect(page.locator("[data-newsletter-signup-done]")).toContainText(
      email,
    );

    let link = "";
    await expect(async () => {
      const [mail] = await confirmationMails(email);
      expect(mail).toBeTruthy();
      link = /https?:\/\/\S+\/newsletter\/potwierdz\?\S+/.exec(
        mail!.data.message.text,
      )![0];
    }).toPass({ timeout: 30_000 });
    const confirmUrl = new URL(link);
    const id = confirmUrl.searchParams.get("s")!;
    expect((await readDoc("newsletterSubscribers", id))?.status).toBe(
      "pending",
    );

    // Opening the link changes nothing; the button does.
    await page.goto(confirmUrl.pathname + confirmUrl.search, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-confirm-button]")).toBeVisible({
      timeout: 30_000,
    });
    expect((await readDoc("newsletterSubscribers", id))?.status).toBe(
      "pending",
    );
    await page.locator("[data-confirm-button]").click();
    await expect(page.locator("[data-confirm-done]")).toBeVisible({
      timeout: 30_000,
    });
    expect((await readDoc("newsletterSubscribers", id))?.status).toBe(
      "confirmed",
    );

    // The way out a campaign's footer gives a subscriber.
    const token = (await readDoc("mailTokens", `sub_${id}`))!.token as string;
    await page.goto(
      `/wypisz?u=sub_${id}&t=${encodeURIComponent(token)}&k=callsToAction`,
      { waitUntil: "domcontentloaded" },
    );
    await page.locator("[data-unsubscribe-confirm]").click();
    await expect(page.locator("[data-unsubscribe-done]")).toContainText(
      "Nie wyślemy już na ten adres",
      { timeout: 30_000 },
    );
    expect((await readDoc("newsletterSubscribers", id))?.topics).toEqual({
      callsToAction: false,
      recentPeople: true,
    });
  });

  test("a second request for the same address soon after sends no second mail", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const email = `newsletter-dwa-razy-${Date.now()}@example.com`;
    await signUpOnTheHomePage(page, email);
    await expect
      .poll(async () => (await confirmationMails(email)).length, {
        timeout: 30_000,
      })
      .toBe(1);

    await signUpOnTheHomePage(page, email);
    await page.waitForTimeout(2_000);
    expect(await confirmationMails(email)).toHaveLength(1);
  });

  test("a bot filling the hidden field is told it worked, and nothing is kept", async ({
    request,
  }) => {
    const email = `newsletter-bot-${Date.now()}@example.com`;
    const response = await request.post("/api/newsletter/subscribe", {
      data: { email, where: "home", website: "http://spam.example" },
    });
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({ ok: true });
    expect(await confirmationMails(email)).toHaveLength(0);
  });

  test("a signed-in reader is not offered the form", async ({ page }) => {
    test.setTimeout(240_000);
    await logIn(page, USERS.normal, "/");
    await expect(page.locator("[data-testid=home-help-cta]")).toBeVisible();
    await page.waitForTimeout(2_000);
    await expect(page.locator("[data-newsletter-signup]")).toHaveCount(0);
  });
});
