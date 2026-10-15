import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// MEDIA-01: a direct-to-bucket upload, finished and inspected by the server.
// The bucket is a fake in memory: what matters here is the server's half.

const bucket = new Map<string, Buffer>();
const multipart = new Map<string, { key: string; parts: Map<number, Buffer> }>();
const dir = mkdtempSync(path.join(tmpdir(), "mf-direct-"));

vi.mock("@/lib/storage", () => {
  const stream = (buf: Buffer) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < buf.length; i += 1024) c.enqueue(new Uint8Array(buf.subarray(i, i + 1024)));
        c.close();
      },
    });
  return {
    storageIsBucket: true,
    makeStorageKey: (name: string) => `media/2026/10/direct-${name.replace(/[^\w.-]+/g, "-")}`,
    storage: {
      async save() {
        throw new Error("not used here");
      },
      async stat(key: string) {
        const b = bucket.get(key);
        return b ? { size: b.length, modifiedAt: new Date() } : null;
      },
      readStream(key: string, range?: { start: number; end: number }) {
        const b = bucket.get(key)!;
        return stream(range ? b.subarray(range.start, range.end + 1) : b);
      },
      async remove(key: string) {
        bucket.delete(key);
      },
      localPath: () => null,
      async list() {
        return [...bucket].map(([key, b]) => ({ key, size: b.length, modifiedAt: new Date() }));
      },
      // ffprobe reads a plain path as happily as a URL
      async signedGetUrl(key: string) {
        const p = path.join(dir, key.replace(/\//g, "_"));
        writeFileSync(p, bucket.get(key)!);
        return p;
      },
      async presignUpload(key: string, { size }: { size: number }) {
        if (size <= 1024 * 1024) return { kind: "single", url: `https://bucket.test/${key}`, headers: { "Content-Type": "x" } };
        multipart.set("up-1", { key, parts: new Map() });
        return { kind: "multipart", uploadId: "up-1", partSize: 1024 * 1024, urls: Array.from({ length: Math.ceil(size / (1024 * 1024)) }, (_, i) => `https://bucket.test/${key}?part=${i + 1}`) };
      },
      async completeUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
        const up = multipart.get(uploadId);
        if (!up || up.key !== key) throw new Error("no such upload");
        bucket.set(key, Buffer.concat(parts.map((p) => up.parts.get(p.partNumber)!)));
        multipart.delete(uploadId);
      },
      async abortUpload(_key: string, uploadId: string) {
        multipart.delete(uploadId);
      },
    },
  };
});

vi.mock("@/server/services/derivatives", () => ({ scheduleDerivatives: vi.fn() }));

import { POST as complete } from "@/app/api/media/complete/route";
import { DELETE as abort, POST as presign } from "@/app/api/media/presign/route";
import { db } from "@/lib/db";
import { ffprobeAvailable } from "@/lib/media/probe";
import { scheduleDerivatives } from "@/server/services/derivatives";
import { seedPlatforms } from "../helpers/factories";

const post = (url: string, body: unknown) => new Request(`http://app.test${url}`, { method: "POST", headers: { host: "app.test", "content-type": "application/json" }, body: JSON.stringify(body) });
const FIXTURE = readFileSync(path.resolve("tests/fixtures/tiny.mp4"));
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41")]);

beforeEach(async () => {
  await seedPlatforms();
  await db.mediaAsset.deleteMany();
  bucket.clear();
  multipart.clear();
  process.env.STORAGE_DIRECT_UPLOAD = "true";
});
afterEach(() => {
  delete process.env.STORAGE_DIRECT_UPLOAD;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("direct-to-bucket uploads (MEDIA-01)", () => {
  it("hands out signed URLs: one PUT for a small file, parts for a big one, and refuses what the proxied route refuses", async () => {
    const small = await (await presign(post("/api/media/presign", { type: "VIDEO", fileName: "tiny.mp4", size: FIXTURE.length, contentType: "video/mp4" }))).json();
    expect(small).toMatchObject({ ok: true, direct: true, key: expect.stringMatching(/^media\/2026\/10\/direct-tiny.mp4$/), upload: { kind: "single", url: expect.stringContaining("https://bucket.test/") } });

    const big = await (await presign(post("/api/media/presign", { type: "VIDEO", fileName: "big.mp4", size: 3 * 1024 * 1024, contentType: "video/mp4" }))).json();
    expect(big.upload).toMatchObject({ kind: "multipart", uploadId: "up-1", partSize: 1024 * 1024 });
    expect(big.upload.urls).toHaveLength(3);

    const image = await presign(post("/api/media/presign", { type: "IMAGE", fileName: "huge.png", size: 30 * 1024 * 1024, contentType: "image/png" }));
    expect(image.status).toBe(413);
    expect(await image.json()).toMatchObject({ error: "huge.png: larger than 25 MB, the limit for image files." });
    const other = await presign(post("/api/media/presign", { type: "OTHER", fileName: "x.bin", size: 10, contentType: "application/octet-stream" }));
    expect(other.status).toBe(400);
    const wrong = await presign(post("/api/media/presign", { type: "VIDEO", fileName: "clip.mp4", size: 10, contentType: "image/png" }));
    expect(await wrong.json()).toMatchObject({ error: "clip.mp4: not a valid video file." });
  });

  it("says so when direct uploads are off, so the browser uploads through the server", async () => {
    delete process.env.STORAGE_DIRECT_UPLOAD;
    expect(await (await presign(post("/api/media/presign", { type: "VIDEO", fileName: "a.mp4", size: 10, contentType: "video/mp4" }))).json()).toEqual({ ok: true, direct: false });
    expect((await complete(post("/api/media/complete", { key: "media/2026/10/direct-a.mp4", type: "VIDEO", fileName: "a.mp4" }))).status).toBe(404);
  });

  it("finishes a multipart upload, inspects the object and registers it with its hash and measurements", async () => {
    const big = await (await presign(post("/api/media/presign", { type: "VIDEO", fileName: "tiny.mp4", size: 3 * 1024 * 1024, contentType: "video/mp4" }))).json();
    // The browser PUT the parts: the whole fixture, then filler
    const filler = Buffer.alloc(3 * 1024 * 1024 - FIXTURE.length, 9);
    const whole = Buffer.concat([FIXTURE, filler]);
    const up = multipart.get("up-1")!;
    for (let i = 0; i < 3; i++) up.parts.set(i + 1, whole.subarray(i * 1024 * 1024, (i + 1) * 1024 * 1024));

    const res = await complete(post("/api/media/complete", { key: big.key, type: "VIDEO", fileName: "tiny.mp4", uploadId: "up-1", parts: [1, 2, 3].map((n) => ({ partNumber: n, etag: `"e${n}"` })), width: 1920, height: 1080, durationSec: 99 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    const sha = createHash("sha256").update(whole).digest("hex");
    expect(json.assets[0]).toMatchObject({ size: whole.length, sha256: sha, mimeType: "video/mp4" });
    const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: json.created[0] } });
    expect(vi.mocked(scheduleDerivatives)).toHaveBeenCalledWith(asset.id); // the smaller copies follow (PERF-08)
    expect(asset).toMatchObject({ storageKey: big.key, type: "VIDEO", mimeType: "video/mp4", size: whole.length, sha256: sha });
    if (ffprobeAvailable()) expect(asset).toMatchObject({ width: 64, height: 64, codec: "h264+aac" });
    expect(multipart.size).toBe(0);
    expect(bucket.has(big.key)).toBe(true);

    // Registering the same object twice is refused
    expect((await complete(post("/api/media/complete", { key: big.key, type: "VIDEO", fileName: "tiny.mp4" }))).status).toBe(409);
  });

  it("deletes an object that fails inspection, and one that never arrived is just refused", async () => {
    const key = "media/2026/10/direct-photo.mp4";
    bucket.set(key, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]));
    const png = await complete(post("/api/media/complete", { key, type: "VIDEO", fileName: "photo.mp4" }));
    expect(png.status).toBe(400);
    expect(await png.json()).toMatchObject({ error: "photo.mp4: this is an image file (image/png), not a video." });
    expect(bucket.has(key)).toBe(false);
    expect(await db.mediaAsset.count()).toBe(0);

    const mov = "media/2026/10/direct-clip.mov";
    bucket.set(mov, Buffer.concat([MP4_HEAD, Buffer.alloc(100)]));
    expect(await (await complete(post("/api/media/complete", { key: mov, type: "VIDEO", fileName: "clip.mov" }))).json()).toMatchObject({ error: "clip.mov: the name ends in .mov but the file is video/mp4 (.mp4)." });
    expect(bucket.has(mov)).toBe(false);

    const missing = await complete(post("/api/media/complete", { key: "media/2026/10/direct-ghost.mp4", type: "VIDEO", fileName: "ghost.mp4" }));
    expect(await missing.json()).toMatchObject({ error: "ghost.mp4: nothing arrived in storage." });
    const badKey = await complete(post("/api/media/complete", { key: "../etc/passwd", type: "VIDEO", fileName: "x.mp4" }));
    expect(badKey.status).toBe(400);
  });

  it("refuses to register an object the library already has, and deletes it, unless the person allowed it", async () => {
    bucket.set("media/2026/10/direct-first.mp4", FIXTURE);
    const first = await complete(post("/api/media/complete", { key: "media/2026/10/direct-first.mp4", type: "VIDEO", fileName: "first.mp4" }));
    expect(first.status).toBe(200);
    const firstId = (await first.json()).created[0];

    bucket.set("media/2026/10/direct-second.mp4", FIXTURE);
    const second = await complete(post("/api/media/complete", { key: "media/2026/10/direct-second.mp4", type: "VIDEO", fileName: "second.mp4" }));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "CONFLICT", error: "second.mp4: already uploaded as first.mp4.", info: { duplicateId: firstId, duplicateName: "first.mp4" } });
    expect(bucket.has("media/2026/10/direct-second.mp4")).toBe(false);

    bucket.set("media/2026/10/direct-second.mp4", FIXTURE);
    const allowed = await complete(post("/api/media/complete", { key: "media/2026/10/direct-second.mp4", type: "VIDEO", fileName: "second.mp4", allowDuplicate: true }));
    expect(allowed.status).toBe(200);
    expect(await db.mediaAsset.count()).toBe(2);
  });

  it("lets the browser give up a multipart upload", async () => {
    const big = await (await presign(post("/api/media/presign", { type: "VIDEO", fileName: "big.mp4", size: 3 * 1024 * 1024, contentType: "video/mp4" }))).json();
    expect(multipart.has("up-1")).toBe(true);
    const res = await abort(new Request(`http://app.test/api/media/presign?key=${encodeURIComponent(big.key)}&uploadId=up-1`, { method: "DELETE", headers: { host: "app.test" } }));
    expect(res.status).toBe(200);
    expect(multipart.has("up-1")).toBe(false);
  });
});
