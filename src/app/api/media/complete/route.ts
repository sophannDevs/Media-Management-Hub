import { z } from "zod";
import { db } from "@/lib/db";
import { hashAndPeek } from "@/lib/media/inspect";
import { gigabytes, maxBytes, sanitizeFileName, STORAGE_KEY_SHAPE } from "@/lib/media/limits";
import { probeMedia } from "@/lib/media/probe";
import { checkUpload, sizeCapFor } from "@/lib/media/sniff";
import { storage, storageIsBucket } from "@/lib/storage";
import { MediaType } from "@/lib/workflow/statuses";
import { apiError, rejectCrossSite, route } from "@/server/api";
import { unauthorizedResponse } from "@/server/auth/dal";
import { ServiceError } from "@/server/errors";
import { createMediaAsset, duplicateRefusal, findDuplicate } from "@/server/services/media";

// Second half of a direct-to-bucket upload (MEDIA-01): the browser has PUT
// the file to the bucket; this finishes a multipart upload, then inspects the
// object the way /api/media inspects a proxied upload (SEC-05) — its first
// bytes decide the type, the whole object is hashed (read once from the
// bucket), ffprobe measures it through a signed URL — and registers it. An
// object that fails a check is deleted from the bucket.

const schema = z.object({
  key: z.string().regex(STORAGE_KEY_SHAPE),
  type: z.string(),
  fileName: z.string().min(1).max(255),
  contentId: z.string().min(1).nullish(),
  uploadId: z.string().min(1).nullish(),
  parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) })).nullish(),
  width: z.number().positive().nullish(),
  height: z.number().positive().nullish(),
  durationSec: z.number().positive().nullish(),
  /** The browser was warned the file is a duplicate and chose to keep it (MEDIA-02) */
  allowDuplicate: z.boolean().nullish(),
});

async function readHead(key: string, size: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const ch of storage.readStream(key, { start: 0, end: Math.min(4095, size - 1) }) as unknown as AsyncIterable<Uint8Array>) chunks.push(ch);
  return Buffer.concat(chunks);
}

export const POST = route(async (req) => {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  if (!storageIsBucket || process.env.STORAGE_DIRECT_UPLOAD !== "true") return apiError(404, "NOT_FOUND", "Direct uploads are not enabled.");

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "Send the upload's key, type and file name.");
  const { key, type, uploadId, parts, contentId } = parsed.data;
  const fileName = sanitizeFileName(parsed.data.fileName);
  if (!MediaType.is(type)) return apiError(400, "VALIDATION", "Choose a media type.");
  if (!fileName) return apiError(400, "VALIDATION", "The file needs a name.");
  if (await db.mediaAsset.findUnique({ where: { storageKey: key }, select: { id: true } })) return apiError(409, "CONFLICT", "That upload was already registered.");
  if (contentId && !(await db.content.findUnique({ where: { id: contentId }, select: { id: true } }))) return apiError(404, "NOT_FOUND", "Content not found.");

  try {
    if (uploadId) {
      if (!parts?.length || !storage.completeUpload) throw new ServiceError(`${fileName}: the upload's parts are missing.`);
      await storage.completeUpload(key, uploadId, parts);
    }
    const info = await storage.stat(key);
    if (!info || info.size === 0) throw new ServiceError(`${fileName}: nothing arrived in storage.`);
    const limit = sizeCapFor(type, maxBytes());
    if (limit === 0) throw new ServiceError(`${fileName}: files of type "${MediaType.label(type)}" can't be uploaded.`);
    if (info.size > limit) throw new ServiceError(`${fileName}: larger than ${gigabytes(limit)}, the limit for ${MediaType.label(type).toLowerCase()} files.`);

    const check = checkUpload(type, fileName, await readHead(key, info.size));
    if (!check.ok) throw new ServiceError(check.message);
    const inspect = hashAndPeek(0);
    await storage.readStream(key).pipeThrough(inspect.stream).pipeTo(new WritableStream());
    const { sha256, bytes } = inspect.result();
    if (bytes !== info.size) throw new ServiceError(`${fileName}: the stored object could not be read whole.`);
    if (!parsed.data.allowDuplicate) {
      const dup = await findDuplicate(sha256);
      if (dup) throw duplicateRefusal(fileName, dup);
    }
    const probe = storage.signedGetUrl ? await probeMedia(await storage.signedGetUrl(key, { expiresInSeconds: 600 })) : null;

    const asset = await createMediaAsset({
      contentId: contentId ?? null,
      type,
      fileName,
      storageKey: key,
      mimeType: check.mimeType,
      size: info.size,
      width: probe?.width ?? (parsed.data.width ? Math.round(parsed.data.width) : null),
      height: probe?.height ?? (parsed.data.height ? Math.round(parsed.data.height) : null),
      durationSec: probe?.durationSec ?? parsed.data.durationSec ?? null,
      sha256,
      codec: probe?.codec ?? null,
      container: probe?.container ?? null,
      probedAt: probe ? new Date() : null,
    });
    return Response.json({ ok: true, created: [asset.id], errors: [], assets: [{ id: asset.id, size: info.size, sha256, mimeType: check.mimeType }] });
  } catch (e) {
    // Never leave an object behind that isn't registered
    await storage.remove(key).catch(() => {});
    if (e instanceof ServiceError) return e.code === "CONFLICT" ? apiError(409, "CONFLICT", e.message, { info: e.info }) : apiError(400, "VALIDATION", e.message);
    throw e;
  }
});
