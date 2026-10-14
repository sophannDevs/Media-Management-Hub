import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDaysToKey, dayKey, dayRangeUtc, fmt, fmtDate, fmtTime } from "@/lib/dates";
import { mediaUrl } from "@/lib/media-url";
import { getPageContext } from "./shared";

// Analytics page data. Metrics come from AnalyticsSnapshot rows (one per
// content × platform × UTC day, see services/analytics-sync.ts). Everything is
// pre-aggregated here so the client only renders serializable numbers.

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_RANGE: AnalyticsRange = 30;

/** Platforms compared on the page (each has a validated series color). */
export const ANALYTICS_PLATFORMS = ["youtube", "facebook"] as const;
export type AnalyticsPlatform = (typeof ANALYTICS_PLATFORMS)[number];

export interface AnalyticsParams {
  range: AnalyticsRange;
  platform: AnalyticsPlatform | null;
}

export function parseAnalyticsParams(sp: Record<string, string | string[] | undefined>): AnalyticsParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const range = Number(one(sp.range));
  const platform = one(sp.platform);
  return {
    range: ANALYTICS_RANGES.find((r) => r === range) ?? DEFAULT_RANGE,
    platform: ANALYTICS_PLATFORMS.find((p) => p === platform) ?? null,
  };
}

const isAnalyticsPlatform = (p: string): p is AnalyticsPlatform => (ANALYTICS_PLATFORMS as readonly string[]).includes(p);

interface Metrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchMinutes: number;
}

const SUM = { views: true, likes: true, comments: true, shares: true, watchMinutes: true } satisfies Prisma.AnalyticsSnapshotSumAggregateInputType;

const zero = (): Metrics => ({ views: 0, likes: 0, comments: 0, shares: 0, watchMinutes: 0 });

function addInto(target: Metrics, sum: { [K in keyof Metrics]: number | null }) {
  target.views += sum.views ?? 0;
  target.likes += sum.likes ?? 0;
  target.comments += sum.comments ?? 0;
  target.shares += sum.shares ?? 0;
  target.watchMinutes += sum.watchMinutes ?? 0;
  return target;
}

/** (likes + comments + shares) / views — null when there are no views. */
const engagementOf = (m: Metrics) => (m.views > 0 ? (m.likes + m.comments + m.shares) / m.views : null);

/** Snapshot `date` is the UTC midnight of the metric day. */
const utcDay = (key: string) => new Date(`${key}T00:00:00Z`);
const dayLabel = (key: string, pattern = "MMM d") => fmt(`${key}T12:00:00Z`, "UTC", pattern);

// Best-posting-time grid: 3-hour slots in the workspace timezone.
const SLOT_STARTS = [6, 9, 12, 15, 18, 21] as const;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const pad = (h: number) => String(h).padStart(2, "0");

const contentCardSelect = {
  id: true,
  title: true,
  archivedAt: true,
  thumbnailAsset: { select: { storageKey: true, externalUrl: true } },
  media: {
    where: { type: "IMAGE" },
    orderBy: [{ isSelected: "desc" }, { createdAt: "asc" }],
    take: 1,
    select: { storageKey: true, externalUrl: true },
  },
  videoAsset: { select: { durationSec: true } },
} satisfies Prisma.ContentSelect;

function contentCard(c: Prisma.ContentGetPayload<{ select: typeof contentCardSelect }>) {
  return {
    id: c.id,
    title: c.title,
    archived: !!c.archivedAt,
    thumbUrl: mediaUrl(c.thumbnailAsset ?? c.media[0] ?? null),
    durationSec: c.videoAsset?.durationSec ?? null,
  };
}

export async function getAnalyticsData({ range, platform }: AnalyticsParams) {
  const { now, tz } = await getPageContext();

  // Last `range` local days ending today, and the period of equal length before it.
  const todayKey = dayKey(now, tz);
  const fromKey = addDaysToKey(todayKey, 1 - range);
  const prevToKey = addDaysToKey(fromKey, -1);
  const prevFromKey = addDaysToKey(fromKey, -range);
  const current = dayRangeUtc(fromKey, todayKey, tz);
  const previous = dayRangeUtc(prevFromKey, prevToKey, tz);
  const within = (d: Date, r: { gte: Date; lt: Date }) => d >= r.gte && d < r.lt;
  const onPlatform = platform ? { platformId: platform } : {};

  const [dailyRows, topRows, scheduleRows, schedules, generated] = await Promise.all([
    db.analyticsSnapshot.groupBy({
      by: ["date", "platformId"],
      where: { date: { gte: utcDay(prevFromKey), lte: utcDay(todayKey) } },
      _sum: SUM,
    }),
    db.analyticsSnapshot.groupBy({
      by: ["contentId"],
      where: { date: { gte: utcDay(fromKey), lte: utcDay(todayKey) }, ...onPlatform },
      _sum: SUM,
      orderBy: { _sum: { views: "desc" } },
      take: 5,
    }),
    // All-time totals per published post (table + best posting time)
    db.analyticsSnapshot.groupBy({
      by: ["scheduleId"],
      where: { scheduleId: { not: null } },
      _sum: SUM,
    }),
    db.publishingSchedule.findMany({
      where: { status: "PUBLISHED", publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        platformId: true,
        publishedAt: true,
        account: { select: { name: true } },
        content: { select: contentCardSelect },
      },
    }),
    db.analyticsSnapshot.count({ where: { source: "MOCK" } }),
  ]);

  const topContent = topRows.length
    ? await db.content.findMany({ where: { id: { in: topRows.map((r) => r.contentId) } }, select: contentCardSelect })
    : [];

  // ---------- Daily series, period totals, per-platform totals ----------
  const days = Array.from({ length: range }, (_, i) => addDaysToKey(fromKey, i));
  const dayIndex = new Map(days.map((k, i) => [k, i]));
  const daily = days.map((key) => ({ key, label: dayLabel(key), fullLabel: dayLabel(key, "EEE, MMM d, yyyy"), views: 0, youtube: 0, facebook: 0 }));
  const totals = zero();
  const prevTotals = zero();
  const byPlatform = Object.fromEntries(ANALYTICS_PLATFORMS.map((p) => [p, zero()])) as Record<AnalyticsPlatform, Metrics>;

  for (const row of dailyRows) {
    const key = row.date.toISOString().slice(0, 10);
    const i = dayIndex.get(key);
    const included = !platform || row.platformId === platform;
    if (i !== undefined) {
      if (isAnalyticsPlatform(row.platformId)) {
        daily[i][row.platformId] += row._sum.views ?? 0;
        addInto(byPlatform[row.platformId], row._sum);
      }
      if (included) {
        daily[i].views += row._sum.views ?? 0;
        addInto(totals, row._sum);
      }
    } else if (included && key >= prevFromKey && key <= prevToKey) {
      addInto(prevTotals, row._sum);
    }
  }

  // ---------- Published posts with all-time totals ----------
  const perSchedule = new Map(scheduleRows.flatMap((r) => (r.scheduleId ? [[r.scheduleId, addInto(zero(), r._sum)] as const] : [])));
  const published = schedules.flatMap((s) => (s.publishedAt ? [{ ...s, publishedAt: s.publishedAt }] : []));
  const visible = published.filter((s) => !platform || s.platformId === platform);

  const posts = visible.map((s) => {
    const m = perSchedule.get(s.id) ?? zero();
    return {
      id: s.id,
      content: contentCard(s.content),
      platformId: s.platformId,
      accountName: s.account.name,
      publishedAtMs: s.publishedAt.getTime(),
      publishedLabel: fmtDate(s.publishedAt, tz),
      publishedTime: fmtTime(s.publishedAt, tz),
      ...m,
      engagement: engagementOf(m),
    };
  });

  // ---------- KPIs ----------
  const postsNow = posts.filter((p) => within(new Date(p.publishedAtMs), current));
  const kpis = {
    views: totals.views,
    prevViews: prevTotals.views,
    watchHours: totals.watchMinutes / 60,
    prevWatchHours: prevTotals.watchMinutes / 60,
    engagement: engagementOf(totals),
    prevEngagement: engagementOf(prevTotals),
    likes: totals.likes,
    comments: totals.comments,
    shares: totals.shares,
    posts: postsNow.length,
    prevPosts: posts.filter((p) => within(new Date(p.publishedAtMs), previous)).length,
    postsByPlatform: ANALYTICS_PLATFORMS.map((p) => ({ platformId: p, count: postsNow.filter((x) => x.platformId === p).length })),
    avgViewsPerPost: postsNow.length ? postsNow.reduce((sum, p) => sum + p.views, 0) / postsNow.length : null,
  };

  // ---------- Platform comparison (always both platforms) ----------
  const platforms = ANALYTICS_PLATFORMS.map((p) => ({
    platformId: p,
    views: byPlatform[p].views,
    watchHours: byPlatform[p].watchMinutes / 60,
    engagement: engagementOf(byPlatform[p]),
    posts: published.filter((s) => s.platformId === p && within(s.publishedAt, current)).length,
  }));

  // ---------- Best posting time (all time) ----------
  const grid = WEEKDAYS.map(() => SLOT_STARTS.map(() => ({ total: 0, posts: 0 })));
  let outsideSlots = 0;
  for (const p of posts) {
    const at = new Date(p.publishedAtMs);
    const weekday = Number(fmt(at, tz, "i")) - 1; // ISO: Monday = 1
    const hour = Number(fmt(at, tz, "H"));
    const slot = SLOT_STARTS.findLastIndex((start) => hour >= start);
    if (slot < 0) {
      outsideSlots++;
      continue;
    }
    grid[weekday][slot].total += p.views;
    grid[weekday][slot].posts += 1;
  }
  const cells = grid.map((row) => row.map((c) => ({ avg: c.posts ? Math.round(c.total / c.posts) : null, posts: c.posts })));
  let best: { day: number; slot: number } | null = null;
  let maxAvg = 0;
  for (const [d, row] of cells.entries()) {
    for (const [s, c] of row.entries()) {
      if (c.avg !== null && c.avg > maxAvg) {
        maxAvg = c.avg;
        best = { day: d, slot: s };
      }
    }
  }
  const heatmap = {
    days: WEEKDAYS.map((name) => ({ short: name.slice(0, 3), long: name })),
    slots: SLOT_STARTS.map((start) => ({ label: `${pad(start)}–${pad(start + 3)}`, range: `${pad(start)}:00–${pad(start + 3)}:00` })),
    cells,
    best,
    max: maxAvg,
    outsideSlots,
  };

  // ---------- Best-performing content in the period ----------
  const cardsById = new Map(topContent.map((c) => [c.id, contentCard(c)]));
  const top = topRows.flatMap((r) => {
    const card = cardsById.get(r.contentId);
    const m = addInto(zero(), r._sum);
    return card && m.views > 0 ? [{ ...card, views: m.views, watchHours: m.watchMinutes / 60, engagement: engagementOf(m) }] : [];
  });

  return {
    tz,
    range,
    platform,
    todayKey,
    periodLabel: `${dayLabel(fromKey)} – ${dayLabel(todayKey)}`,
    hasAnyPublished: published.length > 0,
    /** Some numbers were generated for simulated posts (AnalyticsSnapshot.source = MOCK) */
    simulated: generated > 0,
    kpis,
    daily,
    platforms,
    heatmap,
    top,
    posts,
  };
}

export type AnalyticsData = Awaited<ReturnType<typeof getAnalyticsData>>;
export type AnalyticsPost = AnalyticsData["posts"][number];
export type AnalyticsHeatmap = AnalyticsData["heatmap"];
export type AnalyticsDailyPoint = AnalyticsData["daily"][number];
