import { expect, type Page, test } from "@playwright/test";

// A11Y-04 / UX-01: a post can be rescheduled without dragging (keyboard, menu,
// dialog), and on a phone the calendar is a list instead of a 720 px grid.
// The projects share one database, so each test moves a different seeded post
// and runs in one project only. Seeded posts used here sit 1, 2 and 4 days
// from today, which is always inside the month grid.

const addDay = (key: string, n = 1) => new Date(Date.parse(`${key}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The month-grid chip for one post on one platform. */
const chipFor = (page: Page, title: string, platform: string) => page.locator(`a[data-chip][title*="${platform}"]`).filter({ hasText: title });
const dayOf = (chip: ReturnType<typeof chipFor>) => chip.locator("xpath=ancestor::*[@data-day]").getAttribute("data-day");

test("the keyboard picks a post up, moves it a day and drops it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");
  const chip = chipFor(page, "10 AI Tools That Will Replace Your Workflow in 2027", "YouTube");
  // The calendar's own live region (the page has others: the header's shortcut hint, dialogs)
  const status = page.locator("#calendar-move-status");

  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");
  await expect(chip).toHaveCount(1);
  const from = (await dayOf(chip))!;

  // The instructions are attached to the chip for screen readers
  await expect(chip).toHaveAttribute("aria-describedby", "calendar-move-help");
  await expect(page.locator("#calendar-move-help")).toContainText("Press Space to pick this post up");

  // Escape puts it back
  await chip.focus();
  await page.keyboard.press("Space");
  await expect(status).toContainText("Picked up");
  await page.keyboard.press("ArrowRight");
  await expect(status).toContainText(/^\w{3}, \w{3} \d+\./);
  await page.keyboard.press("Escape");
  await expect(status).toHaveText("Move cancelled.");
  expect(await dayOf(chip)).toBe(from);

  // Enter drops it one day later and keeps the keyboard on it
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Rescheduled to /)).toBeVisible();
  await expect(status).toContainText("Moved to");
  await expect.poll(() => dayOf(chip)).toBe(addDay(from));
  await expect(chip).toBeFocused();

  // Saved, not just shown
  await page.reload();
  expect(await dayOf(chip)).toBe(addDay(from));
});

test("the actions menu and dialog reschedule a post on a touch screen", async ({ page }, info) => {
  test.skip(info.project.name !== "tablet", "mutates the shared e2e database");
  const chip = chipFor(page, "Behind the Scenes: My AI Video Pipeline", "YouTube");

  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");
  const from = (await dayOf(chip))!;

  await page.locator("div:has(> a[data-chip])").filter({ has: chip }).getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Reschedule…" }).click();

  const dialog = page.getByRole("dialog", { name: "Reschedule post" });
  await expect(dialog.getByLabel("Date")).toHaveValue(from);
  // Nothing to do until something changes
  await expect(dialog.getByRole("button", { name: "Reschedule", exact: true })).toBeDisabled();
  await dialog.getByLabel("Date").fill(addDay(from));
  await dialog.getByLabel("Time").fill("18:30");
  await dialog.getByRole("button", { name: "Reschedule", exact: true }).click();

  await expect(page.getByText(/^Rescheduled to /)).toBeVisible();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(chip).toHaveAttribute("title", /6:30 PM/);
  expect(await dayOf(chip)).toBe(addDay(from));
});

test("a phone gets a list by day, with no sideways scroll, and can reschedule from it", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "mutates the shared e2e database");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");

  // The grid is replaced, not squeezed
  await expect(page.getByLabel("Go to date")).toBeVisible();
  await expect(page.locator("[data-day]").first()).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const item = page.locator('section[aria-labelledby^="agenda-"] li').filter({ hasText: "10 AI Tools That Will Replace Your Workflow in 2027" }).filter({ hasText: "Facebook" });
  await expect(item).toContainText("11:00 AM");
  await item.getByRole("button", { name: /^Reschedule/ }).click();

  const dialog = page.getByRole("dialog", { name: "Reschedule post" });
  await dialog.getByLabel("Time").fill("12:15");
  await dialog.getByRole("button", { name: "Reschedule", exact: true }).click();
  await expect(page.getByText(/^Rescheduled to /)).toBeVisible();
  await expect(item).toContainText("12:15 PM");

  await page.reload();
  await expect(item).toContainText("12:15 PM");
});

test("the month grid and its menus stay inside the page on every width", async ({ page }) => {
  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
