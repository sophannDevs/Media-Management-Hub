import { expect, test } from "@playwright/test";

// A11Y-05: the smaller semantic gaps in the custom controls. Nothing here
// changes data, so every project runs it.

test("the first Tab stop skips the navigation and lands on the page content", async ({ page }) => {
  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("the schedule dialog's toggles say which one is chosen and its labels are linked", async ({ page }) => {
  await page.goto("/content?q=Coffee%20Science");
  const href = await page.locator('a[href^="/content/c"]').first().getAttribute("href");
  await page.goto(`${href}?tab=publishing`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Add schedule" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Platform and visibility are single-choice toggle groups with a name and a state
  const platforms = dialog.getByRole("group", { name: "Platform" });
  await expect(platforms.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expect(platforms.locator("button[aria-pressed]").first()).toBeVisible();
  const visibility = dialog.getByRole("group", { name: "Visibility" });
  await expect(visibility.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await visibility.locator('button[aria-pressed="false"]').first().click();
  await expect(visibility.locator('button[aria-pressed="true"]')).toHaveCount(1);

  // The visible label is the control's name (no aria-label standing in for it)
  const timezone = dialog.getByRole("combobox", { name: "Timezone" });
  await expect(timezone).not.toHaveAttribute("aria-label");
  await expect(dialog.locator('label[for="sch-timezone"]')).toHaveText("Timezone");
  await expect(timezone).toHaveAttribute("id", "sch-timezone");

  // Search results are announced: the count lands in a status region
  const picker = dialog.getByRole("combobox", { name: "Content" });
  await picker.click();
  await expect(dialog.getByRole("status").filter({ hasText: /^\d+ results?$/ })).toBeAttached();
});

test("the Create Content dialog's priority buttons and selects are named and linked", async ({ page }) => {
  await page.goto("/prompts");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Create content/i }).click();
  const dialog = page.getByRole("dialog");

  const priority = dialog.getByRole("group", { name: "Priority" });
  await expect(priority.getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
  await priority.getByRole("button", { name: "High" }).click();
  await expect(priority.getByRole("button", { name: "High" })).toHaveAttribute("aria-pressed", "true");
  await expect(priority.getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "false");

  const category = dialog.getByRole("combobox", { name: "Category" });
  await expect(category).not.toHaveAttribute("aria-label");
  await expect(dialog.locator(`label[for="${await category.getAttribute("id")}"]`)).toHaveText("Category");
});

test("a system setting for less motion stops transitions", async ({ page }) => {
  await page.goto("/calendar");
  await page.waitForLoadState("networkidle");
  const button = page.getByRole("button", { name: /Create content/i });
  const seconds = () => button.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));

  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await seconds()).toBeGreaterThan(0.05);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await seconds()).toBeLessThan(0.001);
});
