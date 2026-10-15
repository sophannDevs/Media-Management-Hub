import { execFile } from "node:child_process";
import { logger } from "@/lib/log";

// Measures a stored file with ffprobe (SEC-05): the real duration, dimensions
// and codecs, instead of what the browser reported. ffprobe reads the headers
// only, so this takes well under a second; without ffprobe on the server the
// upload still works and the browser's figures stand (noted in the log once).

export interface ProbeResult {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  /** Video codec, then audio codec, e.g. "h264+aac" */
  codec: string | null;
  container: string | null;
  bitrate: number | null;
}

interface FfprobeJson {
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }[];
  format?: { format_name?: string; duration?: string; bit_rate?: string };
}

let available: boolean | null = null;
const log = logger.child({ component: "ffprobe" });

export const ffprobePath = () => process.env.FFPROBE_PATH?.trim() || "ffprobe";

/** The file's measured details, or null when ffprobe is missing or failed (never throws). */
export async function probeMedia(path: string, timeoutMs = 10_000): Promise<ProbeResult | null> {
  if (available === false) return null;
  const json = await new Promise<FfprobeJson | null>((resolve) => {
    // The program is chosen at run time (FFPROBE_PATH): not something the bundler can trace
    execFile(/*turbopackIgnore: true*/ ffprobePath(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          if (available !== false) log.warn("ffprobe is not installed: uploads keep the browser's duration and size figures (set FFPROBE_PATH or install FFmpeg)");
          available = false;
        } else log.warn("ffprobe failed", { path, err });
        return resolve(null);
      }
      available = true;
      try {
        resolve(JSON.parse(stdout) as FfprobeJson);
      } catch {
        resolve(null);
      }
    });
  });
  if (!json) return null;
  const video = json.streams?.find((s) => s.codec_type === "video");
  const audio = json.streams?.find((s) => s.codec_type === "audio");
  const num = (v: string | number | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    durationSec: num(json.format?.duration) ?? num(video?.duration) ?? num(audio?.duration),
    width: num(video?.width) ? Math.round(Number(video!.width)) : null,
    height: num(video?.height) ? Math.round(Number(video!.height)) : null,
    codec: [video?.codec_name, audio?.codec_name].filter(Boolean).join("+") || null,
    container: json.format?.format_name?.split(",")[0] ?? null,
    bitrate: num(json.format?.bit_rate),
  };
}

/** For tests and the health check: whether the last probe found ffprobe (null before any probe). */
export const ffprobeAvailable = () => available;
