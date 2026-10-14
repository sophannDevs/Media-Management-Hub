import { expect, test } from "@playwright/test";

// WF-01: soft requirements can be waived for one post, with a reason that is
// shown on the post. Runs once (desktop): the projects share one database.
test("a post can be scheduled before Ready to Post with a reason", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");

  await page.goto("/content?q=Coffee%20Science");
  const href = await page.locator('a[href^="/content/c"]').first().getAttribute("href");
  await page.goto(`${href}?tab=publishing`);

  await page.getByRole("button", { name: "Add schedule" }).click();
  await expect(page.getByText("This content isn't ready to post yet")).toBeVisible();
  await page.getByLabel(/Schedule anyway/).check();
  await page.getByRole("textbox", { name: "Reason" }).fill("Client approved the cut by phone");
  await page.getByRole("button", { name: "Schedule post" }).click();

  await expect(page.getByText("Scheduled before Ready to Post")).toBeVisible();
  await expect(page.getByText("Client approved the cut by phone")).toBeVisible();
});
