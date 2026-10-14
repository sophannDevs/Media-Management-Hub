import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3210);
/** Session saved by tests/e2e/auth.setup.ts */
const storageState = "playwright/.auth/owner.json";

// End-to-end tests run against a production build with seeded demo data
// (scripts/e2e-server.mjs), at the three widths the audit measured. The
// "setup" project signs in once; the others reuse that session.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  // The suite runs 6 workers against one server; refreshes after an action can take a few seconds
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState } },
    { name: "tablet", dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 }, hasTouch: true, storageState } },
    { name: "phone", dependencies: ["setup"], use: { ...devices["Pixel 7"], storageState } },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `http://127.0.0.1:${port}/login`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(port) },
  },
});
