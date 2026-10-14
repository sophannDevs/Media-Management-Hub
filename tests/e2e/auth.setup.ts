import { expect, test as setup } from "@playwright/test";
import { OWNER, STORAGE_STATE } from "./owner";

// Signs in once through the real form; every other test reuses the session.

setup("sign in as the owner", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  await page.context().storageState({ path: STORAGE_STATE });
});
