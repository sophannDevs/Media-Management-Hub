import { expect, test } from "@playwright/test";

// PERF-01: the list renders one view (chosen on the server, remembered in a
// cookie) and sorts in SQL from the column headers.

// A click on a link before the page has hydrated is dropped by React's event
// replay, so each test lets the page settle before clicking.

test("renders one view: cards on phones, the table elsewhere, and remembers a choice", async ({ page, isMobile }) => {
  await page.goto("/content");
  await expect(page.getByRole("table")).toHaveCount(isMobile ? 0 : 1);
  await expect(page.getByText(/^Showing 1–\d+ of \d+$/)).toBeVisible();
  await page.waitForLoadState("networkidle");

  const other = isMobile ? "Table" : "Cards";
  await page.getByRole("link", { name: other, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`view=${other.toLowerCase()}`));
  await page.goto("/content");
  await expect(page.getByRole("table")).toHaveCount(isMobile ? 1 : 0);
});

test("sorts by a column header, then reverses", async ({ page }) => {
  await page.goto("/content?view=table");
  await page.waitForLoadState("networkidle");
  const header = page.getByRole("columnheader", { name: "Content" });
  await header.getByRole("link").click();
  await expect(page).toHaveURL(/sort=title&dir=asc/);
  await expect(header).toHaveAttribute("aria-sort", "ascending");

  const titles = async () => (await page.getByRole("row").locator("td:nth-child(2) a").allTextContents()).map((t) => t.toLowerCase());
  const asc = await titles();
  expect(asc.length).toBeGreaterThan(5);
  expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));

  await page.waitForLoadState("networkidle");
  await header.getByRole("link").click();
  await expect(page).toHaveURL(/sort=title&dir=desc/);
  await expect(header).toHaveAttribute("aria-sort", "descending");
  expect(await titles()).toEqual([...asc].reverse());
});
