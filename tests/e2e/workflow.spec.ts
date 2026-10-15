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

// WF-07: archiving takes the waiting posts out of the queue; restoring can put them back.
test("restoring archived content can put its posts back in the queue", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");
  const title = "AI Tools Every Teacher Should Try";

  await page.goto(`/content?q=${encodeURIComponent(title)}`);
  const href = await page.locator('a[href^="/content/c"]').first().getAttribute("href");
  await page.goto(href!);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByText("Archived — 2 posts taken out of the queue")).toBeVisible();

  await page.goto("/settings");
  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item.getByText("2 posts taken out of the queue")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await item.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Restore with posts" }).click();
  await expect(page.getByText("Restored — 2 posts back in the queue")).toBeVisible();
  await expect(item).toHaveCount(0);
});

// PERF-04: the Create Content options are cached across requests; adding a
// category must expire that cache at once.
test("a new category appears in the Create Content dialog right away", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");
  const name = `E2E category ${Date.now()}`;

  await page.goto("/prompts");
  await page.getByRole("button", { name: /Create content/i }).click(); // fills the cache
  await page.keyboard.press("Escape");

  await page.goto("/settings");
  await page.getByRole("button", { name: "Add category" }).click();
  await page.getByRole("textbox", { name: "New category name" }).fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("list", { name: "Categories" }).getByText(name)).toBeVisible();
  // The change is on record with who made it (DB-05)
  const latest = page.getByRole("list", { name: "Recent changes" }).getByRole("listitem").first();
  await expect(latest).toContainText(`Category created: ${name}`);
  await expect(latest).toContainText("Workspace Owner");

  await page.goto("/prompts");
  await page.getByRole("button", { name: /Create content/i }).click();
  await page.getByRole("combobox", { name: "Category" }).click();
  await expect(page.getByRole("option", { name })).toBeVisible();
});

// WF-05: "Delete" moves content to the trash; Settings brings it back.
test("deleting content moves it to the trash, where it can be restored", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");
  const title = "Kampot Pepper: From Farm to Table";

  await page.goto(`/content?q=${encodeURIComponent(title)}`);
  const href = await page.locator('a[href^="/content/c"]').first().getAttribute("href");
  await page.goto(href!);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("Content that was published somewhere is never removed without your say-so.")).toBeVisible();
  await page.getByRole("button", { name: "Move to trash" }).click();
  await expect(page).toHaveURL(/\/content(\?|$)/);

  // Gone from the list, waiting in the trash
  await page.goto(`/content?q=${encodeURIComponent(title)}`);
  await expect(page.getByText("No content matches these filters")).toBeVisible();
  await page.goto("/settings");
  const item = page.getByRole("list", { name: "Trash" }).getByRole("listitem").filter({ hasText: title });
  await expect(item).toBeVisible();
  await expect(item).toContainText(/removed for good on|kept until you remove it/);
  await page.waitForLoadState("networkidle");
  await item.getByRole("button", { name: "Restore" }).click();
  const withPosts = page.getByRole("button", { name: "Restore with posts" });
  if (await withPosts.isVisible({ timeout: 1500 }).catch(() => false)) await withPosts.click();
  await expect(page.getByText(/Restored from the trash/)).toBeVisible();
  await expect(item).toHaveCount(0);

  await page.goto(`/content?q=${encodeURIComponent(title)}`);
  await expect(page.locator('a[href^="/content/c"]').first()).toBeVisible();
});

// WF-06: a review decision says who and why.
test("requesting changes needs a comment, which the history then shows with its author", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");

  await page.goto("/content?q=Siem%20Reap");
  const href = await page.locator('a[href^="/content/c"]').first().getAttribute("href");
  await page.goto(href!);
  await page.waitForLoadState("networkidle");
  const request = page.getByRole("button", { name: "Request changes" });
  await expect(request).toBeDisabled();
  await page.getByRole("textbox", { name: "Review comment" }).fill("Tighten the intro");
  await request.click();
  await expect(page.getByText(/Changes Requested by Workspace Owner/)).toBeVisible();

  await page.goto(`${href}?tab=activity`);
  await expect(page.getByText("Changes requested: “Tighten the intro”")).toBeVisible();
  await expect(page.getByText("Tighten the intro", { exact: true })).toBeVisible();
});
