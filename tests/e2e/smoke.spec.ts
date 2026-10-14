import { expect, test } from "@playwright/test";
import { openFirstContent, ROUTES } from "./routes";

for (const route of ROUTES) {
  test(`${route} renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("a content workspace renders", async ({ page }) => {
  await openFirstContent(page);
  await expect(page.locator("main h1")).toBeVisible();
});
