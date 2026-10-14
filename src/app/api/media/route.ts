import { db } from "@/lib/db";
import { makeStorageKey, storage } from "@/lib/storage";
import { MediaType } from "@/lib/workflow/statuses";
import { ServiceError } from "@/server/errors";
import { createMediaAsset } from "@/server/services/media";

// Multipart upload: fields `file` (one or many), `type`, optional `contentId`,
// and optional per-file metadata `meta` (JSON array of {width,height,durationSec}).
// A Route Handler is used instead of a Server Action because videos exceed the
// Server Action body limit and should be streamed to disk.

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const ALLOWED: Record<string, RegExp> = {
  IMAGE: /^image\//,
  THUMBNAIL: /^image\//,
  VIDEO: /^video\//,
  AUDIO: /^audio\//,
  MUSIC: /^audio\//,
  OTHER: /.*/,
};

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Invalid upload." }, { status: 400 });
  }

  const type = String(form.get("type") ?? "");
  const contentId = (form.get("contentId") as string | null) || null;
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  let meta: { width?: number; height?: number; durationSec?: number }[] = [];
  try {
    meta = JSON.parse(String(form.get("meta") ?? "[]"));
  } catch {
    meta = [];
  }

  if (!MediaType.is(type)) return Response.json({ ok: false, error: "Choose a media type." }, { status: 400 });
  if (!files.length) return Response.json({ ok: false, error: "Choose at least one file." }, { status: 400 });
  if (contentId && !(await db.content.findUnique({ where: { id: contentId }, select: { id: true } }))) {
    return Response.json({ ok: false, error: "Content not found." }, { status: 404 });
  }

  const created: string[] = [];
  const errors: string[] = [];
  for (const [i, file] of files.entries()) {
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name}: larger than 2 GB.`);
      continue;
    }
    if (!ALLOWED[type].test(file.type || "")) {
      errors.push(`${file.name}: not a valid ${MediaType.label(type).toLowerCase()} file.`);
      continue;
    }
    const key = makeStorageKey(file.name);
    try {
      const { size } = await storage.save(key, file.stream());
      const asset = await createMediaAsset({
        contentId,
        type,
        fileName: file.name,
        storageKey: key,
        mimeType: file.type || "application/octet-stream",
        size,
        width: meta[i]?.width ? Math.round(meta[i].width!) : null,
        height: meta[i]?.height ? Math.round(meta[i].height!) : null,
        durationSec: meta[i]?.durationSec ?? null,
      });
      created.push(asset.id);
    } catch (e) {
      await storage.remove(key);
      errors.push(`${file.name}: ${e instanceof ServiceError ? e.message : "upload failed."}`);
    }
  }

  return Response.json(
    { ok: created.length > 0, created, errors, error: created.length ? undefined : errors[0] },
    { status: created.length ? 200 : 400 },
  );
}
