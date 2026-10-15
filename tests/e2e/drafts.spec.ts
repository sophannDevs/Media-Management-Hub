import { expect, type Page, test } from "@playwright/test";

// UX-03: nothing typed is lost. The script editor and the Create Content form
// keep a draft, offer it back after a reload and never apply it on their own;
// the schedule dialog asks before throwing typed text away. The projects share
// one database, so the tests that write drafts run on the desktop project only.

async function openScript(page: Page, search: string) {
  await page.goto(`/content?q=${encodeURIComponent(search)}`);
  const href = await page.locator('a[href^="/content/c"]').first().getAttribute("href");
  await page.goto(`${href}?tab=script`);
  await page.waitForLoadState("networkidle");
  return href!.split("/").pop()!;
}

/** Drafts are left in the database by design; a test removes the one it made. */
const dropServerDraft = (page: Page, id: string) => page.request.delete(`/api/content/${id}/script-draft`);

test("the script editor keeps a draft and offers it back after a reload", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "writes a draft to the shared e2e database");
  const id = await openScript(page, "Stoic Lessons");
  const editor = page.getByRole("textbox", { name: "Script text" });
  const original = await editor.inputValue();
  const typed = `${original}\n\n[OUTRO — added in the e2e test]`;

  const kept = page.waitForResponse((r) => r.url().includes(`/api/content/${id}/script-draft`) && r.request().method() === "PUT");
  await editor.fill(typed);
  await expect(page.getByText(/Unsaved changes — draft kept/)).toBeVisible();
  expect((await kept).status()).toBe(200);

  // Back after a reload: offered, not applied
  await page.reload();
  await page.waitForLoadState("networkidle");
  const banner = page.getByRole("status").filter({ hasText: "never saved as a version" });
  await expect(banner).toBeVisible();
  await expect(editor).toHaveValue(original);
  await banner.getByRole("button", { name: "Restore it" }).click();
  await expect(editor).toHaveValue(typed);
  await expect(banner).toBeHidden();

  // Another browser has no local copy: the server's draft is offered
  await page.evaluate(() => {
    localStorage.clear();
    // Leaving this page must not write the local copy again
    Storage.prototype.setItem = () => {};
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(banner).toBeVisible();
  const gone = page.waitForResponse((r) => r.url().includes(`/api/content/${id}/script-draft`) && r.request().method() === "DELETE");
  await banner.getByRole("button", { name: "Discard" }).click();
  expect((await gone).status()).toBe(200);
  await expect(banner).toBeHidden();
  await expect(editor).toHaveValue(original);

  // Discarded for good
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("never saved as a version")).toHaveCount(0);
  await dropServerDraft(page, id);
});

test("closing the tab asks first when the browser cannot keep a draft", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "writes a draft to the shared e2e database");
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  // Nor does the server get one, so the text really exists only in the editor
  await page.route("**/script-draft", (route) => route.abort());
  await openScript(page, "Weekly AI News Recap");
  const editor = page.getByRole("textbox", { name: "Script text" });
  await editor.click();
  await editor.pressSequentially("A hook that exists nowhere else yet.");
  await expect(page.getByText("this browser couldn't keep a draft")).toBeVisible();

  const prompt = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const dialog = await prompt;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
});

test("the Create Content form keeps an unfinished idea across a reload", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "uses the shared browser storage of one project");
  const title = `Unfinished idea ${Date.now()}`;
  await page.goto("/prompts");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Create content/i }).click();
  await page.getByRole("textbox", { name: /Title/ }).fill(title);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("mediaflow:draft:create-content"))).toContain(title);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Create content/i }).click();
  const banner = page.getByRole("status").filter({ hasText: "didn't finish it" });
  await expect(banner).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Title/ })).toHaveValue("");
  await banner.getByRole("button", { name: "Restore it" }).click();
  await expect(page.getByRole("textbox", { name: /Title/ })).toHaveValue(title);

  // Discarding removes it for the next visit
  await page.evaluate(() => localStorage.setItem("mediaflow:draft:create-content", JSON.stringify({ at: Date.now(), value: { title: "Old idea" } })));
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Create content/i }).click();
  await page.getByRole("status").filter({ hasText: "didn't finish it" }).getByRole("button", { name: "Discard" }).click();
  expect(await page.evaluate(() => localStorage.getItem("mediaflow:draft:create-content"))).toBeNull();
});

test("the schedule dialog asks before throwing typed text away", async ({ page }) => {
  await page.goto("/content?q=Coffee%20Science");
  const href = await page.locator('a[href^="/content/c"]').first().getAttribute("href");
  await page.goto(`${href}?tab=publishing`);
  await page.waitForLoadState("networkidle");

  // Untouched: Escape just closes it
  await page.getByRole("button", { name: "Add schedule" }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule post" });
  await expect(dialog.getByRole("textbox", { name: "Title" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Edited: Escape asks, Cancel keeps the form, Discard closes it
  await page.getByRole("button", { name: "Add schedule" }).click();
  await dialog.getByRole("textbox", { name: "Title" }).fill("A title I do not want to lose");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("A title I do not want to lose");

  await page.keyboard.press("Escape");
  await confirm.getByRole("button", { name: "Discard changes" }).click();
  await expect(dialog).toBeHidden();

  // The next time it opens it starts clean and closes without asking
  await page.getByRole("button", { name: "Add schedule" }).click();
  await expect(dialog.getByRole("textbox", { name: "Title" })).not.toHaveValue("A title I do not want to lose");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
