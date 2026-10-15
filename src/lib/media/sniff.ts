import type { MediaTypeCode } from "@/lib/workflow/statuses";

// What an uploaded file really is (SEC-05): decided from its first bytes, not
// from the browser's Content-Type or the file name. The sniffed type is what
// gets stored; the name's extension and the chosen media type must agree with it.

export type MediaKind = "image" | "video" | "audio";

export interface SniffedType {
  mimeType: string;
  kind: MediaKind;
  /** Extensions a file of this type may carry (the first is the usual one) */
  extensions: string[];
}

const T = (mimeType: string, kind: MediaKind, ...extensions: string[]): SniffedType => ({ mimeType, kind, extensions });

const ascii = (b: Uint8Array, at: number, text: string) => b.length >= at + text.length && text.split("").every((ch, i) => b[at + i] === ch.charCodeAt(0));
const bytes = (b: Uint8Array, at: number, ...want: number[]) => b.length >= at + want.length && want.every((v, i) => b[at + i] === v);

/** The brand of an ISO base media file ("ftyp" at offset 4), or null. */
function ftypBrand(b: Uint8Array): string | null {
  if (!ascii(b, 4, "ftyp") || b.length < 12) return null;
  return String.fromCharCode(b[8], b[9], b[10], b[11]).trim().toLowerCase();
}

/** The DocType of an EBML (Matroska / WebM) file, found in its first bytes. */
function ebmlDocType(b: Uint8Array): string | null {
  if (!bytes(b, 0, 0x1a, 0x45, 0xdf, 0xa3)) return null;
  const head = Buffer.from(b.subarray(0, Math.min(b.length, 128))).toString("latin1");
  if (head.includes("webm")) return "webm";
  if (head.includes("matroska")) return "matroska";
  return null;
}

/** The type a file's first bytes announce, or null when they match no supported format. */
export function sniffType(b: Uint8Array): SniffedType | null {
  if (b.length < 12) return null;
  if (bytes(b, 0, 0xff, 0xd8, 0xff)) return T("image/jpeg", "image", "jpg", "jpeg");
  if (bytes(b, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return T("image/png", "image", "png");
  if (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a")) return T("image/gif", "image", "gif");
  if (ascii(b, 0, "RIFF")) {
    if (ascii(b, 8, "WEBP")) return T("image/webp", "image", "webp");
    if (ascii(b, 8, "WAVE")) return T("audio/wav", "audio", "wav");
    if (ascii(b, 8, "AVI ")) return T("video/x-msvideo", "video", "avi");
    return null;
  }
  const brand = ftypBrand(b);
  if (brand !== null) {
    if (brand === "m4a") return T("audio/mp4", "audio", "m4a");
    if (brand === "qt") return T("video/quicktime", "video", "mov");
    if (brand === "avif" || brand === "avis") return T("image/avif", "image", "avif");
    if (brand === "heic" || brand === "heix" || brand === "mif1") return T("image/heic", "image", "heic", "heif");
    // isom, iso2, mp41, mp42, avc1, dash, m4v and the rest of the family
    return T("video/mp4", "video", "mp4", "m4v");
  }
  const doc = ebmlDocType(b);
  if (doc === "webm") return T("video/webm", "video", "webm");
  if (doc === "matroska") return T("video/x-matroska", "video", "mkv");
  if (ascii(b, 0, "ID3") || bytes(b, 0, 0xff, 0xfb) || bytes(b, 0, 0xff, 0xf3) || bytes(b, 0, 0xff, 0xf2)) return T("audio/mpeg", "audio", "mp3");
  if (ascii(b, 0, "OggS")) return T("audio/ogg", "audio", "ogg", "oga");
  if (ascii(b, 0, "fLaC")) return T("audio/flac", "audio", "flac");
  if (bytes(b, 0, 0xff, 0xf1) || bytes(b, 0, 0xff, 0xf9)) return T("audio/aac", "audio", "aac");
  return null;
}

/** Which kinds of file each media type accepts. OTHER accepts nothing: it was a way around every check. */
export const KIND_BY_TYPE: Record<MediaTypeCode, MediaKind | null> = {
  IMAGE: "image",
  THUMBNAIL: "image",
  VIDEO: "video",
  AUDIO: "audio",
  MUSIC: "audio",
  OTHER: null,
};

const MiB = 1024 * 1024;
/** Largest upload per media type; videos use the server's overall limit (MEDIA_MAX_BYTES). */
export function sizeCapFor(type: MediaTypeCode, videoMax: number): number {
  switch (KIND_BY_TYPE[type]) {
    case "image":
      return Math.min(videoMax, 25 * MiB);
    case "audio":
      return Math.min(videoMax, 250 * MiB);
    case "video":
      return videoMax;
    default:
      return 0;
  }
}

export const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
};

export type UploadCheck = { ok: true; mimeType: string; kind: MediaKind } | { ok: false; message: string };

const KIND_LABEL: Record<MediaKind, string> = { image: "an image", video: "a video", audio: "an audio" };

/**
 * Decides whether a file may be stored as `type`: its first bytes must be a
 * supported format of the right kind, and its name's extension must belong to
 * that format (a .mov that is really MP4 is refused, not renamed).
 */
export function checkUpload(type: MediaTypeCode, fileName: string, head: Uint8Array): UploadCheck {
  const kind = KIND_BY_TYPE[type];
  if (!kind) return { ok: false, message: `${fileName}: files of type "${type}" can't be uploaded; choose Image, Video, Thumbnail, Audio or Music.` };
  const sniffed = sniffType(head);
  if (!sniffed) return { ok: false, message: `${fileName}: not a recognised ${kind} file (its first bytes match no supported format).` };
  if (sniffed.kind !== kind) return { ok: false, message: `${fileName}: this is ${KIND_LABEL[sniffed.kind]} file (${sniffed.mimeType}), not ${KIND_LABEL[kind]}.` };
  const ext = extensionOf(fileName);
  if (!ext) return { ok: false, message: `${fileName}: the name needs an extension (${sniffed.extensions.map((e) => `.${e}`).join(", ")}).` };
  if (!sniffed.extensions.includes(ext)) return { ok: false, message: `${fileName}: the name ends in .${ext} but the file is ${sniffed.mimeType} (.${sniffed.extensions[0]}).` };
  return { ok: true, mimeType: sniffed.mimeType, kind };
}
