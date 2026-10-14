import { expect, type Page, test } from "@playwright/test";
import { openFirstContent, ROUTES } from "./routes";

/** Collects uncaught page errors and Content-Security-Policy violations. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to (load|execute|connect|apply)/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

for (const route of ROUTES) {
  test(`${route} renders`, async ({ page }) => {
    const errors = watchErrors(page);
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("a content workspace renders", async ({ page }) => {
  const errors = watchErrors(page);
  await openFirstContent(page);
  await expect(page.locator("main h1")).toBeVisible();
  expect(errors).toEqual([]);
});
