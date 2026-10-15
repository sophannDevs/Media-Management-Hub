/**
 * The srcset for an uploaded image (PERF-08): the file route serves the WebP copy
 * at each width, or the original while the copies don't exist yet. Linked files
 * have no copies.
 */
export function thumbSrcSet(url: string | null | undefined): string | undefined {
  if (!url || !url.startsWith("/api/files/") || url.includes("?")) return undefined;
  return [320, 640, 1280].map((w) => `${url}?v=w${w} ${w}w`).join(", ");
}

/** The URL of one named copy of an uploaded file (a video's poster or preview), or null when the asset has none. */
export function variantUrl(url: string | null | undefined, variants: unknown, name: "poster" | "preview"): string | null {
  if (!url || !url.startsWith("/api/files/") || !variants || typeof variants !== "object") return null;
  return typeof (variants as Record<string, unknown>)[name] === "string" ? `${url}?v=${name}` : null;
}

/** The blurred placeholder stored with an asset's copies, when there is one. */
export function blurOf(variants: unknown): string | null {
  const b = variants && typeof variants === "object" ? (variants as Record<string, unknown>).blur : null;
  return typeof b === "string" && b.startsWith("data:") ? b : null;
}

/** Public URL of a media asset (uploaded files are served by /api/files/...). */
export function mediaUrl(asset: { storageKey: string | null; externalUrl: string | null } | null | undefined) {
  if (!asset) return null;
  // Never render a stored link that isn't http(s) (javascript:, data:, file: …), even an old one
  if (asset.externalUrl) return /^https?:\/\//i.test(asset.externalUrl) ? asset.externalUrl : null;
  if (asset.storageKey) return `/api/files/${asset.storageKey.split("/").map(encodeURIComponent).join("/")}`;
  return null;
}
