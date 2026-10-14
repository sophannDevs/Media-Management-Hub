/** Public URL of a media asset (uploaded files are served by /api/files/...). */
export function mediaUrl(asset: { storageKey: string | null; externalUrl: string | null } | null | undefined) {
  if (!asset) return null;
  if (asset.externalUrl) return asset.externalUrl;
  if (asset.storageKey) return `/api/files/${asset.storageKey.split("/").map(encodeURIComponent).join("/")}`;
  return null;
}
