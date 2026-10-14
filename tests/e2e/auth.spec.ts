import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { OWNER } from "./owner";
import { ROUTES } from "./routes";

// SEC-01 route matrix: without a session every page goes to /login and every
// API answers 401. These tests start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test("every page sends a signed-out visitor to /login", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page, route).toHaveURL(/\/login(\?next=.*)?$/);
  }
});

test("APIs refuse a signed-out caller", async ({ request }) => {
  expect((await request.get("/api/content/export")).status()).toBe(401);
  expect((await request.get("/api/files/media/2026/10/x.mp4")).status()).toBe(401);
  expect((await request.post("/api/media", { multipart: { type: "IMAGE" } })).status()).toBe(401);
});

test("setup is closed once the owner has a password", async ({ page }) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login/);
});

test("a wrong password is refused, the right one signs in and returns to the page, sign-out ends it", async ({ page }) => {
  await page.goto("/schedule");
  await expect(page).toHaveURL(/\/login\?next=%2Fschedule/);

  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // (Next.js adds its own hidden role="alert" route announcer, so match by text)
  await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();

  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/schedule");

  const cookie = (await page.context().cookies()).find((c) => c.name === "mf_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");

  // Below the lg breakpoint the sidebar is hidden: the button lives in the menu
  await page.waitForLoadState("networkidle");
  if ((page.viewportSize()?.width ?? 1440) < 1024) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("the sign-in page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});
