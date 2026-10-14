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

// UX-02. These change the shared e2e database, so they run once (desktop).

test("changes a production status from the list in one click", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");
  await page.goto("/content?view=table&q=Morning%20Routine");
  await page.waitForLoadState("networkidle");
  const row = page.getByRole("row").filter({ hasText: "Morning Routine of Highly Productive People" });
  await row.getByRole("button", { name: /^Script: Generated/ }).click();
  await page.getByRole("menuitem", { name: "Needs Revision" }).click();
  await expect(page.getByText("Script updated")).toBeVisible();
  await expect(row.getByRole("button", { name: /^Script: Needs Revision/ })).toBeVisible();
});

test("archiving from the list can be undone", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");
  const title = "Stoic Lessons for Modern Life";
  await page.goto("/content?view=table&q=Stoic");
  await page.waitForLoadState("networkidle");
  await page.getByRole("row").filter({ hasText: title }).getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Restored", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible();
});

test("saves the current filters and sort as a view and reopens it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");
  await page.goto("/content?priority=HIGH&sort=title&dir=asc");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Saved views" }).click();
  await page.getByRole("menuitem", { name: "Save current view…" }).click();
  await page.getByLabel("Name").fill("E2E high priority");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByText("Saved view “E2E high priority”")).toBeVisible();

  await page.goto("/content");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Saved views" }).click();
  await page.getByRole("menuitem", { name: "E2E high priority" }).click();
  await expect(page).toHaveURL(/\/content\?priority=HIGH&sort=title&dir=asc$/);
  const menu = page.getByRole("button", { name: "Saved views, showing E2E high priority" });
  await expect(menu).toBeVisible();

  await page.waitForLoadState("networkidle");
  await menu.click();
  await page.getByRole("menuitem", { name: "Delete “E2E high priority”" }).click();
  await expect(page.getByText("View deleted")).toBeVisible();
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
