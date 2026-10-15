import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { logger } from "@/lib/log";

// Smaller copies of uploaded media (PERF-08): WebP images at the widths the
// pages show, a blurred placeholder, and for videos a poster frame and a
// short silent preview. The originals are never served to a list again.

export const IMAGE_WIDTHS = [320, 640, 1280] as const;
export type VariantName = "w320" | "w640" | "w1280" | "poster" | "preview";

/** Where a variant lives: next to the original, named after it. */
export const variantKey = (storageKey: string, name: VariantName) => `${storageKey}.${name}.${name === "preview" ? "mp4" : "webp"}`;

export const variantMime = (name: string) => (name === "preview" ? "video/mp4" : "image/webp");

export interface ImageVariants {
  variants: { name: VariantName; bytes: Buffer }[];
  /** A 16-pixel-wide WebP as a data URI: shown while the real image loads */
  blur: string;
  width: number;
  height: number;
}

/**
 * WebP copies at each listed width up to the original's (never enlarged), plus
 * the blur placeholder. A copy no smaller than the original (a tiny PNG, an SVG
 * of a few hundred bytes) is not kept: the original is served in its place.
 */
export async function imageVariants(source: Buffer): Promise<ImageVariants> {
  const base = sharp(source, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const variants: ImageVariants["variants"] = [];
  for (const w of IMAGE_WIDTHS) {
    const bytes = await base.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    if (bytes.length >= source.length) break; // no gain at this width, nor at a larger one
    variants.push({ name: `w${w}` as VariantName, bytes });
    if (width && w >= width) break; // the original is no wider than this: the larger sizes would be the same picture
  }
  const blurBytes = await base.clone().resize({ width: 16, withoutEnlargement: true }).webp({ quality: 40 }).toBuffer();
  return { variants, blur: `data:image/webp;base64,${blurBytes.toString("base64")}`, width, height };
}

// ---------- video: ffmpeg, optional ----------

let ffmpegAvailableFlag: boolean | null = null;
const log = logger.child({ component: "ffmpeg" });
export const ffmpegPath = () => process.env.FFMPEG_PATH?.trim() || "ffmpeg";
/** Whether the last run found ffmpeg (null before any run). */
export const ffmpegAvailable = () => ffmpegAvailableFlag;

function ffmpeg(args: string[], timeoutMs: number): Promise<boolean> {
  if (ffmpegAvailableFlag === false) return Promise.resolve(false);
  return new Promise((resolve) => {
    // The program is chosen at run time (FFMPEG_PATH): not something the bundler can trace
    execFile(/*turbopackIgnore: true*/ ffmpegPath(), ["-v", "error", "-y", ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          if (ffmpegAvailableFlag !== false) log.warn("ffmpeg is not installed: videos get no poster or preview (set FFMPEG_PATH or install FFmpeg)");
          ffmpegAvailableFlag = false;
        } else log.warn("ffmpeg failed", { args: args.slice(0, 6), err });
        return resolve(false);
      }
      ffmpegAvailableFlag = true;
      resolve(true);
    });
  });
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "mediaflow-derive-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** One frame about a second in (the first frame when the video is shorter), as JPEG; null without ffmpeg. */
export async function videoPoster(input: string): Promise<Buffer | null> {
  return withTemp(async (dir) => {
    const out = path.join(dir, "poster.jpg");
    for (const at of ["1", "0"]) {
      if (!(await ffmpeg(["-ss", at, "-i", input, "-frames:v", "1", "-q:v", "3", out], 60_000))) continue;
      try {
        const bytes = await readFile(out);
        if (bytes.length) return bytes;
      } catch {
        // no frame at that time: try the start
      }
    }
    return null;
  });
}

/** The first three seconds, silent, 320 pixels wide, as a small MP4 for hover previews; null without ffmpeg. */
export async function videoPreview(input: string): Promise<Buffer | null> {
  return withTemp(async (dir) => {
    const out = path.join(dir, "preview.mp4");
    const ok = await ffmpeg(["-ss", "0", "-t", "3", "-i", input, "-an", "-vf", "scale=320:-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], 120_000);
    if (!ok) return null;
    try {
      const bytes = await readFile(out);
      return bytes.length ? bytes : null;
    } catch {
      return null;
    }
  });
}
