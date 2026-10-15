import { expect, test } from "@playwright/test";

// PERF-07 regression guard: the proxy buffers and cuts off any body that passes
// through it at 10 MB, which silently broke large uploads once. /api/media is
// kept out of the proxy and streams the body, so a file well past 10 MB must
// arrive whole on the production build.
test("a file bigger than 10 MB is stored whole", async ({ request }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");
  const size = 25 * 1024 * 1024;
  const bytes = Buffer.alloc(size, 7);

  const res = await request.post("/api/media?type=OTHER&fileName=large-upload-check.bin", { data: bytes, headers: { "content-type": "application/octet-stream" }, timeout: 120_000 });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, errors: [] });
  expect(body.assets[0].size).toBe(size);
});

test("an upload without a session is refused before any body is read", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const res = await anonymous.post("/api/media?type=OTHER&fileName=x.bin", { data: Buffer.alloc(1024), headers: { "content-type": "application/octet-stream" } });
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHENTICATED", requestId: expect.any(String) });
  await anonymous.dispose();
});
