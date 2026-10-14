import type { Prisma } from "@prisma/client";
import type { CalendarParams, CalendarView } from "@/app/(app)/calendar/_components/calendar-shared";
import { addDaysToKey, compactNumber, dayKey, dayRangeUtc, fmt, fmtShort, fmtTime, timeKey, weekKeys } from "@/lib/dates";
import { db } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import { listProviders } from "@/lib/platforms/registry";
import { PRIORITY_ORDER } from "@/lib/workflow/statuses";
import { contentSummarySelect, getPageContext, toSummary } from "./shared";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const eventSelect = {
  id: true,
  status: true,
  platformId: true,
  scheduledAt: true,
  account: { select: { name: true, status: true } },
  thumbnailAsset: { select: { storageKey: true, externalUrl: true } },
  content: {
    select: {
      id: true,
      title: true,
      contentType: true,
      thumbnailAsset: { select: { storageKey: true, externalUrl: true } },
      videoAsset: { select: { durationSec: true } },
      media: {
        where: { type: "IMAGE" },
        select: { storageKey: true, externalUrl: true },
        orderBy: [{ isSelected: "desc" }, { createdAt: "asc" }],
        take: 1,
      },
    },
  },
} satisfies Prisma.PublishingScheduleSelect;

/** Formats a day key without timezone drift (noon UTC is the same calendar day everywhere we format it). */
const keyFmt = (key: string, pattern: string) => fmt(`${key}T12:00:00Z`, "UTC", pattern);

function shiftMonth(key: string, n: number) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

function visibleDays(view: CalendarView, anchor: string) {
  if (view === "day") return [anchor];
  if (view === "week") return weekKeys(anchor);
  // Month: six Monday-first weeks starting with the week that contains the 1st
  const start = weekKeys(`${anchor.slice(0, 7)}-01`)[0];
  return Array.from({ length: 42 }, (_, i) => addDaysToKey(start, i));
}

function titleFor(view: CalendarView, anchor: string, days: string[]) {
  if (view === "month") return keyFmt(`${anchor.slice(0, 7)}-01`, "MMMM yyyy");
  if (view === "day") return keyFmt(anchor, "EEEE, MMMM d, yyyy");
  const [a, b] = [days[0], days[days.length - 1]];
  return a.slice(0, 4) === b.slice(0, 4)
    ? `${keyFmt(a, "MMM d")} – ${keyFmt(b, "MMM d, yyyy")}`
    : `${keyFmt(a, "MMM d, yyyy")} – ${keyFmt(b, "MMM d, yyyy")}`;
}

export async function getCalendarData(params: CalendarParams) {
  const { now, rules, tz } = await getPageContext();
  const todayKey = dayKey(now, tz);
  const view = params.view;
  const anchor = params.date ?? todayKey;
  const platforms = listProviders().map((p) => ({ id: p.id, name: p.name }));
  const platform = platforms.find((p) => p.id === params.platform) ?? null;

  const keys = visibleDays(view, anchor);
  const range = dayRangeUtc(keys[0], keys[keys.length - 1], tz);

  const [rows, readyRows, best] = await Promise.all([
    db.publishingSchedule.findMany({
      where: { scheduledAt: range, status: { not: "CANCELLED" }, content: { archivedAt: null }, ...(platform ? { platformId: platform.id } : {}) },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      select: eventSelect,
    }),
    // Stage READY is only possible while nothing is scheduled / published yet
    db.content.findMany({
      where: { archivedAt: null, publishingStatus: { notIn: ["SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED"] } },
      select: contentSummarySelect,
    }),
    getBestPostingTimes(tz, platform?.id ?? null),
  ]);

  const month = anchor.slice(0, 7);
  const days = keys.map((key) => ({
    key,
    day: Number(key.slice(8)),
    weekday: keyFmt(key, "EEE"),
    longLabel: keyFmt(key, "EEEE, MMMM d"),
    inMonth: view !== "month" || key.slice(0, 7) === month,
    isToday: key === todayKey,
    isPast: key < todayKey,
  }));

  const events = rows.map((s) => ({
    id: s.id,
    status: s.status,
    platformId: s.platformId,
    dayKey: dayKey(s.scheduledAt, tz),
    /** Local wall-clock "HH:mm" in the workspace timezone */
    time: timeKey(s.scheduledAt, tz),
    timeLabel: fmtTime(s.scheduledAt, tz),
    accountName: s.account.name,
    accountConnected: s.account.status === "CONNECTED",
    /** Published / publishing posts can't be moved */
    movable: s.status !== "PUBLISHED" && s.status !== "PROCESSING",
    content: {
      id: s.content.id,
      title: s.content.title,
      contentType: s.content.contentType,
      thumbUrl: mediaUrl(s.thumbnailAsset ?? s.content.thumbnailAsset ?? s.content.media[0] ?? null),
      durationSec: s.content.videoAsset?.durationSec ?? null,
    },
  }));

  const ready = readyRows
    .map((r) => toSummary(r, rules, now))
    .filter((c) => c.stage === "READY")
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
        (a.targetPublishDate?.getTime() ?? Infinity) - (b.targetPublishDate?.getTime() ?? Infinity) ||
        a.title.localeCompare(b.title),
    )
    .map((c) => ({
      id: c.id,
      title: c.title,
      contentType: c.contentType,
      stage: c.stage,
      platforms: c.platforms,
      thumbUrl: c.thumbUrl,
      durationSec: c.durationSec,
      target: c.targetPublishDate ? fmtShort(c.targetPublishDate, tz) : null,
    }));

  return {
    tz,
    todayKey,
    nowHour: Number(fmt(now, tz, "H")),
    nowMinute: Number(fmt(now, tz, "m")),
    view,
    anchor,
    platform: platform?.id ?? null,
    platformName: platform?.name ?? null,
    platforms,
    title: titleFor(view, anchor, keys),
    prevDate: view === "month" ? shiftMonth(anchor, -1) : addDaysToKey(anchor, view === "week" ? -7 : -1),
    nextDate: view === "month" ? shiftMonth(anchor, 1) : addDaysToKey(anchor, view === "week" ? 7 : 1),
    days,
    events,
    ready,
    bestTimes: best.slots,
    bestTimesBasedOn: best.posts,
  };
}
export type CalendarData = Awaited<ReturnType<typeof getCalendarData>>;
export type CalendarEvent = CalendarData["events"][number];
export type CalendarDay = CalendarData["days"][number];
export type ReadyItem = CalendarData["ready"][number];

/**
 * Average views per published post, grouped by the local weekday + hour it
 * went live (workspace timezone). Posts without analytics yet are skipped.
 */
async function getBestPostingTimes(tz: string, platformId: string | null) {
  const where = {
    status: "PUBLISHED",
    publishedAt: { not: null },
    ...(platformId ? { platformId } : {}),
  } satisfies Prisma.PublishingScheduleWhereInput;

  const [published, totals] = await Promise.all([
    db.publishingSchedule.findMany({ where, select: { id: true, platformId: true, publishedAt: true } }),
    db.analyticsSnapshot.groupBy({ by: ["scheduleId"], where: { schedule: { is: where } }, _sum: { views: true } }),
  ]);
  const views = new Map(totals.map((t) => [t.scheduleId, t._sum.views ?? 0]));

  const slots = new Map<string, { weekday: number; hour: number; views: number; posts: number; platforms: Set<string> }>();
  let posts = 0;
  for (const p of published) {
    const v = views.get(p.id);
    if (!p.publishedAt || v === undefined) continue;
    posts++;
    const weekday = Number(fmt(p.publishedAt, tz, "i")); // 1 = Monday … 7 = Sunday
    const hour = Number(fmt(p.publishedAt, tz, "H"));
    const key = `${weekday}-${hour}`;
    const slot = slots.get(key) ?? { weekday, hour, views: 0, posts: 0, platforms: new Set<string>() };
    slot.views += v;
    slot.posts++;
    slot.platforms.add(p.platformId);
    slots.set(key, slot);
  }

  const top = [...slots.values()]
    .map((s) => ({ ...s, avg: s.views / s.posts }))
    .sort((a, b) => b.avg - a.avg || b.posts - a.posts)
    .slice(0, 3)
    .map((s) => ({
      key: `${s.weekday}-${s.hour}`,
      label: `${WEEKDAYS[s.weekday - 1]} ${String(s.hour).padStart(2, "0")}:00`,
      avgViews: compactNumber(Math.round(s.avg)),
      posts: s.posts,
      platforms: [...s.platforms],
    }));
  return { slots: top, posts };
}
