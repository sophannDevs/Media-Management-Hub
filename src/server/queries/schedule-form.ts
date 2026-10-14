import { db } from "@/lib/db";
import { dayKey, timeKey } from "@/lib/dates";
import { mediaUrl } from "@/lib/media-url";
import { providerMeta } from "@/lib/platforms/registry";
import { requirementsFromMask } from "@/lib/workflow/rules";
import { getSettings } from "../services/settings";

/**
 * What the schedule dialog needs for one content item (PERF-11), served by
 * GET /api/schedule/form (ARCH-03: reads are GETs, not Server Actions). The
 * content picker searches separately (GET /api/content/search), so opening the
 * dialog costs the same at any library size. Readiness is the stored state (WF-03).
 */
export async function getScheduleFormData(input: { contentId?: string | null; scheduleId?: string | null }) {
  const schedule = input.scheduleId ? await db.publishingSchedule.findUnique({ where: { id: input.scheduleId } }) : null;
  const contentId = schedule?.contentId ?? input.contentId ?? null;

  const [settings, accounts, platforms, firstReady] = await Promise.all([
    getSettings(),
    db.socialAccount.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, platformId: true, name: true, status: true, isDefault: true } }),
    db.platform.findMany({ orderBy: { sortOrder: "asc" } }),
    // Opened without a content: start with the most recently updated one that is ready to post
    contentId ? null : db.content.findFirst({ where: { archivedAt: null, missingMask: 0 }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: { id: true } }),
  ]);
  const pickId = contentId ?? firstReady?.id ?? null;

  const c = pickId
    ? await db.content.findUnique({
        where: { id: pickId },
        select: {
          id: true,
          title: true,
          description: true,
          hashtags: true,
          missingMask: true,
          thumbnailAssetId: true,
          platforms: { select: { platformId: true } },
          videoAsset: { select: { durationSec: true } },
          media: {
            where: { type: { in: ["THUMBNAIL", "IMAGE"] } },
            select: { id: true, type: true, fileName: true, storageKey: true, externalUrl: true, isSelected: true, createdAt: true },
            orderBy: [{ type: "desc" }, { createdAt: "asc" }],
          },
        },
      })
    : null;

  return {
    timezone: settings.timezone,
    nowIso: new Date().toISOString(),
    content: c
      ? {
          id: c.id,
          title: c.title,
          description: c.description,
          hashtags: c.hashtags,
          platforms: c.platforms.map((p) => p.platformId),
          durationSec: c.videoAsset?.durationSec ?? null,
          ready: c.missingMask === 0,
          /** Hard items can't be overridden; soft ones can, with a reason (WF-01) */
          missing: requirementsFromMask(c.missingMask).map((m) => ({ label: m.label, hard: !!m.hard })),
          defaultThumbnailId: c.thumbnailAssetId,
          thumbnails: c.media
            .filter((m) => m.type === "THUMBNAIL" || m.isSelected || m.id === c.thumbnailAssetId)
            .slice(0, 8)
            .map((m) => ({ id: m.id, fileName: m.fileName, url: mediaUrl(m) })),
        }
      : null,
    accounts,
    platforms: platforms.map((p) => ({ id: p.id, name: p.name, enabled: p.enabled, meta: providerMeta(p.id) })),
    schedule: schedule
      ? {
          id: schedule.id,
          platformId: schedule.platformId,
          accountId: schedule.accountId,
          date: dayKey(schedule.scheduledAt, schedule.timezone),
          time: timeKey(schedule.scheduledAt, schedule.timezone),
          timezone: schedule.timezone,
          title: schedule.title,
          caption: schedule.caption,
          hashtags: schedule.hashtags,
          thumbnailAssetId: schedule.thumbnailAssetId,
          visibility: schedule.visibility,
          status: schedule.status,
          override: schedule.overrideReason ? { reason: schedule.overrideReason } : null,
        }
      : null,
  };
}
export type ScheduleFormData = Awaited<ReturnType<typeof getScheduleFormData>>;
