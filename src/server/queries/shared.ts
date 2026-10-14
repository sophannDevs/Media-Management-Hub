import { cacheLife, cacheTag, io } from "next/cache";
import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { db } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import { completion, deriveStage, missingRequirements, type WorkflowRules } from "@/lib/workflow/rules";
import { requireUser } from "../auth/dal";
import { CACHE_TAGS } from "../cache-tags";
import { contentStateSelect, toContentState } from "../services/content-state";
import { getSettings, rulesFrom } from "../services/settings";

// Page reads shared by the app shell and the pages (PERF-04). React `cache`
// runs each at most once per request however many components ask for it;
// rarely changing data is also cached across requests with "use cache".

/** Workspace settings, read once per request. */
const getRenderSettings = cache(getSettings);

/**
 * Current time for Server Components. `io()` keeps time-dependent output out
 * of the prerendered static shell (required with Cache Components).
 */
export async function getNow() {
  await io();
  return new Date();
}

/** Settings + rules + "now" — what most pages need to render. Every page loader starts here, so it checks the session. */
export async function getPageContext() {
  const now = await getNow();
  await requireUser();
  const settings = await getRenderSettings();
  return { now, settings, rules: rulesFrom(settings), tz: settings.timezone };
}

/** Sidebar, mobile nav and the bell all show these: one query per request. */
export const getNavCounts = cache(async () => {
  await io();
  await requireUser();
  const [[row], settings] = await Promise.all([
    db.$queryRaw<{ content: bigint | number; failed: bigint | number; accountIssues: bigint | number; unread: bigint | number }[]>`
      SELECT
        (SELECT COUNT(*) FROM "Content" WHERE "archivedAt" IS NULL) AS "content",
        (SELECT COUNT(*) FROM "PublishingSchedule" s JOIN "Content" c ON c."id" = s."contentId"
          WHERE s."status" = 'FAILED' AND c."archivedAt" IS NULL) AS "failed",
        (SELECT COUNT(*) FROM "SocialAccount" WHERE "status" <> 'CONNECTED') AS "accountIssues",
        (SELECT COUNT(*) FROM "Notification" WHERE "readAt" IS NULL) AS "unread"`,
    getRenderSettings(),
  ]);
  return {
    content: Number(row.content),
    failed: Number(row.failed),
    accountIssues: Number(row.accountIssues),
    unread: Number(row.unread),
    workspaceName: settings.workspaceName,
  };
});

export const getNotifications = cache(async (limit: number = 20) => {
  await io();
  await requireUser();
  return db.notification.findMany({ orderBy: { createdAt: "desc" }, take: limit });
});

/**
 * Options of the Create Content dialog and the content filters. Cached across
 * requests until a taxonomy or the settings change (updateTag(CACHE_TAGS.formOptions)).
 * Callers must be dynamic (after `io()`), so it never runs at build time.
 */
export async function getContentFormOptions() {
  "use cache";
  cacheLife("hours");
  cacheTag(CACHE_TAGS.formOptions);
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
  // createdAt is selected because the list is ordered by it: past ~1,000 parent rows Prisma
  // (SQLite) loads relations in chunks and panics merging them on an unselected order field (PERF-02)
  media: { where: { type: "IMAGE" }, select: { isSelected: true, storageKey: true, externalUrl: true, createdAt: true }, orderBy: { createdAt: "asc" } },
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

