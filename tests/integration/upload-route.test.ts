import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Files go to a throwaway folder (the storage root is read when the module loads)
const dir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const p = mkdtempSync(join(tmpdir(), "mediaflow-upload-"));
  process.env.STORAGE_DIR = p;
  return p;
});

import { POST } from "@/app/api/media/route";
import { db } from "@/lib/db";
import { ffprobeAvailable } from "@/lib/media/probe";
import { createContent } from "@/server/services/content";
import { seedPlatforms } from "../helpers/factories";

// PERF-07: an upload is the request body, piped to disk as it arrives. Nothing
// is held in memory, there is no 10 MB cut-off, and a refused or broken upload
// leaves no file and no asset behind.

const MiB = 1024 * 1024;

/** A valid MP4 file-type box: the server decides what a file is from its first bytes (SEC-05); the rest is filler. */
const MP4_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41")]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

/** A body of `bytes` bytes, produced chunk by chunk (never all in memory at once), starting with `head`. */
function body(bytes: number, { failAfter, head = MP4_HEAD }: { failAfter?: number; head?: Uint8Array } = {}) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter !== undefined && sent >= failAfter) return controller.error(new Error("connection lost"));
      if (sent >= bytes) return controller.close();
      const n = Math.min(64 * 1024, bytes - sent);
      const chunk = new Uint8Array(n).fill(sent % 251);
      if (sent === 0) chunk.set(head.subarray(0, n));
      controller.enqueue(chunk);
      sent += n;
    },
  });
}

const upload = (query: string, payload: ReadableStream<Uint8Array> | null, headers: Record<string, string> = {}) =>
  POST(new Request(`http://app.test/api/media?${query}`, { method: "POST", headers: { host: "app.test", "content-type": "video/mp4", ...headers }, body: payload, duplex: "half" } as RequestInit));

const filesOnDisk = () => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));

beforeEach(async () => {
  await seedPlatforms();
  await db.mediaAsset.deleteMany();
  rmSync(path.join(dir, "media"), { recursive: true, force: true });
  process.env.MEDIA_MAX_BYTES = String(64 * MiB);
});
afterEach(() => {
  delete process.env.MEDIA_MAX_BYTES;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("POST /api/media (PERF-07)", () => {
  it("stores a file bigger than the old 10 MB cut-off, whole, with its measured details", async () => {
    const res = await upload("type=VIDEO&fileName=big%20clip.mp4&width=1920&height=1080&durationSec=61.5", body(12 * MiB));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, errors: [], created: [expect.any(String)], assets: [{ size: 12 * MiB }] });

    const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: json.created[0] } });
    expect(asset).toMatchObject({ type: "VIDEO", fileName: "big clip.mp4", mimeType: "video/mp4", size: 12 * MiB, width: 1920, height: 1080, durationSec: 61.5 });
    const [file] = filesOnDisk();
    expect(statSync(file).size).toBe(12 * MiB);
    expect(path.relative(dir, file).replaceAll("\\", "/")).toBe(asset.storageKey);
    // The bytes are the ones sent
    expect(readFileSync(file).subarray(0, MP4_HEAD.length)).toEqual(MP4_HEAD);
  });

  it("attaches the file to a content item and applies the workflow side effects", async () => {
    const { id } = await createContent({ title: "Upload target" });
    const res = await upload(`type=VIDEO&fileName=final.mp4&contentId=${id}`, body(MiB));
    expect(res.status).toBe(200);
    const content = await db.content.findUniqueOrThrow({ where: { id }, select: { videoAssetId: true, videoStatus: true } });
    expect(content.videoAssetId).toBe((await res.json()).created[0]);
    expect(content.videoStatus).toBe("GENERATED");
  });

  it("refuses by the declared size without reading the body", async () => {
    process.env.MEDIA_MAX_BYTES = String(MiB);
    const unread = new ReadableStream<Uint8Array>({ pull: () => { throw new Error("the body was read"); } });
    const res = await upload("type=VIDEO&fileName=huge.mp4", unread, { "content-length": String(2 * MiB) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, code: "TOO_LARGE", error: "huge.mp4: larger than 1 MB, the limit for video files." });
    expect(filesOnDisk()).toEqual([]);
  });

  it("stops a body that is bigger than it said, or didn't say, and leaves nothing behind", async () => {
    process.env.MEDIA_MAX_BYTES = String(MiB);
    const res = await upload("type=VIDEO&fileName=liar.mp4", body(3 * MiB)); // no Content-Length
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(filesOnDisk()).toEqual([]);
    expect(await db.mediaAsset.count()).toBe(0);
  });

  it("removes the partial file when the connection drops", async () => {
    const res = await upload("type=VIDEO&fileName=dropped.mp4", body(8 * MiB, { failAfter: MiB }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(filesOnDisk()).toEqual([]);
    expect(await db.mediaAsset.count()).toBe(0);
  });

  it("refuses a body that ends before its declared length instead of storing half a file", async () => {
    const res = await upload("type=VIDEO&fileName=short.mp4", body(MiB), { "content-length": String(3 * MiB) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: "VALIDATION", error: `short.mp4: the upload was cut short (${MiB} of ${3 * MiB} bytes arrived). Try again.` });
    expect(filesOnDisk()).toEqual([]);
    expect(await db.mediaAsset.count()).toBe(0);
  });

  it("refuses a file of the wrong kind, an empty file, a missing name or type, and unknown content", async () => {
    const wrongKind = await upload("type=IMAGE&fileName=clip.mp4", body(MiB), { "content-type": "video/mp4" });
    expect(wrongKind.status).toBe(400);
    expect(await wrongKind.json()).toMatchObject({ code: "VALIDATION", error: "clip.mp4: not a valid image file." });

    const empty = await upload("type=VIDEO&fileName=empty.mp4", body(0), { "content-length": "0" });
    expect(await empty.json()).toMatchObject({ code: "VALIDATION", error: "empty.mp4: the file is empty." });

    expect(await (await upload("type=VIDEO&fileName=", body(MiB))).json()).toMatchObject({ error: "The file needs a name." });
    expect(await (await upload("fileName=a.mp4", body(MiB))).json()).toMatchObject({ error: "Choose a media type." });

    const unknown = await upload("type=VIDEO&fileName=a.mp4&contentId=nope", body(MiB));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "NOT_FOUND", error: "Content not found." });

    expect(filesOnDisk()).toEqual([]);
    expect(await db.mediaAsset.count()).toBe(0);
  });

  it("refuses a file that wouldn't fit the 32-bit size column, before reading it", async () => {
    delete process.env.MEDIA_MAX_BYTES; // the built-in cap: 2 GiB minus one byte
    const unread = new ReadableStream<Uint8Array>({ pull: () => { throw new Error("the body was read"); } });
    const res = await upload("type=VIDEO&fileName=two-gib.mp4", unread, { "content-length": String(2 ** 31) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "TOO_LARGE", error: "two-gib.mp4: larger than 2 GB, the limit for video files." });
    // A setting can't raise the cap past what the column holds
    process.env.MEDIA_MAX_BYTES = String(2 ** 40);
    expect((await upload("type=VIDEO&fileName=big.mp4", unread, { "content-length": String(2 ** 31) })).status).toBe(413);
  });

  it("keeps a client-supplied name from reaching outside the storage folder", async () => {
    const res = await upload("type=VIDEO&fileName=..%2F..%2Fescape.mp4", body(1024));
    expect(res.status).toBe(200);
    const asset = await db.mediaAsset.findFirstOrThrow();
    expect(asset.fileName).not.toMatch(/[\\/]/);
    expect(asset.storageKey).toMatch(/^media\/\d{4}\/\d{2}\/[\w.-]+$/);
    expect(filesOnDisk()).toHaveLength(1);
  });
});

// SEC-05: what a file is comes from its bytes; the name and type must agree; every file is hashed and measured.
describe("POST /api/media (SEC-05)", () => {
  const fixtureBytes = () => readFileSync(path.resolve("tests/fixtures/tiny.mp4"));
  const fromBuffer = (buf: Buffer) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(buf));
        c.close();
      },
    });

  it("decides what a file is from its bytes, not from the browser", async () => {
    const png = await upload("type=VIDEO&fileName=clip.mp4", body(MiB, { head: PNG_HEAD }));
    expect(png.status).toBe(400);
    expect(await png.json()).toMatchObject({ code: "VALIDATION", error: "clip.mp4: this is an image file (image/png), not a video." });
    const text = await upload("type=VIDEO&fileName=clip.mp4", body(MiB, { head: Buffer.from("<html><script>alert(1)</script>") }));
    expect(await text.json()).toMatchObject({ error: expect.stringMatching(/not a recognised video file/) });
    expect(filesOnDisk()).toEqual([]);

    // Declared as QuickTime, really MP4: stored as what it is
    const declared = await upload("type=VIDEO&fileName=clip.mp4", body(MiB), { "content-type": "video/quicktime" });
    expect(declared.status).toBe(200);
    expect((await db.mediaAsset.findFirstOrThrow()).mimeType).toBe("video/mp4");
    expect(filesOnDisk()).toHaveLength(1);
  });

  it("refuses an extension that does not belong to the format, and the OTHER type", async () => {
    const mov = await upload("type=VIDEO&fileName=clip.mov", body(MiB), { "content-type": "video/quicktime" });
    expect(mov.status).toBe(400);
    expect(await mov.json()).toMatchObject({ error: "clip.mov: the name ends in .mov but the file is video/mp4 (.mp4)." });
    const other = await upload("type=OTHER&fileName=thing.bin", body(1024), { "content-type": "application/octet-stream" });
    expect(other.status).toBe(400);
    expect(await other.json()).toMatchObject({ error: expect.stringMatching(/can.t be uploaded/) });
    expect(filesOnDisk()).toEqual([]);
    expect(await db.mediaAsset.count()).toBe(0);
  });

  it("caps images and audio below the video limit, before reading the body", async () => {
    const unread = new ReadableStream<Uint8Array>({
      pull: () => {
        throw new Error("the body was read");
      },
    });
    const res = await upload("type=IMAGE&fileName=huge.png", unread, { "content-type": "image/png", "content-length": String(30 * MiB) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "TOO_LARGE", error: "huge.png: larger than 25 MB, the limit for image files." });
  });

  it("hashes the file and measures it with ffprobe when the server has it", async () => {
    const bytes = fixtureBytes();
    const res = await upload("type=VIDEO&fileName=tiny.mp4&width=1920&height=1080&durationSec=99", fromBuffer(bytes), { "content-length": String(bytes.length) });
    expect(res.status).toBe(200);
    const json = await res.json();
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(json.assets[0]).toMatchObject({ size: bytes.length, sha256: sha, mimeType: "video/mp4" });
    const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: json.created[0] } });
    expect(asset.sha256).toBe(sha);
    if (ffprobeAvailable()) {
      // The browser's figures (1920x1080, 99 s) are replaced by what the file really holds
      expect(asset).toMatchObject({ width: 64, height: 64, codec: "h264+aac", container: "mov" });
      expect(asset.durationSec).toBeCloseTo(1, 1);
      expect(asset.probedAt).toBeInstanceOf(Date);
    } else {
      expect(asset).toMatchObject({ width: 1920, height: 1080, durationSec: 99, probedAt: null });
    }
  });
});
