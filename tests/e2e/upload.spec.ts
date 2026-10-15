import { expect, test } from "@playwright/test";

// PERF-07 regression guard: the proxy buffers and cuts off any body that passes
// through it at 10 MB, which silently broke large uploads once. /api/media is
// kept out of the proxy and streams the body, so a file well past 10 MB must
// arrive whole on the production build.
test("a file bigger than 10 MB is stored whole", async ({ request }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");
  const size = 25 * 1024 * 1024;
  const bytes = Buffer.alloc(size, 7);
  // A valid MP4 file-type box in front: the server decides the type from the bytes (SEC-05)
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41")]).copy(bytes);

  const res = await request.post("/api/media?type=VIDEO&fileName=large-upload-check.mp4", { data: bytes, headers: { "content-type": "video/mp4" }, timeout: 120_000 });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, errors: [] });
  expect(body.assets[0].size).toBe(size);
});

test("an upload without a session is refused before any body is read", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const res = await anonymous.post("/api/media?type=VIDEO&fileName=x.mp4", { data: Buffer.alloc(1024), headers: { "content-type": "video/mp4" } });
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHENTICATED", requestId: expect.any(String) });
  await anonymous.dispose();
});

// MEDIA-02: the same file twice. The dialog warns before sending, and the
// person decides.
test("uploading a file the library already has warns first, and can go ahead anyway", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");
  const fixture = "tests/fixtures/tiny.mp4";

  await page.goto("/media");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Upload media" }).click();
  const dialog = page.getByRole("dialog", { name: "Upload media" });
  await dialog.getByRole("combobox", { name: "Media type" }).click();
  await page.getByRole("option", { name: "Video" }).click();
  await dialog.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByText("1 file uploaded")).toBeVisible();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Upload media" }).click();
  await dialog.getByRole("combobox", { name: "Media type" }).click();
  await page.getByRole("option", { name: "Video" }).click();
  await dialog.locator('input[type="file"]').setInputFiles(fixture);
  const row = dialog.getByRole("listitem").filter({ hasText: "tiny.mp4" });
  await expect(row).toContainText("Already uploaded as tiny.mp4");
  await row.getByRole("button", { name: "Upload anyway" }).click();
  await expect(page.getByText("1 file uploaded")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("article").filter({ hasText: "tiny.mp4" })).toHaveCount(2);
});
