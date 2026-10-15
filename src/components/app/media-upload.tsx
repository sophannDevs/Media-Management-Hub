"use client";

import { Check, CloudUpload, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { shortRequestId } from "@/lib/request-id";
import { busy, type DuplicateRef, finished, formatBytes, newItem, nextToSend, overallProgress, patch, type QueueItem, settled, summary } from "@/lib/upload-queue";
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

/** The server's answer to one file. */
type FileOutcome = { ok: true; id: string } | { ok: false; error: string; requestId?: string; duplicateOf?: DuplicateRef; resume?: ResumeState };
/** What a failed direct upload already got into the bucket, so a retry resumes instead of starting over (MEDIA-02). */
type ResumeState = { key: string; upload: Presigned; parts: { partNumber: number; etag: string }[] };
type UploadOpts = { type: string; contentId?: string | null; meta: MediaMeta; allowDuplicate: boolean; resume?: ResumeState; onProgress: (loaded: number) => void };
type Presigned = { kind: "single"; url: string; headers: Record<string, string> } | { kind: "multipart"; uploadId: string; partSize: number; urls: string[] };

function parseAnswer(text: string, status: number): FileOutcome {
  try {
    const body = JSON.parse(text) as { ok?: boolean; created?: string[]; error?: string; requestId?: string; code?: string; info?: Record<string, string> };
    if (body.ok && body.created?.[0]) return { ok: true, id: body.created[0] };
    // The server found the same bytes in the library (MEDIA-02): the person decides
    const duplicateOf = body.code === "CONFLICT" && body.info?.duplicateId ? { id: body.info.duplicateId, name: body.info.duplicateName ?? "", contentTitle: body.info.duplicateContentTitle } : undefined;
    return { ok: false, error: body.error ?? "Upload failed.", requestId: body.requestId, duplicateOf };
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
 * signed URL; then the server inspects and registers the object. A retry of a
 * multipart upload sends only the parts that didn't arrive (MEDIA-02).
 */
async function uploadDirect(file: File, key: string, upload: Presigned, opts: UploadOpts): Promise<FileOutcome> {
  const parts = [...(opts.resume?.parts ?? [])];
  try {
    if (upload.kind === "single") {
      await putTo(upload.url, file, upload.headers, opts.onProgress);
    } else {
      const have = new Set(parts.map((p) => p.partNumber));
      let done = 0;
      for (let i = 0; i < upload.urls.length; i++) {
        const blob = file.slice(i * upload.partSize, Math.min(file.size, (i + 1) * upload.partSize));
        if (have.has(i + 1)) {
          done += blob.size;
          opts.onProgress(done);
          continue;
        }
        const etag = await putTo(upload.urls[i], blob, {}, (loaded) => opts.onProgress(done + loaded));
        if (!etag) throw new Error("The storage did not return the part's ETag (its CORS rule must expose it).");
        parts.push({ partNumber: i + 1, etag });
        done += blob.size;
      }
    }
  } catch (e) {
    // Keep what arrived: a retry resumes from here (the bucket keeps the parts until they are completed, aborted or expire)
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed.", resume: upload.kind === "multipart" ? { key, upload, parts } : undefined };
  }
  const res = await fetch("/api/media/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      type: opts.type,
      fileName: file.name,
      contentId: opts.contentId ?? null,
      uploadId: upload.kind === "multipart" ? upload.uploadId : null,
      parts: upload.kind === "multipart" ? parts.sort((a, b) => a.partNumber - b.partNumber) : null,
      allowDuplicate: opts.allowDuplicate,
      ...opts.meta,
    }),
  });
  // A refusal at completion deleted the object: nothing to resume
  return parseAnswer(await res.text(), res.status);
}

/** Asks whether this server takes direct-to-bucket uploads; null means "upload through the server". */
async function presign(file: File, type: string): Promise<{ key: string; upload: Presigned } | null> {
  try {
    const res = await fetch("/api/media/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, fileName: file.name, size: file.size, contentType: file.type || "application/octet-stream" }) });
    const body = (await res.json()) as { ok?: boolean; direct?: boolean; key?: string; upload?: Presigned };
    if (res.ok && body.direct && body.key && body.upload) return { key: body.key, upload: body.upload };
    // A refusal here (too large, wrong type) comes back the same way from the proxied route, with the same message
    return null;
  } catch {
    return null;
  }
}

/** One file: resumed where it left off, straight to the bucket when the server offers it, through the server otherwise. */
async function uploadOne(file: File, opts: UploadOpts): Promise<FileOutcome> {
  if (opts.resume) return uploadDirect(file, opts.resume.key, opts.resume.upload, opts);
  const direct = await presign(file, opts.type);
  if (direct) return uploadDirect(file, direct.key, direct.upload, opts);
  return uploadThrough(file, opts);
}

/**
 * Sends ONE file as the request body (XHR, for upload progress), with the type,
 * name and measured size in the query string. The server streams the bytes to
 * disk; nothing is held in memory on either side (PERF-07).
 */
function uploadThrough(file: File, opts: UploadOpts): Promise<FileOutcome> {
  const q = new URLSearchParams({ type: opts.type, fileName: file.name });
  if (opts.contentId) q.set("contentId", opts.contentId);
  if (opts.allowDuplicate) q.set("allowDuplicate", "1");
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

/** SHA-256 of a file in the browser, for the early duplicate warning; null for files too big to hash in memory. */
async function hashFile(file: File): Promise<string | null> {
  if (file.size > 256 * 1024 * 1024 || typeof crypto?.subtle?.digest !== "function") return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** The library's copy of this file, when it already has one (the server checks again when the upload lands). */
async function knownDuplicate(file: File): Promise<DuplicateRef | null> {
  const sha256 = await hashFile(file);
  if (!sha256) return null;
  try {
    const res = await fetch(`/api/media/duplicate?sha256=${sha256}`);
    const body = (await res.json()) as { duplicateOf?: { id: string; fileName: string; content?: { title: string } | null } | null };
    return body.duplicateOf ? { id: body.duplicateOf.id, name: body.duplicateOf.fileName, contentTitle: body.duplicateOf.content?.title } : null;
  } catch {
    return null;
  }
}

/**
 * Uploads several files (the older entry point, kept for callers without a
 * queue on screen): each file in turn, duplicates refused.
 */
export async function uploadMedia(opts: { files: File[]; type: string; contentId?: string | null; onProgress?: (pct: number) => void }): Promise<UploadResult> {
  const total = opts.files.reduce((n, f) => n + f.size, 0) || 1;
  const created: string[] = [];
  const errors: string[] = [];
  let requestId: string | undefined;
  let sent = 0;
  for (const file of opts.files) {
    const meta = await readMediaMeta(file);
    const r = await uploadOne(file, { type: opts.type, contentId: opts.contentId, meta, allowDuplicate: false, onProgress: (loaded) => opts.onProgress?.(Math.min(100, Math.round(((sent + loaded) / total) * 100))) });
    sent += file.size;
    if (r.ok) created.push(r.id);
    else {
      errors.push(r.error.startsWith(`${file.name}:`) ? r.error : `${file.name}: ${r.error}`);
      requestId ??= r.requestId;
    }
  }
  return { ok: created.length > 0, created, errors, error: created.length ? undefined : errors[0], requestId };
}

/**
 * The upload queue (MEDIA-02): every file is hashed and checked against the
 * library before it is sent (a duplicate waits for "upload anyway" or "skip"),
 * files go one at a time, a failure can be retried (a direct upload resumes
 * from the parts that arrived), and the batch is announced once it is through.
 */
export function useMediaUpload(opts: { onFinished?: (r: UploadResult) => void } = {}) {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const itemsRef = useRef<QueueItem[]>([]);
  const files = useRef(new Map<string, { file: File; meta: MediaMeta; resume?: ResumeState }>());
  const batch = useRef<{ type: string; contentId?: string | null; resolve: (r: UploadResult) => void; resolved: boolean } | null>(null);
  const pumping = useRef(false);

  const update = (next: QueueItem[] | ((prev: QueueItem[]) => QueueItem[])) => {
    itemsRef.current = typeof next === "function" ? next(itemsRef.current) : next;
    setItems(itemsRef.current);
  };
  const set = (id: string, change: Partial<QueueItem>) => update((prev) => patch(prev, id, change));

  /** Once nothing is in flight or waiting: announce the outcome, refresh, and answer the caller. */
  function settle() {
    const q = itemsRef.current;
    const b = batch.current;
    if (!b || !settled(q)) return;
    const r = summary(q);
    if (r.ok) {
      toast.success(`${r.created.length} file${r.created.length === 1 ? "" : "s"} uploaded`, {
        description: r.errors.length ? `Failed: ${r.errors.join(" · ")}` : r.skipped ? `${r.skipped} skipped` : undefined,
      });
      router.refresh();
    } else if (r.errors.length) {
      const more = r.errors.slice(1).join(" · ");
      toast.error(r.error ?? "Upload failed.", { description: [more, r.requestId && `Reference ${shortRequestId(r.requestId)}`].filter(Boolean).join(" — ") || undefined });
    }
    if (!b.resolved) {
      b.resolved = true;
      b.resolve(r);
    }
    // Every file uploaded or skipped: the list has nothing left to show (failures and duplicates keep it on screen)
    if (finished(q)) {
      opts.onFinished?.(r);
      update([]);
      files.current.clear();
    }
  }

  async function pump() {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const next = nextToSend(itemsRef.current);
        const b = batch.current;
        if (!next || !b) break;
        const entry = files.current.get(next.id);
        if (!entry) {
          set(next.id, { status: "failed", error: "The file is no longer available." });
          continue;
        }
        set(next.id, { status: "uploading", progress: 0, attempts: next.attempts + 1, error: undefined, requestId: undefined });
        const r = await uploadOne(entry.file, {
          type: b.type,
          contentId: b.contentId,
          meta: entry.meta,
          allowDuplicate: next.allowDuplicate,
          resume: entry.resume,
          onProgress: (loaded) => set(next.id, { progress: Math.min(100, Math.round((loaded / (entry.file.size || 1)) * 100)) }),
        });
        if (r.ok) {
          entry.resume = undefined;
          set(next.id, { status: "done", progress: 100, assetId: r.id });
        } else if (r.duplicateOf) {
          entry.resume = undefined;
          set(next.id, { status: "duplicate", duplicateOf: r.duplicateOf, progress: 0 });
        } else {
          entry.resume = r.resume;
          set(next.id, { status: "failed", error: r.error, requestId: r.requestId });
        }
      }
    } finally {
      pumping.current = false;
      settle();
    }
  }

  /** Starts a batch; resolves once every file is done, failed or skipped (duplicates waiting for a decision keep it open). */
  function upload(list: File[], type: string, contentId?: string | null): Promise<UploadResult | null> {
    if (!list.length) return Promise.resolve(null);
    return new Promise((resolve) => {
      batch.current = { type, contentId, resolve, resolved: false };
      files.current.clear();
      const fresh = list.map((file) => {
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        files.current.set(id, { file, meta: {} });
        return newItem(id, file.name, file.size);
      });
      update(fresh);
      for (const item of fresh) {
        void (async () => {
          const entry = files.current.get(item.id)!;
          const [meta, dup] = await Promise.all([readMediaMeta(entry.file), knownDuplicate(entry.file)]);
          entry.meta = meta;
          if (batch.current?.resolve !== resolve) return; // a newer batch replaced this one
          set(item.id, dup ? { status: "duplicate", duplicateOf: dup } : { status: "queued" });
          if (dup) settle();
          else void pump();
        })();
      }
    });
  }

  const retry = (id: string) => {
    set(id, { status: "queued" });
    void pump();
  };
  const allowDuplicate = (id: string) => {
    set(id, { status: "queued", allowDuplicate: true, duplicateOf: undefined });
    void pump();
  };
  const skip = (id: string) => {
    set(id, { status: "skipped" });
    if (!pumping.current) settle();
  };
  const clear = () => {
    if (busy(itemsRef.current)) return;
    update([]);
    files.current.clear();
  };

  const active = busy(items);
  return { upload, items, retry, allowDuplicate, skip, clear, uploading: active, progress: active ? overallProgress(items) : null };
}

/** The queue on screen: each file's state, and what the person can do about it. */
function UploadQueue({ items, onRetry, onAllow, onSkip, onClear, busy: inFlight }: { items: QueueItem[]; onRetry: (id: string) => void; onAllow: (id: string) => void; onSkip: (id: string) => void; onClear: () => void; busy: boolean }) {
  return (
    <ul aria-label="Upload queue" className="mt-3 divide-y divide-[#f1eedf] rounded-xl border border-[#ece9d6] bg-white text-sm">
      {items.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-medium" title={i.name}>
            {i.name}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(i.size)}</span>
          {i.status === "checking" && <span className="text-xs text-muted-foreground">Checking…</span>}
          {i.status === "queued" && <span className="text-xs text-muted-foreground">Waiting</span>}
          {i.status === "uploading" && <Progress value={i.progress} aria-label={`Uploading ${i.name}`} className="h-1.5 w-28" />}
          {i.status === "done" && (
            <span className="flex items-center gap-1 text-xs text-olive-700">
              <Check className="size-3.5" />
              Uploaded
            </span>
          )}
          {i.status === "skipped" && <span className="text-xs text-muted-foreground">Skipped</span>}
          {i.status === "duplicate" && (
            <span className="flex w-full flex-wrap items-center gap-2 text-xs text-amber-900 sm:w-auto">
              <span>
                Already uploaded as {i.duplicateOf?.name}
                {i.duplicateOf?.contentTitle ? ` (in “${i.duplicateOf.contentTitle}”)` : ""}
              </span>
              <Button type="button" size="sm" variant="outline" className="h-7 bg-white" onClick={() => onAllow(i.id)}>
                Upload anyway
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => onSkip(i.id)}>
                Skip
              </Button>
            </span>
          )}
          {i.status === "failed" && (
            <span className="flex w-full flex-wrap items-center gap-2 text-xs text-rose-700 sm:w-auto">
              <span className="min-w-0 max-w-xs truncate" title={i.error}>
                {i.error}
              </span>
              <Button type="button" size="sm" variant="outline" className="h-7 bg-white" onClick={() => onRetry(i.id)}>
                <RotateCcw className="size-3.5" />
                Retry
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => onSkip(i.id)}>
                Skip
              </Button>
            </span>
          )}
        </li>
      ))}
      {!inFlight && (
        <li className="flex justify-end px-3 py-1.5">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onClear}>
            <X className="size-3.5" />
            Clear list
          </Button>
        </li>
      )}
    </ul>
  );
}

/** Click-or-drop area that uploads straight to a content item, with the queue below it. */
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
  /** Called once every file of a batch is uploaded or skipped (a batch with failures stays on screen for retries) */
  onUploaded?: (r: UploadResult) => void;
  children?: ReactNode;
}) {
  const { upload, items, retry, allowDuplicate, skip, clear, uploading, progress } = useMediaUpload({ onFinished: onUploaded });
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function handle(list: FileList | null) {
    const files = Array.from(list ?? []);
    await upload(multiple ? files : files.slice(0, 1), type, contentId);
    if (input.current) input.current.value = "";
  }

  return (
    <>
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
        <input ref={input} type="file" className="hidden" accept={ACCEPT_BY_TYPE[type] ?? "*/*"} multiple={multiple} disabled={uploading} onChange={(e) => void handle(e.target.files)} />
        {children ?? (
          <>
            <span className="mb-2 text-primary [&_svg]:size-7">{icon ?? <CloudUpload />}</span>
            <p className="text-sm font-medium">{uploading ? `Uploading… ${progress ?? 0}%` : title}</p>
            {hint && !uploading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </>
        )}
        {uploading && <Progress value={progress ?? 0} aria-label="Upload progress" className="mt-3 h-1.5 w-full max-w-xs" />}
      </label>
      {items.length > 0 && <UploadQueue items={items} onRetry={retry} onAllow={allowDuplicate} onSkip={skip} onClear={clear} busy={uploading} />}
    </>
  );
}
