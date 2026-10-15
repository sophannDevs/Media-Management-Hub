"use client";

import { CloudUpload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { shortRequestId } from "@/lib/request-id";
import { cn } from "@/lib/utils";

export interface MediaMeta {
  width?: number;
  height?: number;
  durationSec?: number;
}

export const ACCEPT_BY_TYPE: Record<string, string> = {
  IMAGE: "image/*",
  THUMBNAIL: "image/*",
  VIDEO: "video/*",
  AUDIO: "audio/*",
  MUSIC: "audio/*",
};

/** Reads dimensions / duration in the browser so the server doesn't need ffprobe. */
export function readMediaMeta(file: File): Promise<MediaMeta> {
  const url = URL.createObjectURL(file);
  const done = (m: MediaMeta) => {
    URL.revokeObjectURL(url);
    return m;
  };
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(done({})), 8000);
    const finish = (m: MediaMeta) => {
      clearTimeout(timeout);
      resolve(done(m));
    };
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => finish({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => finish({});
      img.src = url;
    } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
      el.preload = "metadata";
      el.onloadedmetadata = () =>
        finish({
          durationSec: Number.isFinite(el.duration) ? el.duration : undefined,
          width: el instanceof HTMLVideoElement ? el.videoWidth || undefined : undefined,
          height: el instanceof HTMLVideoElement ? el.videoHeight || undefined : undefined,
        });
      el.onerror = () => finish({});
      el.src = url;
    } else {
      finish({});
    }
  });
}

export interface UploadResult {
  ok: boolean;
  created: string[];
  /** Files that were refused (the rest may have gone through) */
  errors: string[];
  error?: string;
  /** Matches the server's log line when the failure was unexpected (ARCH-04) */
  requestId?: string;
}

/** One file's answer: its id, or why it was refused. */
type FileResult = { ok: true; id: string } | { ok: false; error: string; requestId?: string };

type UploadOpts = { type: string; contentId?: string | null; meta: MediaMeta; onProgress: (loaded: number) => void };
type Presigned = { kind: "single"; url: string; headers: Record<string, string> } | { kind: "multipart"; uploadId: string; partSize: number; urls: string[] };

/** The server's answer to a file: its id, or why it was refused. */
function parseAnswer(text: string, status: number): FileResult {
  try {
    const body = JSON.parse(text) as { ok?: boolean; created?: string[]; error?: string; requestId?: string };
    return body.ok && body.created?.[0] ? { ok: true, id: body.created[0] } : { ok: false, error: body.error ?? "Upload failed.", requestId: body.requestId };
  } catch {
    return { ok: false, error: status === 413 ? "The file is too large." : "Upload failed." };
  }
}

/** One PUT of `blob` to a signed URL, with progress; resolves to the ETag the bucket answered (needed to finish a multipart upload). */
function putTo(url: string, blob: Blob, headers: Record<string, string>, onProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.getResponseHeader("ETag") ?? "") : reject(new Error(`The storage answered ${xhr.status}.`)));
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(blob);
  });
}

/**
 * Straight to the bucket (MEDIA-01): the file, or each part of it, goes to a
 * signed URL; then the server inspects and registers the object.
 */
async function uploadDirect(file: File, key: string, upload: Presigned, opts: UploadOpts): Promise<FileResult> {
  const parts: { partNumber: number; etag: string }[] = [];
  try {
    if (upload.kind === "single") {
      await putTo(upload.url, file, upload.headers, opts.onProgress);
    } else {
      let done = 0;
      for (let i = 0; i < upload.urls.length; i++) {
        const blob = file.slice(i * upload.partSize, Math.min(file.size, (i + 1) * upload.partSize));
        const etag = await putTo(upload.urls[i], blob, {}, (loaded) => opts.onProgress(done + loaded));
        if (!etag) throw new Error("The storage did not return the part's ETag (its CORS rule must expose it).");
        parts.push({ partNumber: i + 1, etag });
        done += blob.size;
      }
    }
  } catch (e) {
    if (upload.kind === "multipart") fetch(`/api/media/presign?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(upload.uploadId)}`, { method: "DELETE" }).catch(() => {});
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
  const res = await fetch("/api/media/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, type: opts.type, fileName: file.name, contentId: opts.contentId ?? null, uploadId: upload.kind === "multipart" ? upload.uploadId : null, parts: upload.kind === "multipart" ? parts : null, ...opts.meta }),
  });
  return parseAnswer(await res.text(), res.status);
}

/** Asks whether this server takes direct-to-bucket uploads; null means "upload through the server". */
async function presign(file: File, type: string): Promise<{ key: string; upload: Presigned } | null> {
  try {
    const res = await fetch("/api/media/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, fileName: file.name, size: file.size, contentType: file.type || "application/octet-stream" }) });
    const body = (await res.json()) as { ok?: boolean; direct?: boolean; key?: string; upload?: Presigned; error?: string };
    if (res.ok && body.direct && body.key && body.upload) return { key: body.key, upload: body.upload };
    // A refusal here (too large, wrong type) comes back the same way from the proxied route, with the same message
    return null;
  } catch {
    return null;
  }
}

/** One file: straight to the bucket when the server offers it, through the server otherwise. */
async function uploadOne(file: File, opts: UploadOpts): Promise<FileResult> {
  const direct = await presign(file, opts.type);
  if (direct) return uploadDirect(file, direct.key, direct.upload, opts);
  return uploadThrough(file, opts);
}

/**
 * Sends ONE file as the request body (XHR, for upload progress), with the type,
 * name and measured size in the query string. The server streams the bytes to
 * disk; nothing is held in memory on either side (PERF-07).
 */
function uploadThrough(file: File, opts: UploadOpts): Promise<FileResult> {
  const q = new URLSearchParams({ type: opts.type, fileName: file.name });
  if (opts.contentId) q.set("contentId", opts.contentId);
  for (const k of ["width", "height", "durationSec"] as const) if (opts.meta[k]) q.set(k, String(opts.meta[k]));

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/media?${q}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => opts.onProgress(e.loaded);
    xhr.onload = () => resolve(parseAnswer(xhr.responseText, xhr.status));
    xhr.onerror = () => resolve({ ok: false, error: "Network error during upload." });
    xhr.send(file);
  });
}

/**
 * Uploads files to /api/media one after another, so a big file never competes
 * with others for bandwidth or memory. Progress is overall, by bytes. Some
 * files may be refused while the rest go through: `errors` says which.
 */
export async function uploadMedia(opts: {
  files: File[];
  type: string;
  contentId?: string | null;
  onProgress?: (pct: number) => void;
}): Promise<UploadResult> {
  const total = opts.files.reduce((n, f) => n + f.size, 0) || 1;
  const created: string[] = [];
  const errors: string[] = [];
  let requestId: string | undefined;
  let sent = 0;
  for (const file of opts.files) {
    const meta = await readMediaMeta(file);
    const r = await uploadOne(file, { type: opts.type, contentId: opts.contentId, meta, onProgress: (loaded) => opts.onProgress?.(Math.min(100, Math.round(((sent + loaded) / total) * 100))) });
    sent += file.size;
    if (r.ok) created.push(r.id);
    else {
      // The server names the file in its own messages; a network or parse failure doesn't
      errors.push(r.error.startsWith(`${file.name}:`) ? r.error : `${file.name}: ${r.error}`);
      requestId ??= r.requestId;
    }
  }
  return { ok: created.length > 0, created, errors, error: created.length ? undefined : errors[0], requestId };
}

/** Upload with progress state, toasts and a router refresh on success. */
export function useMediaUpload() {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);

  async function upload(files: File[], type: string, contentId?: string | null) {
    if (!files.length) return null;
    setProgress(0);
    const r = await uploadMedia({ files, type, contentId, onProgress: setProgress });
    setProgress(null);
    if (r.ok) {
      toast.success(`${r.created.length} file${r.created.length === 1 ? "" : "s"} uploaded`, {
        description: r.errors.length ? `Skipped: ${r.errors.join(" · ")}` : undefined,
      });
      router.refresh();
    } else {
      const more = r.errors.slice(1).join(" · ");
      toast.error(r.error ?? "Upload failed.", { description: [more, r.requestId && `Reference ${shortRequestId(r.requestId)}`].filter(Boolean).join(" — ") || undefined });
    }
    return r;
  }

  return { upload, uploading: progress !== null, progress };
}

/** Click-or-drop area that uploads straight to a content item. */
export function UploadDropzone({
  type,
  contentId,
  multiple = true,
  title = "Drop files here or click to browse",
  hint,
  icon,
  className,
  onUploaded,
  children,
}: {
  type: string;
  contentId?: string | null;
  multiple?: boolean;
  title?: string;
  hint?: string;
  icon?: ReactNode;
  className?: string;
  onUploaded?: (r: UploadResult) => void;
  children?: ReactNode;
}) {
  const { upload, uploading, progress } = useMediaUpload();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function handle(list: FileList | null) {
    const files = Array.from(list ?? []);
    const r = await upload(multiple ? files : files.slice(0, 1), type, contentId);
    if (r) onUploaded?.(r);
    if (input.current) input.current.value = "";
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!uploading) void handle(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-300 p-6 text-center transition-colors hover:bg-[#fcfbf3]",
        over && "border-primary bg-olive-50",
        uploading && "pointer-events-none opacity-80",
        className,
      )}
    >
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={ACCEPT_BY_TYPE[type] ?? "*/*"}
        multiple={multiple}
        disabled={uploading}
        onChange={(e) => void handle(e.target.files)}
      />
      {children ?? (
        <>
          <span className="mb-2 text-primary [&_svg]:size-7">{icon ?? <CloudUpload />}</span>
          <p className="text-sm font-medium">{uploading ? `Uploading… ${progress ?? 0}%` : title}</p>
          {hint && !uploading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </>
      )}
      {uploading && <Progress value={progress ?? 0} aria-label="Upload progress" className="mt-3 h-1.5 w-full max-w-xs" />}
    </label>
  );
}
