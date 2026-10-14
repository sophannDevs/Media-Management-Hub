// Validators and ranges for serving files (PERF-06): ETag / Last-Modified
// conditional requests and HTTP Range (RFC 9110), as pure functions so they
// can be tested without a server.

/** A strong ETag for a stored file. Storage keys are unique per upload and never rewritten, so size + modification time identify the bytes. */
export const fileEtag = (size: number, modifiedAt: Date) => `"${size.toString(16)}-${Math.floor(modifiedAt.getTime()).toString(16)}"`;

/** HTTP dates have second precision. */
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

/** "W/" marks a weak validator; for If-None-Match the weak comparison applies. */
const opaque = (tag: string) => tag.trim().replace(/^W\//, "");

/**
 * Whether a conditional GET can be answered with 304: If-None-Match (any tag
 * matches, or `*`), else If-Modified-Since (the file is no newer). If-None-Match
 * wins when both are sent.
 */
export function isNotModified(headers: Headers, etag: string, modifiedAt: Date): boolean {
  const none = headers.get("if-none-match");
  if (none !== null) {
    const wanted = none.split(",").map(opaque);
    return wanted.includes("*") || wanted.includes(opaque(etag));
  }
  const since = headers.get("if-modified-since");
  const at = since ? Date.parse(since) : NaN;
  return !Number.isNaN(at) && seconds(modifiedAt) <= Math.floor(at / 1000);
}

/**
 * Whether a Range header may be honoured. `If-Range` says "only if the file is
 * still the one I have": a strong ETag must match exactly, or a date must equal
 * Last-Modified; otherwise the whole file is sent.
 */
export function rangeApplies(ifRange: string | null, etag: string, modifiedAt: Date): boolean {
  if (ifRange === null) return true;
  const v = ifRange.trim();
  if (v.startsWith('"')) return v === etag;
  const at = Date.parse(v);
  return !Number.isNaN(at) && Math.floor(at / 1000) === seconds(modifiedAt);
}

export type ByteRange = { start: number; end: number };

/**
 * One range of `size` bytes from a Range header:
 *   `bytes=0-99`  the first 100 bytes        `bytes=100-`  from byte 100 to the end
 *   `bytes=-20`   the LAST 20 bytes (suffix) `bytes=0-9999` clamped to the end
 * Returns the range, "unsatisfiable" (answer 416), or null to ignore the header
 * and send everything (missing, not `bytes`, malformed, or several ranges, which
 * this server doesn't serve).
 */
export function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  const m = header ? /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header) : null;
  if (!m) return null;
  const [, first, last] = m;
  if (first === "" && last === "") return null;

  if (first === "") {
    // Suffix: the last N bytes (all of them when N exceeds the size)
    const n = Number(last);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(first);
  if (last !== "" && Number(last) < start) return null; // "bytes=5-2" is malformed
  if (start >= size) return "unsatisfiable";
  return { start, end: last === "" ? size - 1 : Math.min(Number(last), size - 1) };
}
