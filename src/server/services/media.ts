import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ActivityType, MediaType } from "@/lib/workflow/statuses";
import { ServiceError } from "../errors";
import { variantKeysOf } from "./derivatives";
import { logActivity } from "./activity";
import { syncPublishingStatus } from "./content";

export interface NewMediaInput {
  contentId?: string | null;
  type: string;
  fileName: string;
  storageKey?: string | null;
  externalUrl?: string | null;
  mimeType?: string;
  size?: number;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  /** SEC-05: what the server measured */
  sha256?: string | null;
  codec?: string | null;
  container?: string | null;
  probedAt?: Date | null;
}

/** Registers a stored/linked file and applies its side effects on the content workflow. */
export async function createMediaAsset(input: NewMediaInput) {
  if (!MediaType.is(input.type)) throw new ServiceError("Unknown media type.");
  const content = input.contentId
    ? await db.content.findUnique({ where: { id: input.contentId }, select: { id: true, imageStatus: true, videoStatus: true, thumbnailAssetId: true } })
    : null;
  if (input.contentId && !content) throw new ServiceError("Content not found.");

  const asset = await db.mediaAsset.create({
    data: {
      contentId: content?.id ?? null,
      type: input.type,
      fileName: input.fileName,
      storageKey: input.storageKey ?? null,
      externalUrl: input.externalUrl ?? null,
      mimeType: input.mimeType ?? "application/octet-stream",
      size: input.size ?? 0,
      width: input.width ?? null,
      height: input.height ?? null,
      durationSec: input.durationSec ?? null,
      sha256: input.sha256 ?? null,
      codec: input.codec ?? null,
      container: input.container ?? null,
      probedAt: input.probedAt ?? null,
    },
  });

  if (content) {
    if (input.type === "IMAGE" && ["NOT_STARTED", "GENERATING"].includes(content.imageStatus)) {
      await db.content.update({ where: { id: content.id }, data: { imageStatus: "GENERATED" } });
    }
    if (input.type === "VIDEO") {
      await db.content.update({
        where: { id: content.id },
        data: {
          videoAssetId: asset.id,
          // A replaced video needs to be marked Final again
          videoStatus: content.videoStatus === "NEEDS_REVISION" ? "NEEDS_REVISION" : "GENERATED",
        },
      });
    }
    if (input.type === "THUMBNAIL" && !content.thumbnailAssetId) {
      await db.content.update({ where: { id: content.id }, data: { thumbnailAssetId: asset.id } });
    }
    await logActivity({
      contentId: content.id,
      type: input.type === "VIDEO" ? ActivityType.VIDEO_UPLOADED : ActivityType.MEDIA_UPLOADED,
      message: `${MediaType.label(input.type)} ${input.externalUrl ? "linked" : "uploaded"}: ${input.fileName}`,
    });
    await syncPublishingStatus(content.id);
  }
  return asset;
}

export async function deleteMediaAsset(id: string) {
  const asset = await db.mediaAsset.findUnique({ where: { id }, include: { videoFor: { select: { id: true } }, thumbnailFor: { select: { id: true } } } });
  if (!asset) throw new ServiceError("File not found.");

  if (asset.videoFor) await db.content.update({ where: { id: asset.videoFor.id }, data: { videoAssetId: null, videoStatus: "NOT_STARTED" } });
  if (asset.thumbnailFor) await db.content.update({ where: { id: asset.thumbnailFor.id }, data: { thumbnailAssetId: null } });
  await db.mediaAsset.delete({ where: { id } });
  if (asset.storageKey) await storage.remove(asset.storageKey);
  // Its smaller copies go with it (PERF-08)
  for (const k of variantKeysOf(asset.variants)) await storage.remove(k).catch(() => {});

  if (asset.contentId) {
    if (asset.type === "IMAGE") {
      const remaining = await db.mediaAsset.count({ where: { contentId: asset.contentId, type: "IMAGE" } });
      if (remaining === 0) await db.content.update({ where: { id: asset.contentId }, data: { imageStatus: "NOT_STARTED" } });
    }
    await logActivity({ contentId: asset.contentId, type: ActivityType.MEDIA_DELETED, message: `${MediaType.label(asset.type)} deleted: ${asset.fileName}` });
    await syncPublishingStatus(asset.contentId);
  }
}

export async function setImageSelected(id: string, selected: boolean) {
  const asset = await db.mediaAsset.update({ where: { id }, data: { isSelected: selected } });
  if (asset.contentId) {
    // Changing the selection of approved images sends them back for approval
    const c = await db.content.findUnique({ where: { id: asset.contentId }, select: { imageStatus: true } });
    if (c?.imageStatus === "APPROVED") await db.content.update({ where: { id: asset.contentId }, data: { imageStatus: "GENERATED" } });
    await syncPublishingStatus(asset.contentId);
  }
}

export async function setContentThumbnail(contentId: string, assetId: string | null) {
  if (assetId) {
    const a = await db.mediaAsset.findUnique({ where: { id: assetId }, select: { type: true, contentId: true } });
    // Any thumbnail or generated image of this content can be the thumbnail
    if (!a || !["THUMBNAIL", "IMAGE"].includes(a.type) || a.contentId !== contentId) {
      throw new ServiceError("Pick a thumbnail or image of this content.");
    }
  }
  await db.content.update({ where: { id: contentId }, data: { thumbnailAssetId: assetId } });
  await logActivity({ contentId, type: ActivityType.CONTENT_UPDATED, message: assetId ? "Thumbnail selected" : "Thumbnail removed" });
  await syncPublishingStatus(contentId);
}

export async function setFinalVideo(contentId: string, assetId: string) {
  const a = await db.mediaAsset.findUnique({ where: { id: assetId }, select: { type: true, contentId: true } });
  if (!a || a.type !== "VIDEO" || a.contentId !== contentId) throw new ServiceError("Pick a video of this content.");
  await db.content.update({ where: { id: contentId }, data: { videoAssetId: assetId, videoStatus: "GENERATED" } });
  await logActivity({ contentId, type: ActivityType.VIDEO_UPLOADED, message: "Final video replaced" });
  await syncPublishingStatus(contentId);
}

/**
 * Moves a file to another content item (or unassigns it). The file is detached
 * from every role it played on the old content (final video, thumbnail,
 * selected image) so neither item points at a file it no longer owns.
 */
export async function assignMediaToContent(id: string, contentId: string | null) {
  const asset = await db.mediaAsset.findUnique({
    where: { id },
    include: { videoFor: { select: { id: true } }, thumbnailFor: { select: { id: true } } },
  });
  if (!asset) throw new ServiceError("File not found.");
  if (asset.contentId === contentId) return;
  const target = contentId ? await db.content.findUnique({ where: { id: contentId }, select: { id: true, title: true, imageStatus: true } }) : null;
  if (contentId && !target) throw new ServiceError("Content not found.");
  const source = asset.contentId ? await db.content.findUnique({ where: { id: asset.contentId }, select: { id: true, title: true } }) : null;

  await db.$transaction(async (tx) => {
    if (asset.videoFor) await tx.content.update({ where: { id: asset.videoFor.id }, data: { videoAssetId: null, videoStatus: "NOT_STARTED" } });
    if (asset.thumbnailFor) await tx.content.update({ where: { id: asset.thumbnailFor.id }, data: { thumbnailAssetId: null } });
    // Schedules of the old content must not keep using it as their thumbnail
    if (asset.contentId) {
      await tx.publishingSchedule.updateMany({ where: { thumbnailAssetId: id, contentId: asset.contentId }, data: { thumbnailAssetId: null } });
    }
    await tx.mediaAsset.update({ where: { id }, data: { contentId, isSelected: false } });

    if (asset.type === "IMAGE" && source) {
      const remaining = await tx.mediaAsset.count({ where: { contentId: source.id, type: "IMAGE" } });
      if (remaining === 0) await tx.content.update({ where: { id: source.id }, data: { imageStatus: "NOT_STARTED" } });
    }
    if (target && asset.type === "IMAGE" && target.imageStatus === "NOT_STARTED") {
      await tx.content.update({ where: { id: target.id }, data: { imageStatus: "GENERATED" } });
    }
  });

  const label = `${MediaType.label(asset.type)} "${asset.fileName}"`;
  if (source) {
    await logActivity({ contentId: source.id, type: ActivityType.MEDIA_DELETED, message: `${label} moved ${target ? `to "${target.title}"` : "out (unassigned)"}` });
    await syncPublishingStatus(source.id);
  }
  if (target) {
    await logActivity({ contentId: target.id, type: ActivityType.MEDIA_UPLOADED, message: `${label} moved in${source ? ` from "${source.title}"` : ""}` });
    await syncPublishingStatus(target.id);
  }
}

// ---------- Several files at once, and the same file twice (MEDIA-02) ----------

/** Deletes several files; each one's workflow side effects apply as for a single delete. Files already gone are skipped. */
export async function deleteMediaAssets(ids: string[]) {
  let removed = 0;
  for (const id of ids) {
    try {
      await deleteMediaAsset(id);
      removed++;
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e;
    }
  }
  return { removed };
}

/** Moves several files to a content item (or unassigns them), one by one, with the same care as a single move. */
export async function assignMediaToContents(ids: string[], contentId: string | null) {
  let moved = 0;
  for (const id of ids) {
    try {
      await assignMediaToContent(id, contentId);
      moved++;
    } catch (e) {
      if (!(e instanceof ServiceError) || e.message !== "File not found.") throw e;
    }
  }
  return { moved };
}

/** A ServiceError (code CONFLICT) saying which stored file the upload duplicates; `info` carries the ids for the browser. */
export function duplicateRefusal(fileName: string, dup: NonNullable<Awaited<ReturnType<typeof findDuplicate>>>) {
  const where = dup.content ? ` (in “${dup.content.title}”)` : "";
  return new ServiceError(`${fileName}: already uploaded as ${dup.fileName}${where}.`, undefined, "CONFLICT", {
    duplicateId: dup.id,
    duplicateName: dup.fileName,
    ...(dup.content ? { duplicateContentId: dup.content.id, duplicateContentTitle: dup.content.title } : {}),
  });
}

/** The stored file with exactly these bytes, when the library already has one: the asset and the content it belongs to. */
export async function findDuplicate(sha256: string, excludeId?: string) {
  const a = await db.mediaAsset.findFirst({
    where: { sha256, storageKey: { not: null }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, type: true, createdAt: true, content: { select: { id: true, title: true } } },
  });
  return a;
}
