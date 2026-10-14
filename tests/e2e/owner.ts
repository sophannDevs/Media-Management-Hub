/** The seeded owner the e2e server signs in with (SEED_OWNER_PASSWORD in scripts/e2e-server.mjs). */
export const OWNER = { email: "owner@mediaflow.local", password: process.env.E2E_OWNER_PASSWORD ?? "e2e-owner-password" };

/** Session saved by auth.setup.ts and reused by every project (playwright.config.ts). */
export const STORAGE_STATE = "playwright/.auth/owner.json";
