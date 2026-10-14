import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GlobalError from "@/app/global-error";

// ARCH-04: the page shown when the root layout itself fails. It replaces the
// whole document with its own styles, so it gets its own accessibility check.
test("the root error page is readable, labelled and accessible", async ({ page }) => {
  const html = renderToStaticMarkup(createElement(GlobalError, { error: Object.assign(new Error("boom"), { digest: "1226774921" }), retry: () => {} }));
  await page.setContent(`<!doctype html>${html}`);

  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("for reference 1226774921");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});
