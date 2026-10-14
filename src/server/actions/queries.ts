"use server";

// Read-only Server Functions used by client dialogs to load their form data on demand.

import { db } from "@/lib/db";
import { dayKey, timeKey } from "@/lib/dates";
import { mediaUrl } from "@/lib/media-url";
import { providerMeta } from "@/lib/platforms/registry";
import { isReadyToPost, missingRequirements } from "@/lib/workflow/rules";
import { requireActionUser } from "../auth/dal";
import { contentStateSelect, toContentState } from "../services/content-state";
import { getSettings, rulesFrom } from "../services/settings";

export async function getScheduleFormData(input: { contentId?: string | null; scheduleId?: string | null }) {
  await requireActionUser();
  const settings = await getSettings();
  const rules = rulesFrom(settings);
  const schedule = input.scheduleId ? await db.publishingSchedule.findUnique({ where: { id: input.scheduleId } }) : null;
  const contentId = schedule?.contentId ?? input.contentId ?? null;

  const [rows, accounts, platforms] = await Promise.all([
    db.content.findMany({
      where: { archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { ...contentStateSelect, id: true, title: true },
    }),
    db.socialAccount.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, platformId: true, name: true, status: true, isDefault: true } }),
    db.platform.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const contents = rows.map((r) => ({ id: r.id, title: r.title, ready: isReadyToPost(toContentState(r), rules) }));
  const pickId = contentId ?? contents.find((c) => c.ready)?.id ?? null;

  const c = pickId
    ? await db.content.findUnique({
        where: { id: pickId },
        select: {
          ...contentStateSelect,
          id: true,
          title: true,
          description: true,
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

  const state = c ? toContentState({ ...c, media: c.media.filter((m) => m.type === "IMAGE") }) : null;

  return {
    timezone: settings.timezone,
    nowIso: new Date().toISOString(),
    contents,
    content: c && state
      ? {
          id: c.id,
          title: c.title,
          description: c.description,
          hashtags: c.hashtags,
          platforms: c.platforms.map((p) => p.platformId),
          durationSec: c.videoAsset?.durationSec ?? null,
          ready: isReadyToPost(state, rules),
          /** Hard items can't be overridden; soft ones can, with a reason (WF-01) */
          missing: missingRequirements(state, rules).map((m) => ({ label: m.label, hard: !!m.hard })),
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

/** Content picker options for the media upload dialog. */
export async function getContentPickerOptions() {
  await requireActionUser();
  return db.content.findMany({ where: { archivedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true } });
}

export async function getScriptPromptOptions() {
  await requireActionUser();
  return db.aiPrompt.findMany({ where: { category: "SCRIPT" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true } });
}
