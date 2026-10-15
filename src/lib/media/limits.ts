// Upload limits and the cheap checks shared by the proxied upload route and
// the direct-to-bucket routes (MEDIA-01).

/**
 * Largest single file: 2 GiB minus one byte, because MediaAsset.size is a
 * 32-bit integer (exactly 2 GiB overflowed it and failed after the whole file
 * had been received). MEDIA_MAX_BYTES can lower it. Beyond this needs a BigInt
 * column.
 */
export const MAX_FILE_BYTES = 2 ** 31 - 1;
export const maxBytes = () => Math.min(Number(process.env.MEDIA_MAX_BYTES) || MAX_FILE_BYTES, MAX_FILE_BYTES);

/** What the browser may declare for each media type; the stored type comes from the bytes (SEC-05). */
export const ALLOWED_DECLARED: Record<string, RegExp> = {
  IMAGE: /^image\//,
  THUMBNAIL: /^image\//,
  VIDEO: /^video\//,
  AUDIO: /^audio\//,
  MUSIC: /^audio\//,
  OTHER: /.*/,
};

export const gigabytes = (n: number) => (n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

/** A file name safe to store and show: no control characters or path separators, at most 255 characters. */
export const sanitizeFileName = (name: string) => name.replace(/[\u0000-\u001f\\/]+/g, "-").trim().slice(0, 255);

/** The shape makeStorageKey produces; a client-supplied key that doesn't fit is refused. */
export const STORAGE_KEY_SHAPE = /^media\/\d{4}\/\d{2}\/[\w.-]+$/;
