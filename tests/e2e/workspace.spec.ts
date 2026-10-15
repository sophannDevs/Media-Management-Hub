import { expect, test } from "@playwright/test";

// PERF-05: a script version's text is fetched when it is opened, not sent with the page.
test("opening a script version loads its text on demand", async ({ page }) => {
  await page.goto("/content?q=10%20AI%20Tools");
  const href = await page.locator('a[href^="/content/c"]').first().getAttribute("href");
  await page.goto(`${href}?tab=script`);
  await page.waitForLoadState("networkidle");

  // The versions list is there, but no version's text is in the page yet
  await expect(page.getByRole("button", { name: "View version 1" })).toBeVisible();
  const requests: string[] = [];
  page.on("request", (r) => r.url().includes("/api/script-versions/") && requests.push(r.url()));

  await page.getByRole("button", { name: "View version 1" }).click();
  const dialog = page.getByRole("dialog", { name: "Version 1" });
  await expect(dialog.getByText("[HOOK — 0:00]")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy" })).toBeEnabled();
  expect(requests).toHaveLength(1);
});
