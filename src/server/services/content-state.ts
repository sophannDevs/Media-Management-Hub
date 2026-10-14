import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ContentState } from "@/lib/workflow/rules";

/** Prisma select that loads everything the workflow rules need. */
export const contentStateSelect = {
  scriptStatus: true,
  imageStatus: true,
  videoStatus: true,
  reviewStatus: true,
  publishingStatus: true,
  hashtags: true,
  titleFinalized: true,
  descriptionFinalized: true,
  videoAssetId: true,
  thumbnailAssetId: true,
  script: { select: { body: true } },
  imagePrompt: { select: { prompt: true } },
  schedules: { select: { status: true } },
  media: { where: { type: "IMAGE" }, select: { id: true, isSelected: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.ContentSelect;

export type ContentStateRow = Prisma.ContentGetPayload<{ select: typeof contentStateSelect }>;

/** The image lists show for the content (Content.coverAssetId): the thumbnail, else the first selected image, else the first image. */
export function coverAssetId(c: ContentStateRow) {
  return c.thumbnailAssetId ?? c.media.find((m) => m.isSelected)?.id ?? c.media[0]?.id ?? null;
}

export function toContentState(c: ContentStateRow): ContentState {
  return {
    scriptStatus: c.scriptStatus,
    imageStatus: c.imageStatus,
    videoStatus: c.videoStatus,
    reviewStatus: c.reviewStatus,
    publishingStatus: c.publishingStatus,
    hashtags: c.hashtags,
    titleFinalized: c.titleFinalized,
    descriptionFinalized: c.descriptionFinalized,
    hasScriptText: !!c.script?.body.trim(),
    hasImagePrompt: !!c.imagePrompt?.prompt.trim(),
    imageCount: c.media.length,
    selectedImageCount: c.media.filter((m) => m.isSelected).length,
    hasVideo: !!c.videoAssetId,
    hasThumbnail: !!c.thumbnailAssetId,
    schedules: c.schedules,
  };
}

export async function loadContentState(contentId: string) {
  const row = await db.content.findUnique({ where: { id: contentId }, select: contentStateSelect });
  return row ? toContentState(row) : null;
}
