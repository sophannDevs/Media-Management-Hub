import { expect, test } from "@playwright/test";

// PERF-06 on the real server: stored files are cacheable and seekable.
const FILE = "/api/files/seed/c101/scene-1.svg";

test("a stored file is validated, cached and seekable", async ({ request }, info) => {
  test.skip(info.project.name !== "desktop", "API-level check, once");

  const first = await request.get(FILE);
  expect(first.status()).toBe(200);
  const body = await first.body();
  const etag = first.headers()["etag"];
  expect(etag).toBeTruthy();
  expect(first.headers()["cache-control"]).toBe("private, max-age=86400, immutable");
  expect(first.headers()["x-request-id"]).toBeTruthy();

  const repeat = await request.get(FILE, { headers: { "if-none-match": etag } });
  expect(repeat.status()).toBe(304);
  expect((await repeat.body()).length).toBe(0);

  const last = await request.get(FILE, { headers: { range: "bytes=-20" } });
  expect(last.status()).toBe(206);
  expect(last.headers()["content-range"]).toBe(`bytes ${body.length - 20}-${body.length - 1}/${body.length}`);
  expect(await last.body()).toEqual(body.subarray(body.length - 20));
});
