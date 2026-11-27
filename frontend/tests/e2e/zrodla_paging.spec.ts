import { test, expect } from "@playwright/test";
import { at, deleteDocs, putDocs } from "./helpers/db";

/** That /zrodla's pager reaches the whole list, not the slice it was handed.
 *
 * The table used to fetch `limit=100, page=1` once and page inside that in the
 * browser, so an article older than the hundredth newest had no route to it -
 * on the page whose job is to list what the site was built from. Two pages of
 * fifty is exactly what the bug looks like from the footer, which is why this
 * seeds past a hundred: with fewer articles than that the broken version and
 * the fixed one behave identically.
 *
 * The seeded articles are dated 1971 so they sort below everything the
 * local seed and the other /zrodla specs put on the first page. The bug is
 * about the far end of the list, and staying off page one keeps this spec from
 * moving the rows those specs measure.
 */
const RUN = Date.now();
const COUNT = 110;
const ids = Array.from(
  { length: COUNT },
  (_, i) => `zrodla-paging-${RUN}-${i}`,
);
const title = (i: number) =>
  `Paginacja ${RUN} artykul ${String(i).padStart(3, "0")}`;

// Index 0 is the oldest, so it lands on the last page whatever else exists.
const OLDEST = title(0);

test.beforeAll(async () => {
  await putDocs(
    "nodes",
    Object.fromEntries(
      ids.map((id, i) => [
        id,
        {
          name: title(i),
          type: "article",
          sourceURL: `http://example-paging.test/${i}`,
          published: true,
          stats: { nodeGroupSize: 1, isApproved: true },
          publishedDate: at(Date.UTC(1971, 0, 1 + i)),
        },
      ]),
    ),
  );
});

test.afterAll(async () => {
  await deleteDocs("nodes", ids);
});

test("the oldest article is reachable from the pager", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/zrodla");

  // The table is stacked in the server-rendered markup and becomes columnar
  // once the client knows the width; the header only exists in the second.
  await page.locator("thead th").first().waitFor({ timeout: 30_000 });
  await expect(
    page.locator('[data-testid="zrodla-article-link"]').first(),
  ).toBeVisible({ timeout: 30_000 });

  // The count comes from the server rather than from the length of one fetch,
  // so the footer knows about every article and not just the first hundred.
  // Read as the last number in "1-50 of 119" instead of matched against a
  // total, because the other /zrodla specs seed rows of their own.
  const info = await page
    .locator(".v-data-table-footer__info")
    .first()
    .innerText();
  const total = Number(info.match(/(\d+)\D*$/)?.[1]);
  expect(total).toBeGreaterThanOrEqual(COUNT);

  // Not on the first page - if it were, this would pass without a pager.
  await expect(page.getByText(OLDEST)).toHaveCount(0);

  await page.locator(".v-pagination__last button").click();

  await expect(page.getByText(OLDEST).first()).toBeVisible({
    timeout: 30_000,
  });
});
