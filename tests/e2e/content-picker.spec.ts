import { expect, test } from "@playwright/test";

// PERF-11: content pickers search on the server as you type instead of
// shipping every title with the page.

test("the schedule dialog finds content by typing", async ({ page }) => {
  await page.goto("/schedule");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Schedule post" }).first().click();

  const picker = page.getByRole("combobox", { name: "Content" });
  await expect(picker).not.toHaveValue(""); // opens on a ready item
  await picker.click();
  await picker.fill("coffee");
  const option = page.getByRole("option", { name: /Coffee Science/ });
  await expect(option).toContainText("not ready");
  await option.click();

  await expect(picker).toHaveValue("Coffee Science: The Perfect Pour-Over");
  await expect(page.getByText("This content isn't ready to post yet")).toBeVisible();
});

test("the media library filters by a content found by typing", async ({ page }) => {
  await page.goto("/media");
  await page.waitForLoadState("networkidle");
  const picker = page.getByRole("combobox", { name: "Content" });
  await expect(picker).toHaveAttribute("placeholder", "All content");
  await picker.click();
  await picker.fill("kampot");
  await page.getByRole("option", { name: "Kampot Pepper: From Farm to Table" }).click();

  await expect(page).toHaveURL(/content=c/);
  await expect(picker).toHaveValue("Kampot Pepper: From Farm to Table");
});
