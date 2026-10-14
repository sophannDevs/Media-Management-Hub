import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { deriveContentState, isReadyToPost, missingRequirements, normalizeHashtags, parseTags } from "@/lib/workflow/rules";
import { ActivityType, ImageStatus, NotificationType, ReviewStatus, ScriptStatus, VideoStatus } from "@/lib/workflow/statuses";
import { ServiceError } from "../errors";
import { logActivity } from "./activity";
import { contentStateSelect, coverAssetId, toContentState } from "./content-state";
import { notify } from "./notifications";
import { getRules } from "./settings";

export const STATUS_FIELDS = {
  scriptStatus: { def: ScriptStatus, label: "Script" },
  imageStatus: { def: ImageStatus, label: "Images" },
  videoStatus: { def: VideoStatus, label: "Video" },
  reviewStatus: { def: ReviewStatus, label: "Review" },
} as const;
export type StatusField = keyof typeof STATUS_FIELDS;

/**
 * Recomputes what is derived from the production statuses, assets and
 * schedules (publishing status, stage, missing requirements, completion, cover
 * image) and stores it on the content. Call after anything that can change them.
 */
export async function syncPublishingStatus(contentId: string) {
  const row = await db.content.findUnique({
    where: { id: contentId },
    select: { ...contentStateSelect, title: true, stage: true, missingMask: true, completion: true, coverAssetId: true },
  });
  if (!row) return null;
  const next = deriveContentState(toContentState(row), await getRules());
  const cover = coverAssetId(row);
  const unchanged =
    next.publishingStatus === row.publishingStatus &&
    next.stage === row.stage &&
    next.missingMask === row.missingMask &&
    next.completion === row.completion &&
    cover === row.coverAssetId;
  if (!unchanged) {
    // Raw SQL leaves updatedAt alone: refreshing derived values is not an edit
    // (a rule change in Settings must not make every item "recently updated").
    await db.$executeRaw`
      UPDATE "Content" SET "publishingStatus" = ${next.publishingStatus}, "stage" = ${next.stage},
        "missingMask" = ${next.missingMask}, "completion" = ${next.completion}, "coverAssetId" = ${cover}
      WHERE "id" = ${contentId}`;
  }
  if (next.publishingStatus === "READY" && ["DRAFT", "NOT_READY"].includes(row.publishingStatus)) {
    await logActivity({ contentId, type: ActivityType.STATUS_CHANGED, message: "All checks passed — Ready to Post" });
    await notify({
      type: NotificationType.READY_FOR_SCHEDULING,
      title: "Ready for scheduling",
      message: `"${row.title}" passed all checks and can be scheduled.`,
      href: `/content/${contentId}?tab=publishing`,
      dedupeKey: `ready:${contentId}:${new Date().toISOString().slice(0, 13)}`,
    });
  }
  return next.publishingStatus;
}

export async function syncAllPublishingStatuses() {
  const ids = await db.content.findMany({ select: { id: true } });
  for (const { id } of ids) await syncPublishingStatus(id);
}

export interface ContentInput {
  title: string;
  idea?: string;
  description?: string;
  contentType?: string;
  categoryId?: string | null;
  tags?: string;
  targetAudience?: string;
  language?: string;
  platforms?: string[];
  priority?: string;
  targetPublishDate?: Date | null;
  seriesId?: string | null;
  campaignId?: string | null;
  hashtags?: string;
}

function tagWrites(tags: string) {
  return parseTags(tags).map((name) => ({ where: { name }, create: { name } }));
}

export async function createContent(input: ContentInput) {
  const platforms = await db.platform.findMany({
    where: { id: { in: input.platforms ?? [] }, enabled: true },
    select: { id: true },
  });
  const content = await db.content.create({
    data: {
      title: input.title.trim(),
      idea: input.idea ?? "",
      description: input.description ?? "",
      contentType: input.contentType ?? "LONG_FORM",
      categoryId: input.categoryId || null,
      targetAudience: input.targetAudience ?? "",
      language: input.language ?? "English",
      priority: input.priority ?? "MEDIUM",
      targetPublishDate: input.targetPublishDate ?? null,
      seriesId: input.seriesId || null,
      campaignId: input.campaignId || null,
      hashtags: input.hashtags ? normalizeHashtags(input.hashtags) : "",
      tags: input.tags ? { connectOrCreate: tagWrites(input.tags) } : undefined,
      platforms: { create: platforms.map((p) => ({ platformId: p.id })) },
      script: { create: {} },
    },
  });
  await logActivity({ contentId: content.id, type: ActivityType.CONTENT_CREATED, message: "Content created" });
  await syncPublishingStatus(content.id);
  return content;
}

export async function updateContent(id: string, input: Partial<ContentInput>) {
  const existing = await db.content.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ServiceError("Content not found.");

  const data: Prisma.ContentUpdateInput = {
    title: input.title?.trim(),
    idea: input.idea,
    description: input.description,
    contentType: input.contentType,
    targetAudience: input.targetAudience,
    language: input.language,
    priority: input.priority,
    hashtags: input.hashtags === undefined ? undefined : normalizeHashtags(input.hashtags),
  };
  if (input.targetPublishDate !== undefined) data.targetPublishDate = input.targetPublishDate;
  if (input.categoryId !== undefined) data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
  if (input.seriesId !== undefined) data.series = input.seriesId ? { connect: { id: input.seriesId } } : { disconnect: true };
  if (input.campaignId !== undefined) data.campaign = input.campaignId ? { connect: { id: input.campaignId } } : { disconnect: true };
  if (input.tags !== undefined) data.tags = { set: [], connectOrCreate: tagWrites(input.tags) };
  if (input.platforms !== undefined) {
    const valid = await db.platform.findMany({ where: { id: { in: input.platforms } }, select: { id: true } });
    data.platforms = { deleteMany: {}, create: valid.map((p) => ({ platformId: p.id })) };
  }

  await db.content.update({ where: { id }, data });
  await logActivity({ contentId: id, type: ActivityType.CONTENT_UPDATED, message: "Details updated" });
  await syncPublishingStatus(id);
}

export async function setProductionStatus(id: string, field: StatusField, value: string) {
  const meta = STATUS_FIELDS[field];
  if (!meta || !meta.def.is(value)) throw new ServiceError("Invalid status.");
  const row = await db.content.findUnique({ where: { id }, select: contentStateSelect });
  if (!row) throw new ServiceError("Content not found.");
  if (row[field] === value) return;

  // Guard rails: approvals need the underlying asset to exist
  if (field === "scriptStatus" && value === "APPROVED" && !row.script?.body.trim()) {
    throw new ServiceError("Write or generate a script before approving it.");
  }
  if (field === "imageStatus" && value === "APPROVED" && row.media.length === 0) {
    throw new ServiceError("Upload at least one image before approving.");
  }
  if (field === "imageStatus" && value === "APPROVED" && !row.media.some((m) => m.isSelected)) {
    throw new ServiceError("Select the final images before approving.");
  }
  if (field === "videoStatus" && value === "FINAL" && !row.videoAssetId) {
    throw new ServiceError("Upload or link the final video before marking it Final.");
  }

  await db.content.update({ where: { id }, data: { [field]: value } });
  await logActivity({
    contentId: id,
    type: ActivityType.STATUS_CHANGED,
    message: `${meta.label} marked ${meta.def.label(value)}`,
    meta: { field, from: row[field], to: value },
  });
  await syncPublishingStatus(id);
}

export async function setChecklistFlag(id: string, key: "titleFinalized" | "descriptionFinalized", value: boolean) {
  await db.content.update({ where: { id }, data: { [key]: value } });
  await logActivity({
    contentId: id,
    type: ActivityType.CONTENT_UPDATED,
    message: `${key === "titleFinalized" ? "Title" : "Description"} ${value ? "finalized" : "reopened"}`,
  });
  // Part of the checklist, so of the stored completion
  await syncPublishingStatus(id);
}

export async function duplicateContent(id: string) {
  const src = await db.content.findUnique({
    where: { id },
    include: { tags: true, platforms: true, script: true, imagePrompt: true },
  });
  if (!src) throw new ServiceError("Content not found.");
  const copy = await db.content.create({
    data: {
      title: `${src.title} (copy)`,
      idea: src.idea,
      description: src.description,
      contentType: src.contentType,
      targetAudience: src.targetAudience,
      language: src.language,
      priority: src.priority,
      hashtags: src.hashtags,
      categoryId: src.categoryId,
      seriesId: src.seriesId,
      campaignId: src.campaignId,
      scriptStatus: src.script?.body.trim() ? "GENERATED" : "NOT_STARTED",
      tags: { connect: src.tags.map((t) => ({ id: t.id })) },
      platforms: { create: src.platforms.map((p) => ({ platformId: p.platformId })) },
      script: { create: { body: src.script?.body ?? "" } },
      imagePrompt: src.imagePrompt
        ? {
            create: {
              prompt: src.imagePrompt.prompt,
              negativePrompt: src.imagePrompt.negativePrompt,
              style: src.imagePrompt.style,
              aspectRatio: src.imagePrompt.aspectRatio,
              provider: src.imagePrompt.provider,
            },
          }
        : undefined,
    },
  });
  await logActivity({ contentId: copy.id, type: ActivityType.CONTENT_CREATED, message: `Duplicated from "${src.title}"` });
  await syncPublishingStatus(copy.id);
  return copy;
}

export async function archiveContents(ids: string[], archived = true) {
  await db.content.updateMany({ where: { id: { in: ids } }, data: { archivedAt: archived ? new Date() : null } });
  if (archived) {
    // Archived content must never publish
    await db.publishingSchedule.updateMany({
      where: { contentId: { in: ids }, status: { in: ["WAITING", "RETRY_SCHEDULED"] } },
      data: { status: "CANCELLED", activeKey: null, nextAttemptAt: null },
    });
  }
  for (const id of ids) {
    await logActivity({ contentId: id, type: ActivityType.CONTENT_UPDATED, message: archived ? "Archived" : "Restored from archive" });
    await syncPublishingStatus(id);
  }
}

/** Deletes content, its media records and the uploaded files. */
export async function deleteContents(ids: string[]) {
  const assets = await db.mediaAsset.findMany({ where: { contentId: { in: ids } }, select: { id: true, storageKey: true } });
  await db.$transaction([
    db.content.updateMany({ where: { id: { in: ids } }, data: { videoAssetId: null, thumbnailAssetId: null } }),
    db.mediaAsset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } }),
    db.content.deleteMany({ where: { id: { in: ids } } }),
  ]);
  await Promise.all(assets.flatMap((a) => (a.storageKey ? [storage.remove(a.storageKey)] : [])));
}

export async function bulkSetCategory(ids: string[], categoryId: string | null) {
  await db.content.updateMany({ where: { id: { in: ids } }, data: { categoryId } });
}

export async function bulkAddTag(ids: string[], tag: string) {
  const [name] = parseTags(tag);
  if (!name) throw new ServiceError("Enter a tag.");
  const t = await db.tag.upsert({ where: { name }, update: {}, create: { name } });
  for (const id of ids) await db.content.update({ where: { id }, data: { tags: { connect: { id: t.id } } } });
}

export async function bulkSetStatus(ids: string[], field: StatusField, value: string) {
  const errors: string[] = [];
  for (const id of ids) {
    try {
      await setProductionStatus(id, field, value);
    } catch (e) {
      if (e instanceof ServiceError) errors.push(e.message);
      else throw e;
    }
  }
  return { updated: ids.length - errors.length, errors: Array.from(new Set(errors)) };
}

/** Readiness for scheduling, with the reasons when not ready. */
export async function getReadiness(contentId: string) {
  const row = await db.content.findUnique({ where: { id: contentId }, select: contentStateSelect });
  if (!row) throw new ServiceError("Content not found.");
  const rules = await getRules();
  const state = toContentState(row);
  return { ready: isReadyToPost(state, rules), missing: missingRequirements(state, rules) };
}
