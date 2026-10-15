import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { s3Config, s3StorageProvider } from "./s3";

// Where uploaded files live. Local disk by default (and in development); an
// S3-compatible bucket with STORAGE_PROVIDER=s3 (MEDIA-01, ./s3.ts). Callers
// use the same small interface either way; the optional parts are what a
// bucket can do that a disk can't (signed URLs, direct browser uploads).

export interface StoredObject {
  key: string;
  size: number;
  modifiedAt: Date;
}

/** Where a browser can send a file straight to the bucket: one PUT, or one PUT per part. */
export type PresignedUpload = { kind: "single"; url: string; headers: Record<string, string> } | { kind: "multipart"; uploadId: string; partSize: number; urls: string[] };

export interface StorageProvider {
  save(key: string, body: ReadableStream<Uint8Array>): Promise<{ size: number }>;
  /** Size and last modification of a stored file, or null when it doesn't exist. */
  stat(key: string): Promise<{ size: number; modifiedAt: Date } | null>;
  readStream(key: string, range?: { start: number; end: number }): ReadableStream<Uint8Array>;
  remove(key: string): Promise<void>;
  /** Absolute path for providers that need a local file (ffprobe); null for a bucket. */
  localPath(key: string): string | null;
  /** Every stored object under a prefix (the reconcile job, MEDIA-03). */
  list(prefix?: string): Promise<StoredObject[]>;
  /** A URL a browser (or ffprobe) can read the file from for a while; buckets only. */
  signedGetUrl?(key: string, opts?: { expiresInSeconds?: number; fileName?: string; contentType?: string; download?: boolean }): Promise<string>;
  /** Where a browser can PUT the file directly, so the bytes never pass through this server; buckets only. */
  presignUpload?(key: string, opts: { contentType: string; size: number }): Promise<PresignedUpload>;
  completeUpload?(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abortUpload?(key: string, uploadId: string): Promise<void>;
}

// Runtime-only paths: tell the bundler not to trace them (uploads are not part of the build)
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_DIR ?? "./storage");

function resolveKey(key: string) {
  const full = path.resolve(/*turbopackIgnore: true*/ ROOT, key);
  // Never allow keys to escape the storage root
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export const localStorageProvider: StorageProvider = {
  async save(key, body) {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), createWriteStream(full));
    const s = await stat(full);
    return { size: s.size };
  },
  async stat(key) {
    try {
      const s = await stat(resolveKey(key));
      return { size: s.size, modifiedAt: s.mtime };
    } catch {
      return null;
    }
  },
  readStream(key, range) {
    const node = createReadStream(resolveKey(key), range);
    return Readable.toWeb(node) as ReadableStream<Uint8Array>;
  },
  async remove(key) {
    await rm(resolveKey(key), { force: true });
  },
  localPath(key) {
    return resolveKey(key);
  },
  async list(prefix = "") {
    const base = prefix ? resolveKey(prefix) : ROOT;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(base, { recursive: true, withFileTypes: true });
    } catch {
      return [];
    }
    const out: StoredObject[] = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = path.join(e.parentPath, e.name);
      const s = await stat(full);
      out.push({ key: path.relative(ROOT, full).split(path.sep).join("/"), size: s.size, modifiedAt: s.mtime });
    }
    return out;
  },
};

const s3 = s3Config();
export const storage: StorageProvider = s3 ? s3StorageProvider(s3) : localStorageProvider;
/** True when files live in a bucket (direct uploads and signed URLs are available). */
export const storageIsBucket = s3 !== null;

/** Builds a unique, URL-safe storage key for an uploaded file. */
export function makeStorageKey(fileName: string, folder = "media") {
  const now = new Date();
  const safe = fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-80);
  const id = Math.random().toString(36).slice(2, 10);
  return `${folder}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${id}-${safe}`;
}
