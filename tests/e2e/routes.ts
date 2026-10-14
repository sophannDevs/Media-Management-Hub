import type { Page } from "@playwright/test";

/** Every top-level page of the app. */
export const ROUTES = ["/", "/content", "/calendar", "/schedule", "/media", "/prompts", "/accounts", "/analytics", "/settings"];

/** Opens the first content item's workspace (ids differ per seed). */
export async function openFirstContent(page: Page) {
  await page.goto("/content");
  const href = await page.locator('a[href^="/content/c"]').first().getAttribute("href");
  if (!href) throw new Error("No content item found in the seeded data.");
  await page.goto(href);
  return href;
}
