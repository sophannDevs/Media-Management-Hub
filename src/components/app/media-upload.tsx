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

/**
 * Sends ONE file as the request body (XHR, for upload progress), with the type,
 * name and measured size in the query string. The server streams the bytes to
 * disk; nothing is held in memory on either side (PERF-07).
 */
function uploadOne(file: File, opts: { type: string; contentId?: string | null; meta: MediaMeta; onProgress: (loaded: number) => void }): Promise<FileResult> {
  const q = new URLSearchParams({ type: opts.type, fileName: file.name });
  if (opts.contentId) q.set("contentId", opts.contentId);
  for (const k of ["width", "height", "durationSec"] as const) if (opts.meta[k]) q.set(k, String(opts.meta[k]));

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/media?${q}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => opts.onProgress(e.loaded);
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { ok?: boolean; created?: string[]; error?: string; requestId?: string };
        resolve(body.ok && body.created?.[0] ? { ok: true, id: body.created[0] } : { ok: false, error: body.error ?? "Upload failed.", requestId: body.requestId });
      } catch {
        resolve({ ok: false, error: xhr.status === 413 ? "The file is too large." : "Upload failed." });
      }
    };
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
