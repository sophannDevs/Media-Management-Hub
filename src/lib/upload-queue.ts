// The browser's upload queue (MEDIA-02): one entry per file, moved along by
// the upload hook. Pure functions, so the rules are tested without React.

export type QueueStatus =
  /** Hashing and asking the server whether the file is already there */
  | "checking"
  /** The same bytes are in the library: waiting for "upload anyway" or "skip" */
  | "duplicate"
  | "queued"
  | "uploading"
  | "done"
  /** Retry keeps whatever was already sent (a multipart upload resumes) */
  | "failed"
  | "skipped";

export interface DuplicateRef {
  id: string;
  name: string;
  contentTitle?: string;
}

export interface QueueItem {
  id: string;
  name: string;
  size: number;
  status: QueueStatus;
  /** 0–100 while uploading */
  progress: number;
  error?: string;
  requestId?: string;
  duplicateOf?: DuplicateRef;
  assetId?: string;
  /** The person saw the duplicate warning and chose to keep the file */
  allowDuplicate: boolean;
  attempts: number;
}

export const newItem = (id: string, name: string, size: number): QueueItem => ({ id, name, size, status: "checking", progress: 0, allowDuplicate: false, attempts: 0 });

export const patch = (items: QueueItem[], id: string, change: Partial<QueueItem>): QueueItem[] => items.map((i) => (i.id === id ? { ...i, ...change } : i));

/** The next file to send: the first queued one, and only while nothing is uploading (one at a time: a big file never competes with others). */
export const nextToSend = (items: QueueItem[]): QueueItem | undefined => (items.some((i) => i.status === "uploading") ? undefined : items.find((i) => i.status === "queued"));

/** Nothing is in flight and nothing is waiting for a decision. */
export const settled = (items: QueueItem[]): boolean => items.every((i) => i.status === "done" || i.status === "failed" || i.status === "skipped");

/** Every file ended well (done or deliberately skipped): the batch can be reported as finished. */
export const finished = (items: QueueItem[]): boolean => items.length > 0 && items.every((i) => i.status === "done" || i.status === "skipped");

export const busy = (items: QueueItem[]): boolean => items.some((i) => i.status === "checking" || i.status === "uploading");

/** Overall progress by bytes, 0–100. */
export function overallProgress(items: QueueItem[]): number {
  const total = items.reduce((n, i) => n + i.size, 0) || 1;
  const sent = items.reduce((n, i) => n + (i.status === "done" || i.status === "skipped" ? i.size : i.status === "uploading" ? (i.size * i.progress) / 100 : 0), 0);
  return Math.min(100, Math.round((sent / total) * 100));
}

export function summary(items: QueueItem[]) {
  const created = items.filter((i) => i.status === "done" && i.assetId).map((i) => i.assetId!);
  const errors = items.filter((i) => i.status === "failed").map((i) => (i.error?.startsWith(`${i.name}:`) ? i.error : `${i.name}: ${i.error ?? "Upload failed."}`));
  const requestId = items.find((i) => i.status === "failed" && i.requestId)?.requestId;
  return { ok: created.length > 0, created, errors, error: created.length ? undefined : errors[0], requestId, skipped: items.filter((i) => i.status === "skipped").length, waiting: items.filter((i) => i.status === "duplicate").length };
}

/** "12.3 MB" for a size in bytes. */
export const formatBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
