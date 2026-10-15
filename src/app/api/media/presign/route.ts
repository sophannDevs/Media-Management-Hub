import { z } from "zod";
import { ALLOWED_DECLARED, gigabytes, maxBytes, sanitizeFileName, STORAGE_KEY_SHAPE } from "@/lib/media/limits";
import { sizeCapFor } from "@/lib/media/sniff";
import { makeStorageKey, storage, storageIsBucket } from "@/lib/storage";
import { MediaType } from "@/lib/workflow/statuses";
import { apiError, rejectCrossSite, route } from "@/server/api";
import { unauthorizedResponse } from "@/server/auth/dal";

// Direct-to-bucket uploads (MEDIA-01): the browser asks here for signed URLs,
// PUTs the file (or its parts) straight to the bucket, then calls
// /api/media/complete, which inspects the object the way /api/media does.
// Available only with a bucket and STORAGE_DIRECT_UPLOAD=true; otherwise the
// answer is { direct: false } and the browser uploads through this server.

const directUploads = () => storageIsBucket && process.env.STORAGE_DIRECT_UPLOAD === "true" && !!storage.presignUpload;

const presignSchema = z.object({
  type: z.string(),
  fileName: z.string().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().min(1).max(100),
});

export const POST = route(async (req) => {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  if (!directUploads()) return Response.json({ ok: true, direct: false });

  const parsed = presignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "VALIDATION", "Send { type, fileName, size, contentType }.");
  const { type, size, contentType } = parsed.data;
  const fileName = sanitizeFileName(parsed.data.fileName);
  if (!MediaType.is(type)) return apiError(400, "VALIDATION", "Choose a media type.");
  if (!fileName) return apiError(400, "VALIDATION", "The file needs a name.");
  if (!ALLOWED_DECLARED[type].test(contentType.toLowerCase())) return apiError(400, "VALIDATION", `${fileName}: not a valid ${MediaType.label(type).toLowerCase()} file.`);
  const limit = sizeCapFor(type, maxBytes());
  if (limit === 0) return apiError(400, "VALIDATION", `${fileName}: files of type "${MediaType.label(type)}" can't be uploaded; choose Image, Video, Thumbnail, Audio or Music.`);
  if (size > limit) return apiError(413, "TOO_LARGE", `${fileName}: larger than ${gigabytes(limit)}, the limit for ${MediaType.label(type).toLowerCase()} files.`);

  const key = makeStorageKey(fileName);
  const upload = await storage.presignUpload!(key, { contentType: contentType.toLowerCase(), size });
  return Response.json({ ok: true, direct: true, key, upload });
});

/** Gives up a multipart upload the browser could not finish, so the bucket doesn't keep its parts. */
export const DELETE = route(async (req) => {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const q = new URL(req.url).searchParams;
  const key = q.get("key") ?? "";
  const uploadId = q.get("uploadId") ?? "";
  if (!STORAGE_KEY_SHAPE.test(key) || !uploadId) return apiError(400, "VALIDATION", "Send key and uploadId.");
  if (!directUploads() || !storage.abortUpload) return apiError(404, "NOT_FOUND", "Direct uploads are not enabled.");
  await storage.abortUpload(key, uploadId);
  return Response.json({ ok: true });
});
