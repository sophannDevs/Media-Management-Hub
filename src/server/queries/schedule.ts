import type { Prisma } from "@prisma/client";
import { enUS } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import type { QueueParams, QueueTab } from "@/app/(app)/schedule/_components/queue-shared";
import { dayKey, fmt, fmtDateTime, fmtTime, relativeDay, timeAgo } from "@/lib/dates";
import { db } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import { isSimulationMode, listProviders, providerMeta } from "@/lib/platforms/registry";
import { getPageContext } from "./shared";

/** Status codes and sort order behind each queue tab. */
const TABS: Record<QueueTab, { label: string; statuses: string[] | null; order: Prisma.SortOrder }> = {
  upcoming: { label: "Upcoming", statuses: ["WAITING", "PROCESSING", "RETRY_SCHEDULED"], order: "asc" },
  failed: { label: "Failed", statuses: ["FAILED", "RETRY_SCHEDULED"], order: "asc" },
  published: { label: "Published", statuses: ["PUBLISHED"], order: "desc" },
  cancelled: { label: "Cancelled", statuses: ["CANCELLED"], order: "desc" },
  all: { label: "All", statuses: null, order: "desc" },
};

/** Max rows rendered per tab (the tab count still shows the total). */
const ROW_LIMIT = 200;
const CALLOUT_LIMIT = 3;

const assetSelect = { storageKey: true, externalUrl: true } as const;

const rowSelect = {
  id: true,
  status: true,
  platformId: true,
  scheduledAt: true,
  timezone: true,
  visibility: true,
  attempts: true,
  nextAttemptAt: true,
  lastError: true,
  externalUrl: true,
  publishedAt: true,
  simulated: true,
  platform: { select: { name: true } },
  account: { select: { id: true, name: true, status: true, avatarUrl: true } },
  thumbnailAsset: { select: assetSelect },
  content: {
    select: {
      id: true,
      title: true,
      contentType: true,
      thumbnailAsset: { select: assetSelect },
      videoAsset: { select: { durationSec: true } },
      // Order fields are selected too: Prisma panics merging chunked relations on unselected ones (PERF-02)
      media: { where: { type: "IMAGE" }, select: { ...assetSelect, isSelected: true, createdAt: true }, orderBy: [{ isSelected: "desc" }, { createdAt: "asc" }], take: 1 },
    },
  },
  jobs: {
    orderBy: { startedAt: "desc" },
    take: 20,
    select: { id: true, attempt: true, status: true, error: true, startedAt: true, finishedAt: true },
  },
  _count: { select: { jobs: true } },
} satisfies Prisma.PublishingScheduleSelect;

type Row = Prisma.PublishingScheduleGetPayload<{ select: typeof rowSelect }>;

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** "Today · Oct 13, 2026", "Tomorrow · Oct 14, 2026", "Thu, Oct 15" (year added when it differs). */
function groupLabel(d: Date, now: Date, tz: string) {
  const rel = relativeDay(d, now, tz);
  if (rel === "Today" || rel === "Tomorrow" || rel === "Yesterday") return `${rel} · ${fmt(d, tz, "MMM d, yyyy")}`;
  return fmt(d, tz, fmt(d, tz, "yyyy") === fmt(now, tz, "yyyy") ? "EEE, MMM d" : "EEE, MMM d, yyyy");
}

const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

function toRow(s: Row, now: Date, tz: string) {
  const meta = providerMeta(s.platformId);
  return {
    id: s.id,
    status: s.status,
    platformId: s.platformId,
    platformName: s.platform.name,
    day: dayKey(s.scheduledAt, tz),
    group: groupLabel(s.scheduledAt, now, tz),
    time: fmtTime(s.scheduledAt, tz),
    zone: formatInTimeZone(s.scheduledAt, tz, "zzz", { locale: enUS }),
    when: fmtDateTime(s.scheduledAt, tz),
    /** Wall-clock time in the timezone the post was scheduled in, when that differs from the workspace's */
    setIn: s.timezone !== tz ? `${fmt(s.scheduledAt, s.timezone, "MMM d, h:mm a")} in ${s.timezone}` : null,
    overdue: s.status === "WAITING" && s.scheduledAt.getTime() <= now.getTime(),
    attempts: s.attempts,
    lastError: s.lastError,
    nextAttempt: s.status === "RETRY_SCHEDULED" && s.nextAttemptAt ? `${relativeDay(s.nextAttemptAt, now, tz)}, ${fmtTime(s.nextAttemptAt, tz)}` : null,
    publishedAgo: s.status === "PUBLISHED" && s.publishedAt ? timeAgo(s.publishedAt, now) : null,
    simulated: s.simulated,
    /** Simulated posts have made-up URLs: never link to them */
    externalUrl: s.simulated ? null : safeUrl(s.externalUrl),
    visibility: meta?.visibilityOptions.find((v) => v.value === s.visibility)?.label ?? s.visibility,
    account: { id: s.account.id, name: s.account.name, status: s.account.status, avatarUrl: s.account.avatarUrl, initials: initials(s.account.name) },
    content: {
      id: s.content.id,
      title: s.content.title,
      contentType: s.content.contentType,
      thumbUrl: mediaUrl(s.thumbnailAsset ?? s.content.thumbnailAsset ?? s.content.media[0] ?? null),
      durationSec: s.content.videoAsset?.durationSec ?? null,
    },
    jobs: s.jobs.map((j) => ({
      id: j.id,
      attempt: j.attempt,
      status: j.status,
      error: j.error,
      started: fmt(j.startedAt, tz, "MMM d, h:mm a"),
      finished: j.finishedAt ? fmt(j.finishedAt, tz, dayKey(j.finishedAt, tz) === dayKey(j.startedAt, tz) ? "h:mm a" : "MMM d, h:mm a") : null,
      took: j.finishedAt ? duration(j.finishedAt.getTime() - j.startedAt.getTime()) : null,
    })),
    jobCount: s._count.jobs,
  };
}
export type QueueRow = ReturnType<typeof toRow>;

export async function getQueueData(params: QueueParams) {
  const { now, settings, tz } = await getPageContext();
  const tab = TABS[params.status];
  const platforms = listProviders().map((p) => ({ id: p.id, name: p.name }));
  const platform = platforms.find((p) => p.id === params.platform)?.id ?? null;

  const accountRows = await db.socialAccount.findMany({
    orderBy: [{ platformId: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, platformId: true, status: true },
  });
  const account = accountRows.find((a) => a.id === params.account && (!platform || a.platformId === platform))?.id ?? null;

  const live = { content: { archivedAt: null } } satisfies Prisma.PublishingScheduleWhereInput;
  const filtered = {
    ...live,
    ...(platform ? { platformId: platform } : {}),
    ...(account ? { accountId: account } : {}),
  } satisfies Prisma.PublishingScheduleWhereInput;
  const isFiltered = !!(platform || account);

  const [globalCounts, filteredCounts, rows, failedRows, lastJob, publishedSimulated] = await Promise.all([
    db.publishingSchedule.groupBy({ by: ["status"], where: live, _count: { _all: true } }),
    isFiltered ? db.publishingSchedule.groupBy({ by: ["status"], where: filtered, _count: { _all: true } }) : null,
    db.publishingSchedule.findMany({
      where: { ...filtered, ...(tab.statuses ? { status: { in: tab.statuses } } : {}) },
      orderBy: [{ scheduledAt: tab.order }, { id: "asc" }],
      take: ROW_LIMIT,
      select: rowSelect,
    }),
    db.publishingSchedule.findMany({
      where: { ...live, status: "FAILED" },
      orderBy: { scheduledAt: "desc" },
      take: CALLOUT_LIMIT,
      select: rowSelect,
    }),
    db.publishingJob.findFirst({
      where: { finishedAt: { not: null, lte: now } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    db.publishingSchedule.count({ where: { ...live, status: "PUBLISHED", simulated: true } }),
  ]);

  const countOf = (counts: typeof globalCounts, statuses: string[] | null) =>
    counts.filter((c) => !statuses || statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0);
  const byStatus = (s: string) => countOf(globalCounts, [s]);
  const tabCounts = filteredCounts ?? globalCounts;

  const interval = Number(process.env.PUBLISH_WORKER_INTERVAL_SECONDS ?? 60);
  const failedTotal = byStatus("FAILED");

  return {
    tz,
    zone: formatInTimeZone(now, tz, "zzz", { locale: enUS }),
    params: { status: params.status, platform: platform ?? undefined, account: account ?? undefined } satisfies QueueParams,
    isFiltered,
    worker: {
      enabled: process.env.PUBLISH_WORKER_ENABLED !== "false",
      /** Publishing goes through simulated providers: nothing reaches the platforms */
      simulated: isSimulationMode(),
      // Mirrors the worker's own clamp (min 15s)
      intervalSec: Number.isFinite(interval) && interval > 0 ? Math.max(15, Math.round(interval)) : 60,
      lastRunAgo: lastJob?.finishedAt ? timeAgo(lastJob.finishedAt, now) : null,
      autoRetry: settings.autoRetry,
      maxRetries: settings.maxRetries,
      retryDelayMinutes: settings.retryDelayMinutes,
    },
    counts: {
      waiting: byStatus("WAITING"),
      processing: byStatus("PROCESSING"),
      retrying: byStatus("RETRY_SCHEDULED"),
      failed: failedTotal,
      published: byStatus("PUBLISHED"),
      publishedSimulated,
    },
    tabs: (Object.keys(TABS) as QueueTab[]).map((key) => ({ key, label: TABS[key].label, count: countOf(tabCounts, TABS[key].statuses) })),
    tabTotal: countOf(tabCounts, tab.statuses),
    /** Same tab without the platform / account filters */
    tabTotalUnfiltered: countOf(globalCounts, tab.statuses),
    rows: rows.map((r) => toRow(r, now, tz)),
    failed: failedRows.map((r) => toRow(r, now, tz)),
    failedMore: Math.max(0, failedTotal - failedRows.length),
    platforms,
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name, platformId: a.platformId, connected: a.status === "CONNECTED" })),
  };
}
export type QueueData = Awaited<ReturnType<typeof getQueueData>>;
