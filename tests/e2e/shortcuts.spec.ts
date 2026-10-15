import { expect, type Page, test } from "@playwright/test";

// UX-06: keyboard shortcuts. Nothing here changes data (the browser storage of
// each test is its own), so every project runs it.

async function open(page: Page, path = "/calendar") {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

const helpDialog = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });
const createDialog = (page: Page) => page.getByRole("dialog", { name: "Create content" });
const search = (page: Page) => page.getByRole("textbox", { name: "Search content" });

test("? opens the list of shortcuts and Escape closes it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("?");
  const dialog = helpDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /Go to/ })).toBeVisible();
  await expect(dialog.getByText("Create content")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("g then a letter goes to a page; any other key cancels the g", async ({ page }) => {
  await open(page);
  await page.keyboard.press("g");
  await expect(page.getByRole("status").filter({ hasText: "Go to: press" })).toBeAttached();
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/content$/);

  await page.waitForLoadState("networkidle");
  await page.keyboard.press("g");
  await page.keyboard.press("l");
  await expect(page).toHaveURL(/\/calendar$/);

  // g, x: nothing moves and the next key is an ordinary key again
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("g");
  await page.keyboard.press("x");
  await expect(page).toHaveURL(/\/calendar$/);
  await page.keyboard.press("c");
  await expect(createDialog(page)).toBeVisible();
});

test("c opens Create Content and / goes to the search box", async ({ page }) => {
  await open(page);
  await page.keyboard.press("c");
  await expect(createDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(createDialog(page)).toBeHidden();

  await page.keyboard.press("/");
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("");
});

test("keys typed into a field or while a dialog is open are not shortcuts", async ({ page }) => {
  await open(page);
  await search(page).click();
  await search(page).pressSequentially("gc?/");
  await expect(search(page)).toHaveValue("gc?/");
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await search(page).blur();
  await page.keyboard.press("?");
  await expect(helpDialog(page)).toBeVisible();
  await page.keyboard.press("c");
  await expect(createDialog(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("single-key shortcuts can be turned off, the choice stays, and Ctrl+K still works", async ({ page }, info) => {
  await open(page);
  await page.keyboard.press("?");
  const toggle = helpDialog(page).getByRole("switch", { name: "Single-key shortcuts" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");

  await page.keyboard.press("c");
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/calendar$/);
  await page.keyboard.press("Control+k");
  await expect(search(page)).toBeFocused();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The button that opens the list stays (it is hidden on a phone, which has no keyboard)
  test.skip((page.viewportSize()?.width ?? 0) < 768, `${info.project.name}: the header button is hidden on a phone`);
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await helpDialog(page).getByRole("switch", { name: "Single-key shortcuts" }).click();
  await page.keyboard.press("Escape");
  await expect(helpDialog(page)).toBeHidden();
  await page.keyboard.press("c");
  await expect(createDialog(page)).toBeVisible();
});
