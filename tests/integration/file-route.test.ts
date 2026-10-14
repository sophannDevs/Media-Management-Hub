import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Files go to a throwaway folder (the storage root is read when the module loads)
const dir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const p = mkdtempSync(join(tmpdir(), "mediaflow-files-"));
  process.env.STORAGE_DIR = p;
  return p;
});

import { NextRequest } from "next/server";
import { GET } from "@/app/api/files/[...key]/route";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

// PERF-06: the file route answers repeat requests with 304, serves correct byte
// ranges (the audit's `bytes=-20` returned the FIRST 21 bytes) and says what it is.

const KEY = "media/2026/10/range-test.bin";
const BYTES = Uint8Array.from({ length: 561 }, (_, i) => i % 251);
const url = `http://app.test/api/files/${KEY}`;

const get = (headers: Record<string, string> = {}, query = "") =>
  GET(new NextRequest(url + query, { headers }), { params: Promise.resolve({ key: KEY.split("/") }) } as never);
const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());

beforeAll(async () => {
  await storage.save(KEY, new Blob([BYTES]).stream());
  await db.mediaAsset.create({ data: { type: "OTHER", fileName: "range test.bin", storageKey: KEY, mimeType: "application/octet-stream", size: BYTES.length } });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("GET /api/files (PERF-06)", () => {
  it("sends the file with validators and a day of private, immutable caching", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await bytes(res)).toEqual(BYTES);
    expect(res.headers.get("content-length")).toBe("561");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(new Date(res.headers.get("last-modified")!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="range%20test.bin"');
    expect((await get({}, "?download")).headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("answers a repeat request with 304 and no body", async () => {
    const first = await get();
    const etag = first.headers.get("etag")!;
    const repeat = await get({ "if-none-match": etag });
    expect(repeat.status).toBe(304);
    expect(await repeat.text()).toBe("");
    expect(repeat.headers.get("etag")).toBe(etag);
    expect(repeat.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect((await get({ "if-modified-since": first.headers.get("last-modified")! })).status).toBe(304);
    expect((await get({ "if-none-match": '"something-else"' })).status).toBe(200);
  });

  it("returns the LAST n bytes for a suffix range (the audit's reproduction)", async () => {
    const res = await get({ range: "bytes=-20" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 541-560/561");
    expect(res.headers.get("content-length")).toBe("20");
    expect(await bytes(res)).toEqual(BYTES.slice(541));
  });

  it("serves start-end, open-ended and clamped ranges", async () => {
    const a = await get({ range: "bytes=10-19" });
    expect(a.status).toBe(206);
    expect(a.headers.get("content-range")).toBe("bytes 10-19/561");
    expect(await bytes(a)).toEqual(BYTES.slice(10, 20));
    expect(await bytes(await get({ range: "bytes=500-" }))).toEqual(BYTES.slice(500));
    const clamped = await get({ range: "bytes=500-99999" });
    expect(clamped.headers.get("content-range")).toBe("bytes 500-560/561");
  });

  it("refuses a range past the end with 416 and the size", async () => {
    const res = await get({ range: "bytes=1000-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */561");
    expect(await res.json()).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("sends the whole file when the range is malformed or If-Range no longer matches", async () => {
    const etag = (await get()).headers.get("etag")!;
    expect((await get({ range: "bytes=5-2" })).status).toBe(200);
    expect((await get({ range: "bytes=0-9", "if-range": '"stale"' })).status).toBe(200);
    const ok = await get({ range: "bytes=0-9", "if-range": etag });
    expect(ok.status).toBe(206);
  });

  it("says so when the file doesn't exist", async () => {
    const res = await GET(new NextRequest("http://app.test/api/files/media/nope.bin"), { params: Promise.resolve({ key: ["media", "nope.bin"] }) } as never);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
