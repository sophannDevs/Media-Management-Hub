import { db } from "@/lib/db";
import { logger } from "@/lib/log";
import { makeStorageKey, storage } from "@/lib/storage";
import { byteLimit, UploadTooLargeError } from "@/lib/storage/limit";
import { MediaType } from "@/lib/workflow/statuses";
import { apiError, rejectCrossSite, route } from "@/server/api";
import { unauthorizedResponse } from "@/server/auth/dal";
import { ServiceError } from "@/server/errors";
import { createMediaAsset } from "@/server/services/media";

// Upload of ONE file (PERF-07): the file's bytes are the request body, and
// everything else is in the query string:
//   POST /api/media?type=VIDEO&fileName=clip.mp4[&contentId=…][&width=…&height=…&durationSec=…]
//   Content-Type: video/mp4
// The body is piped straight to storage, never held in memory (a multipart
// form had to be parsed whole: about 2x the file in memory). The client sends
// files one request at a time. Not behind the proxy (see src/proxy.ts): a body
// passing through it is buffered and cut off at 10 MB. So this handler checks
// the origin and the session itself, before it reads a byte.

/**
 * Largest single file: 2 GiB minus one byte, because MediaAsset.size is a
 * 32-bit integer (exactly 2 GiB overflowed it and failed after the whole file
 * had been received). MEDIA_MAX_BYTES can lower it. Beyond this needs a BigInt
 * column, which comes with object storage (MEDIA-01).
 */
const MAX_FILE_BYTES = 2 ** 31 - 1;
const maxBytes = () => Math.min(Number(process.env.MEDIA_MAX_BYTES) || MAX_FILE_BYTES, MAX_FILE_BYTES);
const ALLOWED: Record<string, RegExp> = {
  IMAGE: /^image\//,
  THUMBNAIL: /^image\//,
  VIDEO: /^video\//,
  AUDIO: /^audio\//,
  MUSIC: /^audio\//,
  OTHER: /.*/,
};

const positive = (v: string | null) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : null;
};
const pixels = (v: string | null) => {
  const n = positive(v);
  return n === null ? null : Math.round(n);
};
const gigabytes = (n: number) => (n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

export const POST = route(async (req) => {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;

  const q = new URL(req.url).searchParams;
  const type = q.get("type") ?? "";
  const fileName = (q.get("fileName") ?? "").replace(/[\u0000-\u001f\\/]+/g, "-").trim().slice(0, 255);
  const contentId = q.get("contentId") || null;
  const mimeType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() || "application/octet-stream";

  if (!MediaType.is(type)) return apiError(400, "VALIDATION", "Choose a media type.");
  if (!fileName) return apiError(400, "VALIDATION", "The file needs a name.");
  if (!ALLOWED[type].test(mimeType)) return apiError(400, "VALIDATION", `${fileName}: not a valid ${MediaType.label(type).toLowerCase()} file.`);

  // Refuse by the declared size before reading anything; the byteLimit below catches a wrong or missing one
  const limit = maxBytes();
  const declared = Number(req.headers.get("content-length"));
  if (declared > limit) return apiError(413, "TOO_LARGE", `${fileName}: larger than ${gigabytes(limit)}.`);
  if (req.headers.get("content-length") === "0" || !req.body) return apiError(400, "VALIDATION", `${fileName}: the file is empty.`);
  if (contentId && !(await db.content.findUnique({ where: { id: contentId }, select: { id: true } }))) {
    return apiError(404, "NOT_FOUND", "Content not found.");
  }

  const key = makeStorageKey(fileName);
  try {
    const { size } = await storage.save(key, req.body.pipeThrough(byteLimit(limit)));
    if (size === 0) throw new ServiceError(`${fileName}: the file is empty.`);
    // A body that ends before its declared length was cut off somewhere on the way (a proxy limit once did exactly this): never store half a file as a success
    if (declared > 0 && size !== declared) throw new ServiceError(`${fileName}: the upload was cut short (${size} of ${declared} bytes arrived). Try again.`);
    const asset = await createMediaAsset({
      contentId,
      type,
      fileName,
      storageKey: key,
      mimeType,
      size,
      width: pixels(q.get("width")),
      height: pixels(q.get("height")),
      durationSec: positive(q.get("durationSec")),
    });
    return Response.json({ ok: true, created: [asset.id], errors: [], assets: [{ id: asset.id, size }] });
  } catch (e) {
    // Never leave half a file behind
    await storage.remove(key).catch(() => {});
    if (e instanceof UploadTooLargeError || (e instanceof Error && e.cause instanceof UploadTooLargeError)) {
      return apiError(413, "TOO_LARGE", `${fileName}: larger than ${gigabytes(limit)}.`);
    }
    if (e instanceof ServiceError) return apiError(400, "VALIDATION", e.message);
    if (req.signal.aborted) {
      logger.warn("upload interrupted by the client", { fileName });
      return apiError(400, "VALIDATION", `${fileName}: the upload was interrupted.`, { log: false });
    }
    throw e;
  }
});
