import type { Prisma } from "@prisma/client";
import { io } from "next/cache";
import { cache } from "react";
import { db } from "@/lib/db";
import { fmt, fmtDateTime, formatBytes } from "@/lib/dates";
import { mediaUrl } from "@/lib/media-url";
import { MediaType, type MediaTypeCode } from "@/lib/workflow/statuses";
import { getPageContext } from "./shared";

export const MEDIA_PAGE_SIZE = 48;

/** Media Library filters, parsed from the URL (`/media?type=IMAGE&q=…&page=2`). */
export interface MediaFilters {
  type: MediaTypeCode | null;
  q: string;
  /** Content id, or "none" for files that don't belong to any content. */
  content: string | null;
  usage: "used" | "unused" | null;
  days: 7 | 30 | null;
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseMediaFilters(sp: SearchParams): MediaFilters {
  const type = first(sp.type);
  const usage = first(sp.usage);
  const days = Number(first(sp.days));
  const page = Number.parseInt(first(sp.page) ?? "", 10);
  return {
    type: MediaType.is(type) ? type : null,
    q: (first(sp.q) ?? "").trim().slice(0, 120),
    content: first(sp.content)?.trim().slice(0, 64) || null,
    usage: usage === "used" || usage === "unused" ? usage : null,
    days: days === 7 || days === 30 ? days : null,
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

// "In use" means removing the file changes something in a content workflow:
// IMAGE → selected for the video (or picked as a thumbnail) · VIDEO → a content's final video ·
// THUMBNAIL → a content's thumbnail or a scheduled post's thumbnail · AUDIO/MUSIC/OTHER → attached to content.
const IN_USE: Prisma.MediaAssetWhereInput = {
  OR: [
    { type: "IMAGE", OR: [{ isSelected: true }, { thumbnailFor: { isNot: null } }, { scheduleThumbs: { some: {} } }] },
    { type: "VIDEO", videoFor: { isNot: null } },
    { type: "THUMBNAIL", OR: [{ thumbnailFor: { isNot: null } }, { scheduleThumbs: { some: {} } }] },
    { type: { in: ["AUDIO", "MUSIC", "OTHER"] }, contentId: { not: null } },
  ],
};
// Spelled out (instead of NOT IN_USE) so nullable relations never fall through.
const UNUSED: Prisma.MediaAssetWhereInput = {
  OR: [
    { type: "IMAGE", isSelected: false, thumbnailFor: { is: null }, scheduleThumbs: { none: {} } },
    { type: "VIDEO", videoFor: { is: null } },
    { type: "THUMBNAIL", thumbnailFor: { is: null }, scheduleThumbs: { none: {} } },
    { type: { in: ["AUDIO", "MUSIC", "OTHER"] }, contentId: null },
  ],
};

/** Every filter except the media type (the type cards show counts per type for these). */
function facetWhere(f: MediaFilters, now: Date): Prisma.MediaAssetWhereInput {
  const and: Prisma.MediaAssetWhereInput[] = [];
  if (f.q) and.push({ fileName: { contains: f.q, mode: "insensitive" } });
  if (f.content === "none") and.push({ contentId: null });
  else if (f.content) and.push({ contentId: f.content });
  if (f.usage === "used") and.push(IN_USE);
  if (f.usage === "unused") and.push(UNUSED);
  if (f.days) and.push({ createdAt: { gte: new Date(now.getTime() - f.days * 86_400_000) } });
  return and.length ? { AND: and } : {};
}

const assetSelect = {
  id: true,
  type: true,
  fileName: true,
  storageKey: true,
  externalUrl: true,
  mimeType: true,
  size: true,
  width: true,
  height: true,
  durationSec: true,
  isSelected: true,
  createdAt: true,
  content: {
    select: {
      id: true,
      title: true,
      archivedAt: true,
      // Poster for video cards: the content's thumbnail, else its first selected image
      thumbnailAsset: { select: { storageKey: true, externalUrl: true } },
      // createdAt is selected because it orders the list: Prisma panics on unselected order fields in chunked loads (PERF-02)
      media: { where: { type: "IMAGE", isSelected: true }, orderBy: { createdAt: "asc" }, take: 1, select: { storageKey: true, externalUrl: true, createdAt: true } },
    },
  },
  videoFor: { select: { id: true, title: true } },
  thumbnailFor: { select: { id: true, title: true } },
  _count: { select: { scheduleThumbs: true } },
} satisfies Prisma.MediaAssetSelect;

type AssetRow = Prisma.MediaAssetGetPayload<{ select: typeof assetSelect }>;

const quote = (title: string) => `“${title}”`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Why a file is (not) in use, and what deleting / moving it would affect. */
function describeUsage(a: AssetRow) {
  const posts = a._count.scheduleThumbs;
  const owner = a.content ? quote(a.content.title) : null;
  const labels: string[] = [];
  const deleteEffects: string[] = [];
  const moveEffects: string[] = [];

  if (a.type === "VIDEO" && a.videoFor) {
    const t = quote(a.videoFor.title);
    labels.push(`Final video of ${t}`);
    deleteEffects.push(`This is the final video of ${t}. Deleting it marks the video step incomplete.`);
    moveEffects.push(`This is the final video of ${t}. Replace it in that content's Video tab before moving it.`);
  }
  if ((a.type === "THUMBNAIL" || a.type === "IMAGE") && a.thumbnailFor) {
    const t = quote(a.thumbnailFor.title);
    labels.push(`Thumbnail of ${t}`);
    deleteEffects.push(`This is the thumbnail of ${t}. Deleting it removes the thumbnail from that content.`);
    moveEffects.push(`This is the thumbnail of ${t}. Pick another thumbnail for it before moving this one.`);
  }
  if (a.type === "IMAGE" && a.isSelected) {
    labels.push(owner ? `Selected for the video of ${owner}` : "Selected for a video");
    deleteEffects.push(`This image is selected for the video${owner ? ` of ${owner}` : ""}. Deleting it removes it from the selection.`);
    if (owner) moveEffects.push(`This image is selected for the video of ${owner}. Moving it removes it from that selection.`);
  }
  if ((a.type === "THUMBNAIL" || a.type === "IMAGE") && posts > 0) {
    labels.push(`Thumbnail of ${plural(posts, "scheduled post")}`);
    deleteEffects.push(`${plural(posts, "scheduled post")} use${posts === 1 ? "s" : ""} it as the post thumbnail and will fall back to the content's thumbnail.`);
  }
  if (["AUDIO", "MUSIC", "OTHER"].includes(a.type) && owner) {
    labels.push(`Attached to ${owner}`);
    deleteEffects.push(`This file is attached to ${owner}. Deleting it removes it from that content.`);
  }

  const inUse = deleteEffects.length > 0;
  return {
    inUse,
    usageLabel: inUse ? labels.join(" · ") : owner ? `Not used by ${owner}` : "Not linked to any content",
    /** What deleting changes — shown emphasized in the confirmation when the file is in use. */
    deleteWarning: inUse ? deleteEffects.join(" ") : owner ? `This file belongs to ${owner} but isn't used.` : "This file isn't used anywhere.",
    deleteNote: a.storageKey ? "The file is permanently removed from storage." : a.externalUrl ? "The external file itself isn't affected." : "",
    moveWarning: moveEffects.length ? moveEffects.join(" ") : null,
  };
}

function contentHref(contentId: string, type: string) {
  if (type === "IMAGE") return `/content/${contentId}?tab=images`;
  if (type === "VIDEO" || type === "THUMBNAIL") return `/content/${contentId}?tab=video`;
  return `/content/${contentId}`;
}

function toItem(a: AssetRow, now: Date, tz: string) {
  const url = mediaUrl(a);
  const sameYear = fmt(a.createdAt, tz, "yyyy") === fmt(now, tz, "yyyy");
  return {
    id: a.id,
    type: a.type,
    typeLabel: MediaType.label(a.type),
    fileName: a.fileName,
    /** null for demo assets that only have metadata */
    url,
    /** Uploaded files download through the files route; external links open in a new tab. */
    downloadUrl: a.externalUrl ?? (url ? `${url}?download=1` : null),
    external: !!a.externalUrl,
    posterUrl: a.type === "VIDEO" && a.content ? mediaUrl(a.content.thumbnailAsset ?? a.content.media[0]) : null,
    mimeType: a.mimeType,
    size: a.size ? formatBytes(a.size) : a.externalUrl ? "Linked" : "—",
    dimensions: a.width && a.height ? `${a.width}×${a.height}` : null,
    durationSec: a.durationSec,
    date: fmt(a.createdAt, tz, sameYear ? "MMM d" : "MMM d, yyyy"),
    createdAt: fmtDateTime(a.createdAt, tz),
    content: a.content
      ? { id: a.content.id, title: a.content.title, href: contentHref(a.content.id, a.type), archived: !!a.content.archivedAt }
      : null,
    ...describeUsage(a),
  };
}
export type MediaItem = ReturnType<typeof toItem>;

/** Non-archived content for the filter / upload / move pickers (one query per request). */
/**
 * The content a media filter points at, for the pickers to show (they search
 * the rest on demand, PERF-11). Archived content is named as such.
 */
export const getFilteredContent = cache(async (contentId: string | null) => {
  if (!contentId || contentId === "none") return null;
  await io();
  const c = await db.content.findUnique({ where: { id: contentId }, select: { id: true, title: true, archivedAt: true } });
  return { id: contentId, title: c ? `${c.title}${c.archivedAt ? " (archived)" : ""}` : "Unknown content", archived: !c || !!c.archivedAt };
});
export type MediaContentOption = { id: string; title: string };

export async function getMediaLibrary(filters: MediaFilters) {
  const { now, tz } = await getPageContext();
  const facet = facetWhere(filters, now);
  const where: Prisma.MediaAssetWhereInput = filters.type ? { AND: [facet, { type: filters.type }] } : facet;

  const [groups, filteredContent] = await Promise.all([
    db.mediaAsset.groupBy({ by: ["type"], where: facet, _count: { _all: true } }),
    getFilteredContent(filters.content),
  ]);

  const counts = Object.fromEntries(MediaType.codes.map((c) => [c, 0])) as Record<MediaTypeCode, number>;
  for (const g of groups) if (MediaType.is(g.type)) counts[g.type] = g._count._all;
  const all = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const total = filters.type ? counts[filters.type] : all;
  const pageCount = Math.max(1, Math.ceil(total / MEDIA_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);

  const rows = total
    ? await db.mediaAsset.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * MEDIA_PAGE_SIZE,
        take: MEDIA_PAGE_SIZE,
        select: assetSelect,
      })
    : [];

  return {
    filters: { ...filters, page },
    counts,
    all,
    total,
    page,
    pageCount,
    pageSize: MEDIA_PAGE_SIZE,
    items: rows.map((r) => toItem(r, now, tz)),
    /** What the content filter points at (the picker searches the rest) */
    filteredContent,
    hasFilters: Boolean(filters.q || filters.content || filters.usage || filters.days),
  };
}
export type MediaLibraryData = Awaited<ReturnType<typeof getMediaLibrary>>;
