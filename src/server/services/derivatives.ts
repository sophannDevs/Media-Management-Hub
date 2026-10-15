import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/log";
import { imageVariants, variantKey, videoPoster, videoPreview } from "@/lib/media/derivatives";
import { storage } from "@/lib/storage";

// Generates the smaller copies of an upload (PERF-08) right after it is
// registered, and again from the worker for anything that was missed (a
// restart in between, a server without ffmpeg that got it later). The result
// is a map on the asset: variant name -> storage key, plus "blur" -> data URI.

const DERIVABLE = ["IMAGE", "THUMBNAIL", "VIDEO"];
const log = logger.child({ component: "derivatives" });

const stream = (bytes: Buffer) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(bytes));
      c.close();
    },
  });

async function readWhole(key: string): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const ch of storage.readStream(key) as unknown as AsyncIterable<Uint8Array>) chunks.push(ch);
  return Buffer.concat(chunks);
}

/** The storage keys among an asset's variants (the blur placeholder is a data URI, not a key). */
export function variantKeysOf(variants: Prisma.JsonValue | null | undefined): string[] {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return [];
  return Object.values(variants as Record<string, unknown>).filter((v): v is string => typeof v === "string" && !v.startsWith("data:"));
}

/** Makes an asset's variants. Returns what happened; failures are recorded on the asset and never thrown. */
export async function generateDerivatives(assetId: string): Promise<"done" | "skipped" | "failed"> {
  let a: { id: string; type: string; storageKey: string | null; width: number | null; height: number | null } | null = null;
  try {
    a = await db.mediaAsset.findUnique({ where: { id: assetId }, select: { id: true, type: true, storageKey: true, width: true, height: true } });
  } catch (e) {
    log.warn("derivatives: asset could not be read", { assetId, err: e });
    return "failed";
  }
  if (!a?.storageKey || !DERIVABLE.includes(a.type)) return "skipped";
  const key = a.storageKey;
  const variants: Record<string, string> = {};
  const size: { width?: number; height?: number } = {};
  try {
    if (a.type === "VIDEO") {
      // ffmpeg reads a local file or a signed URL; a bucket without signed URLs gets no poster
      const input = storage.localPath(key) ?? (storage.signedGetUrl ? await storage.signedGetUrl(key, { expiresInSeconds: 600 }) : null);
      if (input) {
        const poster = await videoPoster(input);
        if (poster) {
          const made = await imageVariants(poster);
          const best = made.variants.find((v) => v.name === "w640") ?? made.variants[made.variants.length - 1];
          const posterKey = variantKey(key, "poster");
          await storage.save(posterKey, stream(best.bytes));
          variants.poster = posterKey;
          variants.blur = made.blur;
        }
        const preview = await videoPreview(input);
        if (preview) {
          const previewKey = variantKey(key, "preview");
          await storage.save(previewKey, stream(preview));
          variants.preview = previewKey;
        }
      }
    } else {
      const made = await imageVariants(await readWhole(key));
      for (const v of made.variants) {
        const k = variantKey(key, v.name);
        await storage.save(k, stream(v.bytes));
        variants[v.name] = k;
      }
      variants.blur = made.blur;
      if (!a.width && made.width) size.width = made.width;
      if (!a.height && made.height) size.height = made.height;
    }
    await db.mediaAsset.update({ where: { id: a.id }, data: { variants, derivedAt: new Date(), deriveError: null, ...size } });
    return "done";
  } catch (e) {
    log.warn("derivatives failed", { assetId: a.id, key, err: e });
    // Whatever was written is kept and listed, so it is served and later cleaned up with the asset
    await db.mediaAsset.update({ where: { id: a.id }, data: { variants, derivedAt: new Date(), deriveError: e instanceof Error ? e.message : String(e) } }).catch(() => {});
    return "failed";
  }
}

/** Kicks generation off after the upload's answer is sent; the worker catches anything this misses. */
export function scheduleDerivatives(assetId: string) {
  setImmediate(() => {
    generateDerivatives(assetId).catch((e) => log.warn("derivatives job failed", { assetId, err: e }));
  });
}

/** From the worker: assets registered a while ago that still have no variants (limit per pass). */
export async function processPendingDerivatives(limit = 5, olderThanMs = 60_000) {
  const pending = await db.mediaAsset.findMany({
    where: { derivedAt: null, storageKey: { not: null }, type: { in: DERIVABLE }, createdAt: { lt: new Date(Date.now() - olderThanMs) } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let done = 0;
  for (const p of pending) if ((await generateDerivatives(p.id)) === "done") done++;
  return { attempted: pending.length, done };
}
