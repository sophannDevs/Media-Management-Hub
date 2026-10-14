/** Public URL of a media asset (uploaded files are served by /api/files/...). */
export function mediaUrl(asset: { storageKey: string | null; externalUrl: string | null } | null | undefined) {
  if (!asset) return null;
  // Never render a stored link that isn't http(s) (javascript:, data:, file: …), even an old one
  if (asset.externalUrl) return /^https?:\/\//i.test(asset.externalUrl) ? asset.externalUrl : null;
  if (asset.storageKey) return `/api/files/${asset.storageKey.split("/").map(encodeURIComponent).join("/")}`;
  return null;
}
