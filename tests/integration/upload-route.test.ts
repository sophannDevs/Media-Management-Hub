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
import { createContent } from "@/server/services/content";
import { seedPlatforms } from "../helpers/factories";

// PERF-07: an upload is the request body, piped to disk as it arrives. Nothing
// is held in memory, there is no 10 MB cut-off, and a refused or broken upload
// leaves no file and no asset behind.

const MiB = 1024 * 1024;

/** A body of `bytes` bytes, produced chunk by chunk (never all in memory at once). */
function body(bytes: number, { failAfter }: { failAfter?: number } = {}) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter !== undefined && sent >= failAfter) return controller.error(new Error("connection lost"));
      if (sent >= bytes) return controller.close();
      const n = Math.min(64 * 1024, bytes - sent);
      controller.enqueue(new Uint8Array(n).fill(sent % 251));
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
    expect(readFileSync(file).subarray(0, 4)).toEqual(Buffer.alloc(4, 0));
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
    expect(await res.json()).toMatchObject({ ok: false, code: "TOO_LARGE", error: "huge.mp4: larger than 1 MB." });
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
    expect(await res.json()).toMatchObject({ code: "TOO_LARGE", error: "two-gib.mp4: larger than 2 GB." });
    // A setting can't raise the cap past what the column holds
    process.env.MEDIA_MAX_BYTES = String(2 ** 40);
    expect((await upload("type=VIDEO&fileName=big.mp4", unread, { "content-length": String(2 ** 31) })).status).toBe(413);
  });

  it("keeps a client-supplied name from reaching outside the storage folder", async () => {
    const res = await upload("type=OTHER&fileName=..%2F..%2Fescape.bin", body(1024), { "content-type": "application/octet-stream" });
    expect(res.status).toBe(200);
    const asset = await db.mediaAsset.findFirstOrThrow();
    expect(asset.fileName).not.toMatch(/[\\/]/);
    expect(asset.storageKey).toMatch(/^media\/\d{4}\/\d{2}\/[\w.-]+$/);
    expect(filesOnDisk()).toHaveLength(1);
  });
});
