import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Local-disk storage provider. The interface is deliberately small so an
// S3 / R2 / GCS provider can replace it in phase 2 without touching callers.
export interface StorageProvider {
  save(key: string, body: ReadableStream<Uint8Array>): Promise<{ size: number }>;
  stat(key: string): Promise<{ size: number } | null>;
  readStream(key: string, range?: { start: number; end: number }): ReadableStream<Uint8Array>;
  remove(key: string): Promise<void>;
  /** Absolute path for providers that need a local file (e.g. platform uploads). */
  localPath(key: string): string | null;
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
      return { size: s.size };
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
};

export const storage: StorageProvider = localStorageProvider;

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
