import { expect, test } from "@playwright/test";
import { ROUTES } from "./routes";

// PUB-05: while the providers are simulated, nothing may pass for a real post
// or a real metric. The e2e build runs with the simulated providers.

test("simulation mode is disclosed on every page", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole("note", { name: "Simulation mode" }), route).toBeVisible();
  }
});

test("published posts in the queue read Simulated and have no View post link", async ({ page }) => {
  await page.goto("/schedule?status=published");
  await expect(page.getByText("Simulated", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Published", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View post" })).toHaveCount(0);
});

test("the dashboard and analytics label generated numbers", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/simulated views this month/)).toBeVisible();
  await page.goto("/analytics");
  await expect(page.getByText("Simulated metrics.")).toBeVisible();
});
