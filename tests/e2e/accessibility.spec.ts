import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { openFirstContent, ROUTES } from "./routes";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

/** Serious and critical WCAG A/AA violations on the current page, as "rule (count): first target". */
async function seriousViolations(page: Page) {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(" ")}`);
}

// A11Y-01 (contrast), A11Y-02 (names), A11Y-03 (target size): zero serious or
// critical violations on every page at every width.
for (const route of ROUTES) {
  test(`${route} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(route);
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test("a content workspace has no serious accessibility violations", async ({ page }) => {
  await openFirstContent(page);
  expect(await seriousViolations(page)).toEqual([]);
});

test("the Create Content dialog has no serious accessibility violations", async ({ page }) => {
  await page.goto("/prompts");
  await page.getByRole("button", { name: /Create content/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
