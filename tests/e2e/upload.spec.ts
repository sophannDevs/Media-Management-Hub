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

test("an uploaded image is shown as a small WebP copy, not the original (PERF-08)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "mutates the shared e2e database");

  await page.goto("/media");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Upload media" }).click();
  const dialog = page.getByRole("dialog", { name: "Upload media" });
  await dialog.getByRole("combobox", { name: "Media type" }).click();
  await page.getByRole("option", { name: "Image" }).click();
  await dialog.locator('input[type="file"]').setInputFiles("tests/fixtures/wide.png");
  await expect(page.getByText("1 file uploaded")).toBeVisible();
  await expect(dialog).toBeHidden();

  // The card asks for the copies by width; the browser picks one that fits
  const img = page.getByRole("article").filter({ hasText: "wide.png" }).first().locator("img").first();
  const src = (await img.getAttribute("src"))!;
  expect(src).toMatch(/^\/api\/files\//);
  await expect(img).toHaveAttribute("srcset", /\?v=w320 320w, .*\?v=w640 640w, .*\?v=w1280 1280w/);
  await expect(img).toHaveAttribute("loading", "lazy");

  // The copies are made right after the upload is registered: within a few seconds the small one is served
  await expect.poll(async () => (await page.request.get(`${src}?v=w320`)).headers()["content-type"], { timeout: 20_000 }).toBe("image/webp");
  const small = await page.request.get(`${src}?v=w320`);
  const original = await page.request.get(src);
  expect(original.headers()["content-type"]).toBe("image/png");
  expect(Number(small.headers()["content-length"])).toBeLessThan(Number(original.headers()["content-length"]));
  // A copy that doesn't exist is answered with the original, not an error
  const unknown = await page.request.get(`${src}?v=w9999`);
  expect(unknown.status()).toBe(200);
  expect(unknown.headers()["content-type"]).toBe("image/png");
});
