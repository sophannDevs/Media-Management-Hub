import { db } from "@/lib/db";
import { logger } from "@/lib/log";
import { hashAndPeek } from "@/lib/media/inspect";
import { probeMedia } from "@/lib/media/probe";
import { checkUpload, sizeCapFor } from "@/lib/media/sniff";
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
// files one request at a time. What the file IS is decided from its bytes
// (SEC-05): the first bytes are sniffed, the name's extension and the chosen
// type must agree, the whole file is hashed, and ffprobe measures it. Not behind the proxy (see src/proxy.ts): a body
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
  // A cheap first check on what the browser declared; the stored type comes from the bytes below
  if (!ALLOWED[type].test(mimeType)) return apiError(400, "VALIDATION", `${fileName}: not a valid ${MediaType.label(type).toLowerCase()} file.`);

  // Refuse by the declared size before reading anything; the byteLimit below catches a wrong or missing one.
  // Each type has its own cap (an image is never 2 GB); OTHER accepts nothing (SEC-05).
  const limit = sizeCapFor(type, maxBytes());
  if (limit === 0) return apiError(400, "VALIDATION", `${fileName}: files of type "${MediaType.label(type)}" can't be uploaded; choose Image, Video, Thumbnail, Audio or Music.`);
  const declared = Number(req.headers.get("content-length"));
  if (declared > limit) return apiError(413, "TOO_LARGE", `${fileName}: larger than ${gigabytes(limit)}, the limit for ${MediaType.label(type).toLowerCase()} files.`);
  if (req.headers.get("content-length") === "0" || !req.body) return apiError(400, "VALIDATION", `${fileName}: the file is empty.`);
  if (contentId && !(await db.content.findUnique({ where: { id: contentId }, select: { id: true } }))) {
    return apiError(404, "NOT_FOUND", "Content not found.");
  }

  const key = makeStorageKey(fileName);
  const inspect = hashAndPeek();
  try {
    const { size } = await storage.save(key, req.body.pipeThrough(byteLimit(limit)).pipeThrough(inspect.stream));
    if (size === 0) throw new ServiceError(`${fileName}: the file is empty.`);
    // A body that ends before its declared length was cut off somewhere on the way (a proxy limit once did exactly this): never store half a file as a success
    if (declared > 0 && size !== declared) throw new ServiceError(`${fileName}: the upload was cut short (${size} of ${declared} bytes arrived). Try again.`);
    // What the file really is: its first bytes decide, and the name and type must agree (SEC-05)
    const { sha256, head } = inspect.result();
    const check = checkUpload(type, fileName, head);
    if (!check.ok) throw new ServiceError(check.message);
    // The real duration, dimensions and codecs, when the server has ffprobe; the browser's figures otherwise
    const localPath = storage.localPath(key);
    const probe = localPath ? await probeMedia(localPath) : null;
    const asset = await createMediaAsset({
      contentId,
      type,
      fileName,
      storageKey: key,
      mimeType: check.mimeType,
      size,
      width: probe?.width ?? pixels(q.get("width")),
      height: probe?.height ?? pixels(q.get("height")),
      durationSec: probe?.durationSec ?? positive(q.get("durationSec")),
      sha256,
      codec: probe?.codec ?? null,
      container: probe?.container ?? null,
      probedAt: probe ? new Date() : null,
    });
    return Response.json({ ok: true, created: [asset.id], errors: [], assets: [{ id: asset.id, size, sha256, mimeType: check.mimeType }] });
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
