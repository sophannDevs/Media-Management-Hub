import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDaysToKey, dayKey, dayRangeUtc, fmtDate, fmtDateTime, fmtShort, fmtTime, relativeDay, timeAgo, weekKeys } from "@/lib/dates";
import { mediaUrl } from "@/lib/media-url";
import { providerMeta } from "@/lib/platforms/registry";
import { checklist, completion, deriveStage, imageStage, isReadyToPost, missingRequirements, wordCount } from "@/lib/workflow/rules";
import { PRODUCTION_STAGES } from "@/lib/workflow/statuses";
import { isClaudeConfigured } from "@/lib/ai/claude";
import { toContentState } from "../services/content-state";
import { contentSummarySelect, getContentFormOptions, getPageContext, onlySimulatedPosts, toSummary } from "./shared";

// ---------- List ----------

export interface ContentListParams {
  q?: string;
  stage?: string;
  platform?: string;
  category?: string;
  priority?: string;
  created?: string;
  scheduled?: string;
  view?: string;
}

/** Stage filters shown as quick tabs. Pipeline stages (SCRIPT, IMAGES…) also work as deep links. */
export const QUICK_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "PRODUCTION", label: "In production" },
  { key: "READY", label: "Ready to post" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "PUBLISHED", label: "Published" },
  { key: "FAILED", label: "Failed" },
  { key: "IDEA", label: "Ideas" },
] as const;

function matchesStage(stage: string, filter: string) {
  if (!filter || filter === "ALL") return true;
  if (filter === "PRODUCTION") return (PRODUCTION_STAGES as string[]).includes(stage);
  return stage === filter;
}

export async function getContentList(params: ContentListParams) {
  const { now, rules, tz } = await getPageContext();

  const where: Prisma.ContentWhereInput = { archivedAt: null };
  const q = params.q?.trim();
  if (q) {
    // PostgreSQL's contains is case-sensitive; search shouldn't be
    const match = { contains: q, mode: "insensitive" } as const;
    where.OR = [{ title: match }, { description: match }, { idea: match }, { tags: { some: { name: match } } }];
  }
  if (params.platform) where.platforms = { some: { platformId: params.platform } };
  if (params.category) where.categoryId = params.category;
  if (params.priority) where.priority = params.priority;
  if (params.created === "7" || params.created === "30") {
    where.createdAt = { gte: new Date(now.getTime() - Number(params.created) * 86_400_000) };
  }

  const rows = await db.content.findMany({ where, select: contentSummarySelect, orderBy: [{ updatedAt: "desc" }] });
  let items = rows.map((r) => toSummary(r, rules, now));

  // "Scheduled" date filter works on the next upcoming post
  const today = dayKey(now, tz);
  const thisWeek = weekKeys(today);
  const nextWeek = weekKeys(addDaysToKey(thisWeek[6], 1));
  const weekRange = dayRangeUtc(today, thisWeek[6], tz);
  const nextRange = dayRangeUtc(nextWeek[0], nextWeek[6], tz);
  if (params.scheduled === "none") items = items.filter((c) => !c.nextSchedule);
  if (params.scheduled === "week") items = items.filter((c) => c.nextSchedule && c.nextSchedule.scheduledAt >= weekRange.gte && c.nextSchedule.scheduledAt < weekRange.lt);
  if (params.scheduled === "next") items = items.filter((c) => c.nextSchedule && c.nextSchedule.scheduledAt >= nextRange.gte && c.nextSchedule.scheduledAt < nextRange.lt);

  const stageFilter = params.stage?.toUpperCase() || "ALL";
  const counts = Object.fromEntries(QUICK_FILTERS.map((f) => [f.key, items.filter((c) => matchesStage(c.stage, f.key)).length])) as Record<string, number>;
  const visible = items.filter((c) => matchesStage(c.stage, stageFilter));

  const [options, total] = await Promise.all([getContentFormOptions(), db.content.count({ where: { archivedAt: null } })]);

  return {
    total,
    stageFilter,
    counts,
    options,
    items: visible.map((c) => ({
      ...c,
      createdLabel: fmtShort(c.createdAt, tz),
      targetLabel: c.targetPublishDate ? fmtShort(c.targetPublishDate, tz) : null,
      next: c.nextSchedule
        ? { platformId: c.nextSchedule.platformId, day: relativeDay(c.nextSchedule.scheduledAt, now, tz), time: fmtTime(c.nextSchedule.scheduledAt, tz), status: c.nextSchedule.status }
        : null,
    })),
  };
}
export type ContentListData = Awaited<ReturnType<typeof getContentList>>;
export type ContentListItem = ContentListData["items"][number];

// ---------- Detail workspace ----------

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
} satisfies Prisma.MediaAssetSelect;

export async function getContentWorkspace(id: string) {
  const { now, rules, tz, settings } = await getPageContext();
  const c = await db.content.findUnique({
    where: { id },
    include: {
      category: true,
      series: true,
      campaign: true,
      tags: { orderBy: { name: "asc" } },
      platforms: true,
      script: { include: { versions: { orderBy: { version: "desc" } } } },
      imagePrompt: true,
      media: { select: assetSelect, orderBy: { createdAt: "asc" } },
      videoAsset: { select: assetSelect },
      thumbnailAsset: { select: assetSelect },
      schedules: {
        orderBy: { scheduledAt: "asc" },
        include: {
          account: { select: { id: true, name: true, status: true } },
          platform: { select: { id: true, name: true } },
          jobs: { orderBy: { attempt: "desc" }, take: 5 },
        },
      },
      activities: { orderBy: { createdAt: "desc" }, take: 150 },
    },
  });
  if (!c) return null;

  const [options, accounts, prompts] = await Promise.all([
    getContentFormOptions(),
    db.socialAccount.findMany({ select: { id: true, platformId: true, name: true, status: true } }),
    db.aiPrompt.findMany({ where: { category: { in: ["SCRIPT", "IMAGE", "THUMBNAIL"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true, provider: true, content: true } }),
  ]);

  const state = toContentState({ ...c, media: c.media.filter((m) => m.type === "IMAGE"), script: c.script ? { body: c.script.body } : null, imagePrompt: c.imagePrompt ? { prompt: c.imagePrompt.prompt } : null });
  const ready = isReadyToPost(state, rules);
  const asset = (a: (typeof c.media)[number]) => ({ ...a, url: mediaUrl(a), createdLabel: fmtShort(a.createdAt, tz) });
  const images = c.media.filter((m) => m.type === "IMAGE").map(asset);
  const thumbnails = c.media.filter((m) => m.type === "THUMBNAIL").map(asset);
  const videos = c.media.filter((m) => m.type === "VIDEO").map(asset);
  const audio = c.media.filter((m) => m.type === "AUDIO" || m.type === "MUSIC" || m.type === "OTHER").map(asset);
  const thumbSource = c.thumbnailAsset ?? images.find((i) => i.isSelected) ?? images[0] ?? null;

  const activeSchedules = c.schedules.filter((s) => s.status !== "CANCELLED");
  const targetPlatforms = c.platforms.map((p) => p.platformId);

  return {
    tz,
    now,
    claudeConfigured: isClaudeConfigured(),
    options,
    prompts,
    content: {
      id: c.id,
      title: c.title,
      idea: c.idea,
      description: c.description,
      contentType: c.contentType,
      targetAudience: c.targetAudience,
      language: c.language,
      priority: c.priority,
      hashtags: c.hashtags,
      targetPublishDate: c.targetPublishDate ? dayKey(c.targetPublishDate, tz) : "",
      targetLabel: c.targetPublishDate ? fmtDate(c.targetPublishDate, tz) : null,
      createdLabel: fmtDate(c.createdAt, tz),
      updatedLabel: timeAgo(c.updatedAt, now),
      archived: !!c.archivedAt,
      categoryId: c.categoryId,
      categoryName: c.category?.name ?? null,
      seriesId: c.seriesId,
      seriesName: c.series?.name ?? null,
      campaignId: c.campaignId,
      campaignName: c.campaign?.name ?? null,
      tags: c.tags.map((t) => t.name),
      platforms: targetPlatforms,
      scriptStatus: c.scriptStatus,
      imageStatus: c.imageStatus,
      videoStatus: c.videoStatus,
      reviewStatus: c.reviewStatus,
      publishingStatus: c.publishingStatus,
      titleFinalized: c.titleFinalized,
      descriptionFinalized: c.descriptionFinalized,
      thumbUrl: mediaUrl(thumbSource),
      durationSec: c.videoAsset?.durationSec ?? null,
    },
    workflow: {
      stage: deriveStage(state, rules),
      ready,
      missing: missingRequirements(state, rules),
      checklist: checklist(state),
      completion: completion(state),
      imageStage: imageStage(state),
      rules,
      /** Every post that went out was simulated */
      simulated: onlySimulatedPosts(c.schedules),
    },
    script: {
      body: c.script?.body ?? "",
      currentVersion: c.script?.currentVersion ?? 0,
      updatedLabel: c.script ? fmtDateTime(c.script.updatedAt, tz) : null,
      versions: (c.script?.versions ?? []).map((v) => ({
        id: v.id,
        version: v.version,
        body: v.body,
        note: v.note,
        status: v.status,
        source: v.source,
        words: v.wordCount || wordCount(v.body),
        createdLabel: fmtDateTime(v.createdAt, tz),
      })),
    },
    imagePrompt: c.imagePrompt
      ? { prompt: c.imagePrompt.prompt, negativePrompt: c.imagePrompt.negativePrompt, style: c.imagePrompt.style, aspectRatio: c.imagePrompt.aspectRatio, provider: c.imagePrompt.provider, updatedLabel: timeAgo(c.imagePrompt.updatedAt, now) }
      : null,
    media: {
      images,
      thumbnails,
      videos,
      audio,
      finalVideo: c.videoAsset ? asset(c.videoAsset) : null,
      thumbnailId: c.thumbnailAssetId,
    },
    schedules: c.schedules.map((s) => ({
      id: s.id,
      platformId: s.platformId,
      platformName: s.platform.name,
      account: s.account,
      status: s.status,
      visibilityLabel: providerMeta(s.platformId)?.visibilityOptions.find((v) => v.value === s.visibility)?.label ?? s.visibility,
      timezone: s.timezone,
      dateLabel: fmtDate(s.scheduledAt, s.timezone),
      timeLabel: fmtTime(s.scheduledAt, s.timezone),
      relative: relativeDay(s.scheduledAt, now, tz),
      title: s.title,
      attempts: s.attempts,
      lastError: s.lastError,
      nextAttemptLabel: s.nextAttemptAt ? fmtDateTime(s.nextAttemptAt, tz) : null,
      simulated: s.simulated,
      /** Simulated posts have made-up URLs: never link to them */
      externalUrl: s.simulated ? null : s.externalUrl,
      /** Scheduled before Ready to Post with a reason (WF-01) */
      override: s.overrideReason ? { reason: s.overrideReason, atLabel: s.overrideAt ? fmtDateTime(s.overrideAt, tz) : null } : null,
      publishedLabel: s.publishedAt ? fmtDateTime(s.publishedAt, tz) : null,
      jobs: s.jobs.map((j) => ({ id: j.id, attempt: j.attempt, status: j.status, error: j.error, startedLabel: fmtDateTime(j.startedAt, tz) })),
    })),
    publishingChecks: [
      { label: 'Content is "Ready to Post"', ok: ready },
      { label: "At least one target platform selected", ok: targetPlatforms.length > 0 },
      ...targetPlatforms.map((p) => {
        const accs = accounts.filter((a) => a.platformId === p);
        return { label: `${providerMeta(p)?.name ?? p} account connected`, ok: accs.some((a) => a.status === "CONNECTED") };
      }),
      { label: "Hashtags added", ok: !!c.hashtags.trim() },
      { label: "Every target platform has a schedule", ok: targetPlatforms.length > 0 && targetPlatforms.every((p) => activeSchedules.some((s) => s.platformId === p)) },
    ],
    activity: c.activities.map((a) => ({ id: a.id, type: a.type, message: a.message, day: fmtDate(a.createdAt, tz), time: fmtTime(a.createdAt, tz) })),
    settings: { timezone: settings.timezone },
  };
}
export type ContentWorkspace = NonNullable<Awaited<ReturnType<typeof getContentWorkspace>>>;
