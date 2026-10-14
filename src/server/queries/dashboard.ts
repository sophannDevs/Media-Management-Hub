import { db } from "@/lib/db";
import { dayKey, dayRangeUtc, weekKeys } from "@/lib/dates";
import { mediaUrl } from "@/lib/media-url";
import { PIPELINE_STAGES, PRIORITY_ORDER, PRODUCTION_STAGES } from "@/lib/workflow/statuses";
import { contentSummarySelect, getPageContext, toSummary } from "./shared";

const scheduleCardSelect = {
  id: true,
  status: true,
  platformId: true,
  scheduledAt: true,
  lastError: true,
  account: { select: { name: true, status: true } },
  content: {
    select: {
      id: true,
      title: true,
      contentType: true,
      thumbnailAsset: { select: { storageKey: true, externalUrl: true } },
      videoAsset: { select: { durationSec: true } },
    },
  },
} as const;

export async function getDashboardData() {
  const { now, rules, tz } = await getPageContext();
  const todayKey = dayKey(now, tz);
  const week = weekKeys(todayKey);
  const weekRange = dayRangeUtc(week[0], week[6], tz);
  const todayRange = dayRangeUtc(todayKey, todayKey, tz);
  const monthStart = new Date(`${todayKey.slice(0, 7)}-01T00:00:00Z`);

  const [rows, upcoming, weekSchedules, failed, accountIssues, activity, monthViews, publishedThisMonth] = await Promise.all([
    db.content.findMany({ where: { archivedAt: null }, select: contentSummarySelect }),
    db.publishingSchedule.findMany({
      where: { status: { in: ["WAITING", "RETRY_SCHEDULED", "PROCESSING"] }, scheduledAt: { gte: todayRange.gte }, content: { archivedAt: null } },
      orderBy: { scheduledAt: "asc" },
      take: 6,
      select: scheduleCardSelect,
    }),
    db.publishingSchedule.findMany({
      where: { scheduledAt: weekRange, status: { not: "CANCELLED" }, content: { archivedAt: null } },
      orderBy: { scheduledAt: "asc" },
      select: scheduleCardSelect,
    }),
    db.publishingSchedule.findMany({
      where: { status: "FAILED", content: { archivedAt: null } },
      orderBy: { scheduledAt: "desc" },
      select: scheduleCardSelect,
    }),
    db.socialAccount.findMany({ where: { status: { not: "CONNECTED" } }, select: { id: true, name: true, status: true, platformId: true } }),
    db.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, message: true, createdAt: true, content: { select: { id: true, title: true } } },
    }),
    db.analyticsSnapshot.aggregate({ _sum: { views: true }, where: { date: { gte: monthStart } } }),
    db.publishingSchedule.count({ where: { status: "PUBLISHED", publishedAt: { gte: monthStart } } }),
  ]);

  const items = rows.map((r) => toSummary(r, rules, now));
  const byStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])) as Record<string, number>;
  for (const c of items) byStage[c.stage] = (byStage[c.stage] ?? 0) + 1;

  const card = (s: (typeof upcoming)[number]) => ({
    id: s.id,
    status: s.status,
    platformId: s.platformId,
    scheduledAt: s.scheduledAt,
    accountName: s.account.name,
    lastError: s.lastError,
    content: {
      id: s.content.id,
      title: s.content.title,
      contentType: s.content.contentType,
      thumbUrl: mediaUrl(s.content.thumbnailAsset),
      durationSec: s.content.videoAsset?.durationSec ?? null,
    },
  });

  const incomplete = items
    .filter((c) => (PRODUCTION_STAGES as string[]).includes(c.stage))
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        (a.targetPublishDate?.getTime() ?? Infinity) - (b.targetPublishDate?.getTime() ?? Infinity),
    );

  return {
    now,
    tz,
    todayKey,
    week,
    counts: {
      total: items.length,
      ideas: byStage.IDEA,
      script: byStage.SCRIPT,
      images: byStage.IMAGES,
      video: byStage.VIDEO,
      review: byStage.REVIEW,
      inProduction: incomplete.length,
      ready: byStage.READY,
      scheduled: byStage.SCHEDULED,
      published: byStage.PUBLISHED,
      failedPosts: failed.length,
      retrying: weekSchedules.filter((s) => s.status === "RETRY_SCHEDULED").length,
      queued: upcoming.length,
      scheduledToday: weekSchedules.filter((s) => s.scheduledAt >= todayRange.gte && s.scheduledAt < todayRange.lt && s.status !== "PUBLISHED").length,
      scheduledThisWeek: weekSchedules.filter((s) => s.status !== "PUBLISHED" && s.scheduledAt >= now).length,
      monthViews: monthViews._sum.views ?? 0,
      publishedThisMonth,
    },
    byStage,
    ready: items.filter((c) => c.stage === "READY"),
    incomplete,
    upcoming: upcoming.map(card),
    weekSchedules: weekSchedules.map(card),
    failed: failed.map(card),
    accountIssues,
    activity,
  };
}
export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
