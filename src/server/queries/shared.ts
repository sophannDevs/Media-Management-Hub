import { io } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import { completion, deriveStage, missingRequirements, type WorkflowRules } from "@/lib/workflow/rules";
import { contentStateSelect, toContentState } from "../services/content-state";
import { getSettings, rulesFrom } from "../services/settings";

/**
 * Current time for Server Components. `io()` keeps time-dependent output out
 * of the prerendered static shell (required with Cache Components).
 */
export async function getNow() {
  await io();
  return new Date();
}

/** Settings + rules + "now" — what most pages need to render. */
export async function getPageContext() {
  const now = await getNow();
  const settings = await getSettings();
  return { now, settings, rules: rulesFrom(settings), tz: settings.timezone };
}

export async function getNavCounts() {
  await io();
  const [content, failed, accountIssues, unread, settings] = await Promise.all([
    db.content.count({ where: { archivedAt: null } }),
    db.publishingSchedule.count({ where: { status: "FAILED", content: { archivedAt: null } } }),
    db.socialAccount.count({ where: { status: { not: "CONNECTED" } } }),
    db.notification.count({ where: { readAt: null } }),
    getSettings(),
  ]);
  return { content, failed, accountIssues, unread, workspaceName: settings.workspaceName };
}

export async function getNotifications(limit = 20) {
  await io();
  return db.notification.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function getContentFormOptions() {
  await io();
  const [categories, series, campaigns, platforms, settings] = await Promise.all([
    db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.series.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.platform.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, enabled: true } }),
    getSettings(),
  ]);
  return { categories, series, campaigns, platforms, defaultLanguage: settings.defaultLanguage };
}
export type ContentFormOptions = Awaited<ReturnType<typeof getContentFormOptions>>;

// ---------- Content summaries (lists, dashboard, calendar) ----------

export const contentSummarySelect = {
  ...contentStateSelect,
  id: true,
  title: true,
  description: true,
  contentType: true,
  priority: true,
  createdAt: true,
  targetPublishDate: true,
  archivedAt: true,
  category: { select: { id: true, name: true } },
  series: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  tags: { select: { name: true }, orderBy: { name: "asc" } },
  platforms: { select: { platformId: true } },
  thumbnailAsset: { select: { storageKey: true, externalUrl: true } },
  videoAsset: { select: { durationSec: true } },
  media: { where: { type: "IMAGE" }, select: { isSelected: true, storageKey: true, externalUrl: true }, orderBy: { createdAt: "asc" } },
  schedules: {
    select: { id: true, status: true, platformId: true, scheduledAt: true, accountId: true, simulated: true },
    orderBy: { scheduledAt: "asc" },
  },
} satisfies Prisma.ContentSelect;

/** True when the content has published posts and every one of them was simulated. */
export function onlySimulatedPosts(schedules: { status: string; simulated: boolean }[]) {
  const published = schedules.filter((s) => s.status === "PUBLISHED");
  return published.length > 0 && published.every((s) => s.simulated);
}

type SummaryRow = Prisma.ContentGetPayload<{ select: typeof contentSummarySelect }>;

/** Turns a DB row into the serializable shape the UI uses. */
export function toSummary(c: SummaryRow, rules: WorkflowRules, now: Date) {
  const state = toContentState(c);
  const thumb = c.thumbnailAsset ?? c.media.find((m) => m.isSelected) ?? c.media[0] ?? null;
  const nextSchedule = c.schedules.find((s) => ["WAITING", "RETRY_SCHEDULED", "PROCESSING"].includes(s.status) && s.scheduledAt >= new Date(now.getTime() - 86_400_000)) ?? null;
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    contentType: c.contentType,
    priority: c.priority,
    createdAt: c.createdAt,
    targetPublishDate: c.targetPublishDate,
    archived: !!c.archivedAt,
    category: c.category,
    series: c.series,
    campaign: c.campaign,
    tags: c.tags.map((t) => t.name),
    platforms: c.platforms.map((p) => p.platformId),
    scriptStatus: c.scriptStatus,
    imageStatus: c.imageStatus,
    videoStatus: c.videoStatus,
    reviewStatus: c.reviewStatus,
    publishingStatus: c.publishingStatus,
    stage: deriveStage(state, rules),
    completion: completion(state),
    missing: missingRequirements(state, rules),
    thumbUrl: mediaUrl(thumb),
    durationSec: c.videoAsset?.durationSec ?? null,
    nextSchedule,
    scheduleCount: c.schedules.filter((s) => s.status !== "CANCELLED").length,
    simulated: onlySimulatedPosts(c.schedules),
  };
}
export type ContentSummary = ReturnType<typeof toSummary>;

