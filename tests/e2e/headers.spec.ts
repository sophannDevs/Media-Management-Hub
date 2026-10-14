import { expect, test } from "@playwright/test";

// SEC-08: security headers on pages, and the framework is not advertised.
test("pages carry the security headers", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["x-powered-by"]).toBeUndefined();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["content-security-policy"]).toContain("base-uri 'self'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toContain("camera=()");
});

// SEC-02: the cron trigger is closed unless CRON_SECRET is configured (the e2e server has none).
test("the cron endpoint is disabled without a secret", async ({ request }) => {
  const res = await request.post("/api/cron/publish");
  expect(res.status()).toBe(503);
});
