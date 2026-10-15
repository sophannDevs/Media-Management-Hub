import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Files go to a throwaway folder (the storage root is read when the module loads)
const dir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const p = mkdtempSync(join(tmpdir(), "mediaflow-derive-"));
  process.env.STORAGE_DIR = p;
  return p;
});

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { NextRequest } from "next/server";
import { GET as files } from "@/app/api/files/[...key]/route";
import { db } from "@/lib/db";
import { ffmpegAvailable, imageVariants } from "@/lib/media/derivatives";
import { thumbSrcSet } from "@/lib/media-url";
import { storage } from "@/lib/storage";
import { generateDerivatives, processPendingDerivatives, variantKeysOf } from "@/server/services/derivatives";
import { createMediaAsset, deleteMediaAsset } from "@/server/services/media";
import { reconcileStorage } from "@/server/services/storage-reconcile";
import { seedPlatforms } from "../helpers/factories";

// PERF-08: lists show small WebP copies, not the originals.

const fixture = (name: string) => readFileSync(path.resolve("tests/fixtures", name));
const put = async (key: string, bytes: Buffer) => {
  await storage.save(
    key,
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(bytes));
        c.close();
      },
    }),
  );
  return key;
};
const readKey = async (key: string) => {
  const chunks: Uint8Array[] = [];
  for await (const ch of storage.readStream(key) as unknown as AsyncIterable<Uint8Array>) chunks.push(ch);
  return Buffer.concat(chunks);
};
const isWebp = (b: Buffer) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP";
const get = (key: string, query = "") => files(new NextRequest(`http://app.test/api/files/${key}${query}`, { headers: { host: "app.test" } }), { params: Promise.resolve({ key: key.split("/") }) } as never);

beforeEach(async () => {
  await seedPlatforms();
  await db.mediaAsset.deleteMany();
  rmSync(path.join(dir, "media"), { recursive: true, force: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("image variants", () => {
  it("makes WebP copies at each width that beats the original, and a blur placeholder", async () => {
    const r = await imageVariants(fixture("wide.png"));
    expect(r).toMatchObject({ width: 1600, height: 900 });
    // The 1280-wide copy of this 8.5 KB PNG would be bigger than the file itself: not kept
    expect(r.variants.map((v) => v.name)).toEqual(["w320", "w640"]);
    for (const v of r.variants) expect(isWebp(v.bytes)).toBe(true);
    expect(r.variants[0].bytes.length).toBeLessThan(r.variants[1].bytes.length);
    expect(r.variants[1].bytes.length).toBeLessThan(fixture("wide.png").length);
    expect(r.blur).toMatch(/^data:image\/webp;base64,/);
    expect(r.blur.length).toBeLessThan(2000);
  });

  it("never enlarges a small image: one copy at its own size, when that is still smaller", async () => {
    const r = await imageVariants(fixture("tiny.png"));
    expect(r.variants.map((v) => v.name)).toEqual(["w320"]);
    expect(r.variants[0].bytes.length).toBeLessThan(fixture("tiny.png").length);
    expect(r).toMatchObject({ width: 8, height: 8 });
  });

  it("keeps no copy of a file a copy can't beat: a small SVG of noise gets only its blur", async () => {
    // 300 bytes of SVG that render as 1280x720 of noise: any raster copy is many times bigger
    const r = await imageVariants(fixture("noise.svg"));
    expect(r.variants).toEqual([]);
    expect(r.blur).toMatch(/^data:image\/webp;base64,/);
    expect(r).toMatchObject({ width: 1280, height: 720 });
  });
});

describe("derivatives of an asset", () => {
  it("stores an image's copies next to it, serves them through the file route, and cleans them up with the asset", async () => {
    const key = await put("media/2026/10/wide.png", fixture("wide.png"));
    const asset = await createMediaAsset({ type: "IMAGE", fileName: "wide.png", storageKey: key, mimeType: "image/png", size: 8708 });
    expect(await generateDerivatives(asset.id)).toBe("done");

    const row = await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    const variants = row.variants as Record<string, string>;
    expect(Object.keys(variants).sort()).toEqual(["blur", "w320", "w640"]);
    expect(variants.w320).toBe("media/2026/10/wide.png.w320.webp");
    expect(isWebp(await readKey(variants.w320))).toBe(true);
    expect(row).toMatchObject({ width: 1600, height: 900, deriveError: null });
    expect(row.derivedAt).toBeInstanceOf(Date);
    expect(variantKeysOf(row.variants)).toEqual([variants.w320, variants.w640]);

    // The route serves the copy when asked, the original for a copy that doesn't exist
    const small = await get(key, "?v=w320");
    expect(small.status).toBe(200);
    expect(small.headers.get("content-type")).toBe("image/webp");
    expect(Number(small.headers.get("content-length"))).toBeLessThan(8708);
    const missing = await get(key, "?v=w9999");
    expect(missing.headers.get("content-type")).toBe("image/png");
    expect(Number(missing.headers.get("content-length"))).toBe(8708);
    expect(thumbSrcSet(`/api/files/${key}`)).toBe(`/api/files/${key}?v=w320 320w, /api/files/${key}?v=w640 640w, /api/files/${key}?v=w1280 1280w`);
    expect(thumbSrcSet("https://cdn.test/x.png")).toBeUndefined();

    // Reconcile keeps the copies; deleting the asset removes them
    const old = new Date(Date.now() - 3 * 86_400_000);
    const reconciled = await reconcileStorage({ now: new Date(old.getTime() + 10 * 86_400_000), graceMs: 0, dryRun: true });
    expect(reconciled.orphans).toEqual([]);
    await deleteMediaAsset(asset.id);
    expect(await storage.stat(variants.w320)).toBeNull();
    expect(await storage.stat(key)).toBeNull();
  });

  it("gives a video a poster and a preview when ffmpeg is there, and copes without", async () => {
    const key = await put("media/2026/10/tiny.mp4", fixture("tiny.mp4"));
    const asset = await createMediaAsset({ type: "VIDEO", fileName: "tiny.mp4", storageKey: key, mimeType: "video/mp4", size: 12750 });
    expect(await generateDerivatives(asset.id)).toBe("done");
    const row = await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    const variants = (row.variants as Record<string, string> | null) ?? {};
    if (ffmpegAvailable()) {
      expect(variants.poster).toBe("media/2026/10/tiny.mp4.poster.webp");
      expect(isWebp(await readKey(variants.poster))).toBe(true);
      expect(variants.blur).toMatch(/^data:image\/webp/);
      expect(variants.preview).toBe("media/2026/10/tiny.mp4.preview.mp4");
      expect((await readKey(variants.preview)).subarray(4, 8).toString()).toBe("ftyp");
      const poster = await get(key, "?v=poster");
      expect(poster.headers.get("content-type")).toBe("image/webp");
    } else {
      expect(variants).toEqual({});
    }
    expect(row.derivedAt).toBeInstanceOf(Date);
  });

  it("skips what has nothing to derive, and the worker backfills what was missed", async () => {
    const linked = await createMediaAsset({ type: "IMAGE", fileName: "linked.png", externalUrl: "https://cdn.test/linked.png", mimeType: "image/png", size: 1 });
    expect(await generateDerivatives(linked.id)).toBe("skipped");
    const audio = await createMediaAsset({ type: "AUDIO", fileName: "a.mp3", storageKey: await put("media/2026/10/a.mp3", Buffer.alloc(100)), mimeType: "audio/mpeg", size: 100 });
    expect(await generateDerivatives(audio.id)).toBe("skipped");

    const key = await put("media/2026/10/late.png", fixture("wide.png"));
    const late = await createMediaAsset({ type: "IMAGE", fileName: "late.png", storageKey: key, mimeType: "image/png", size: 8708 });
    expect(await processPendingDerivatives()).toEqual({ attempted: 0, done: 0 }); // too young: its own upload is still making them
    await db.mediaAsset.update({ where: { id: late.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    expect(await processPendingDerivatives()).toEqual({ attempted: 1, done: 1 });
    expect(((await db.mediaAsset.findUniqueOrThrow({ where: { id: late.id } })).variants as Record<string, string>).w320).toBe(`${key}.w320.webp`);
    expect(await processPendingDerivatives()).toEqual({ attempted: 0, done: 0 });
  });
});
