import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { openFirstContent, ROUTES } from "./routes";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

/** Serious and critical WCAG A/AA violations on the current page, as "rule (count)". */
async function seriousViolations(page: Page) {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length})`);
}

// Known failures from the audit (A11Y-01 contrast, A11Y-02 names). These
// tests flip to passing as part of the accessibility work.
for (const route of ROUTES) {
  test(`${route} has no serious accessibility violations`, async ({ page }) => {
    test.fail(true, "A11Y-01 / A11Y-02 not fixed yet");
    await page.goto(route);
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test("a content workspace has no serious accessibility violations", async ({ page }) => {
  test.fail(true, "A11Y-01 / A11Y-02 not fixed yet");
  await openFirstContent(page);
  expect(await seriousViolations(page)).toEqual([]);
});
