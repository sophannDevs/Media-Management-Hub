"use client";

import { CloudUpload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
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
  OTHER: "*/*",
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
  errors: string[];
  error?: string;
}

/** POSTs files to /api/media (XHR so we get upload progress). */
export async function uploadMedia(opts: {
  files: File[];
  type: string;
  contentId?: string | null;
  onProgress?: (pct: number) => void;
}): Promise<UploadResult> {
  const meta = await Promise.all(opts.files.map(readMediaMeta));
  const form = new FormData();
  form.set("type", opts.type);
  if (opts.contentId) form.set("contentId", opts.contentId);
  form.set("meta", JSON.stringify(meta));
  for (const f of opts.files) form.append("file", f);

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as UploadResult);
      } catch {
        resolve({ ok: false, created: [], errors: [], error: "Upload failed." });
      }
    };
    xhr.onerror = () => resolve({ ok: false, created: [], errors: [], error: "Network error during upload." });
    xhr.send(form);
  });
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
      toast.error(r.error ?? "Upload failed.", { description: r.errors.slice(1).join(" · ") || undefined });
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
      {uploading && <Progress value={progress ?? 0} className="mt-3 h-1.5 w-full max-w-xs" />}
    </label>
  );
}
