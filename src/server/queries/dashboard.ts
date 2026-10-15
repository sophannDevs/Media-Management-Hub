import { actorLabel } from "@/lib/activity";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dayKey, dayRangeUtc, weekKeys } from "@/lib/dates";
import { mediaUrl } from "@/lib/media-url";
import { requirementsFromMask } from "@/lib/workflow/rules";
import { PIPELINE_STAGES, Priority, PRODUCTION_STAGES } from "@/lib/workflow/statuses";
import { getPageContext } from "./shared";

/** Lists on the dashboard show this many; each links to the full list. */
export const DASHBOARD_LIST = 6;
/** Posts per day in the week strip; the rest are behind "+N more" (the calendar's day view) */
export const WEEK_DAY_POSTS = 4;

const ACTIVE = ["WAITING", "RETRY_SCHEDULED", "PROCESSING"];
const utc = (d: Date) => Prisma.sql`(${d} AT TIME ZONE 'UTC')`;

type PostRow = {
  list: "upcoming" | "week" | "failed";
  id: string;
  status: string;
  platformId: string;
  scheduledAt: Date;
  lastError: string | null;
  simulated: boolean;
  accountName: string;
  contentId: string;
  title: string;
  contentType: string;
  storageKey: string | null;
  externalUrl: string | null;
  durationSec: number | null;
  /** Week strip: posts that day (only WEEK_DAY_POSTS of them are listed) */
  dayTotal: number;
};

type TaskRow = { list: "ready" | "incomplete"; id: string; title: string; priority: string; completion: number; missingMask: number };

/**
 * PERF-03: the dashboard reads counts, not rows. Stage counts come from a
 * GROUP BY on the stored stage, every other number from one query, and each
 * list is bounded, so the page costs the same at 50 or 5,000 items.
 */
export async function getDashboardData() {
  const { now, tz } = await getPageContext();
  const todayKey = dayKey(now, tz);
  const week = weekKeys(todayKey);
  const weekRange = dayRangeUtc(week[0], week[6], tz);
  const todayRange = dayRangeUtc(todayKey, todayKey, tz);
  const monthStart = new Date(`${todayKey.slice(0, 7)}-01T00:00:00Z`);
  const priorityRank = Prisma.sql`COALESCE(array_position(${Priority.codes}::text[], "priority"), 99)`;
  const live = Prisma.sql`c."archivedAt" IS NULL`;

  const [stageRows, [n], posts, tasks, activity] = await Promise.all([
    db.content.groupBy({ by: ["stage"], where: { archivedAt: null }, _count: { _all: true } }),
    db.$queryRaw<
      {
        failedPosts: number;
        scheduledToday: number;
        scheduledThisWeek: number;
        monthViews: number;
        monthViewsSimulated: boolean;
        publishedSimulated: number;
        accountIssues: { id: string; name: string; status: string; platformId: string }[] | null;
      }[]
    >`
      SELECT
        (SELECT COUNT(*)::int FROM "PublishingSchedule" s JOIN "Content" c ON c."id" = s."contentId" WHERE s."status" = 'FAILED' AND ${live}) AS "failedPosts",
        (SELECT COUNT(*)::int FROM "PublishingSchedule" s JOIN "Content" c ON c."id" = s."contentId"
          WHERE s."status" NOT IN ('CANCELLED', 'PUBLISHED') AND ${live}
            AND s."scheduledAt" >= ${utc(todayRange.gte)} AND s."scheduledAt" < ${utc(todayRange.lt)}) AS "scheduledToday",
        (SELECT COUNT(*)::int FROM "PublishingSchedule" s JOIN "Content" c ON c."id" = s."contentId"
          WHERE s."status" NOT IN ('CANCELLED', 'PUBLISHED') AND ${live}
            AND s."scheduledAt" >= ${utc(now)} AND s."scheduledAt" < ${utc(weekRange.lt)}) AS "scheduledThisWeek",
        (SELECT COALESCE(SUM("views"), 0)::int FROM "AnalyticsSnapshot" WHERE "date" >= ${utc(monthStart)}) AS "monthViews",
        EXISTS (SELECT 1 FROM "AnalyticsSnapshot" WHERE "date" >= ${utc(monthStart)} AND "source" = 'MOCK') AS "monthViewsSimulated",
        -- Content at stage Published whose posts were all simulated
        (SELECT COUNT(*)::int FROM "Content" c WHERE ${live} AND c."stage" = 'PUBLISHED'
          AND NOT EXISTS (SELECT 1 FROM "PublishingSchedule" s WHERE s."contentId" = c."id" AND s."status" = 'PUBLISHED' AND NOT s."simulated")) AS "publishedSimulated",
        (SELECT json_agg(json_build_object('id', "id", 'name', "name", 'status', "status", 'platformId', "platformId") ORDER BY "name")
          FROM "SocialAccount" WHERE "status" <> 'CONNECTED') AS "accountIssues"`,
    // Next posts, this week's posts (a few per day) and the latest failures, with what their cards show
    db.$queryRaw<PostRow[]>`
      WITH p AS NOT MATERIALIZED (
        SELECT s."id", s."status", s."platformId", s."scheduledAt", s."lastError", s."simulated", a."name" AS "accountName",
          c."id" AS "contentId", c."title", c."contentType", m."storageKey", m."externalUrl", v."durationSec"
        FROM "PublishingSchedule" s
        JOIN "SocialAccount" a ON a."id" = s."accountId"
        JOIN "Content" c ON c."id" = s."contentId"
        LEFT JOIN "MediaAsset" m ON m."id" = c."coverAssetId"
        LEFT JOIN "MediaAsset" v ON v."id" = c."videoAssetId"
        WHERE ${live}
      ),
      week AS (
        SELECT p.*,
          ROW_NUMBER() OVER (PARTITION BY day ORDER BY "scheduledAt", "id") AS nth,
          COUNT(*) OVER (PARTITION BY day)::int AS "dayTotal"
        FROM p, LATERAL (SELECT ((p."scheduledAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date AS day) d
        WHERE "status" <> 'CANCELLED' AND "scheduledAt" >= ${utc(weekRange.gte)} AND "scheduledAt" < ${utc(weekRange.lt)}
      )
      (SELECT 'upcoming' AS "list", p.*, 0 AS "dayTotal" FROM p
        WHERE "status" IN (${Prisma.join(ACTIVE)}) AND "scheduledAt" >= ${utc(todayRange.gte)}
        ORDER BY "scheduledAt", "id" LIMIT ${DASHBOARD_LIST})
      UNION ALL
      (SELECT 'week', "id", "status", "platformId", "scheduledAt", "lastError", "simulated", "accountName",
          "contentId", "title", "contentType", "storageKey", "externalUrl", "durationSec", "dayTotal"
        FROM week WHERE nth <= ${WEEK_DAY_POSTS})
      UNION ALL
      (SELECT 'failed', p.*, 0 FROM p WHERE "status" = 'FAILED' ORDER BY "scheduledAt" DESC, "id" LIMIT ${DASHBOARD_LIST})`,
    // Ready to schedule, and in production: most urgent first
    db.$queryRaw<TaskRow[]>`
      (SELECT 'ready' AS "list", "id", "title", "priority", "completion", "missingMask" FROM "Content"
        WHERE "archivedAt" IS NULL AND "stage" = 'READY'
        ORDER BY ${priorityRank}, "targetPublishDate" NULLS LAST, "id" LIMIT ${DASHBOARD_LIST})
      UNION ALL
      (SELECT 'incomplete', "id", "title", "priority", "completion", "missingMask" FROM "Content"
        WHERE "archivedAt" IS NULL AND "stage" IN (${Prisma.join(PRODUCTION_STAGES)})
        ORDER BY ${priorityRank}, "targetPublishDate" NULLS LAST, "id" LIMIT ${DASHBOARD_LIST})`,
    // Content work only: the workspace's own changes (accounts, settings) are on the Settings page (DB-05)
    db.activityLog.findMany({
      where: { contentId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, message: true, createdAt: true, source: true, actor: { select: { name: true } }, content: { select: { id: true, title: true } } },
    }),
  ]);

  const byStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])) as Record<string, number>;
  for (const r of stageRows) byStage[r.stage] = r._count._all;
  const total = stageRows.reduce((sum, r) => sum + r._count._all, 0);
  const inProduction = PRODUCTION_STAGES.reduce((sum, s) => sum + (byStage[s] ?? 0), 0);

  const card = (s: PostRow) => ({
    id: s.id,
    status: s.status,
    platformId: s.platformId,
    scheduledAt: s.scheduledAt,
    accountName: s.accountName,
    lastError: s.lastError,
    simulated: s.simulated,
    dayTotal: s.dayTotal,
    content: { id: s.contentId, title: s.title, contentType: s.contentType, thumbUrl: mediaUrl(s), durationSec: s.durationSec },
  });
  const task = (t: TaskRow) => ({ id: t.id, title: t.title, priority: t.priority, completion: t.completion, missing: requirementsFromMask(t.missingMask) });

  return {
    now,
    tz,
    todayKey,
    week,
    counts: {
      total,
      ideas: byStage.IDEA,
      script: byStage.SCRIPT,
      images: byStage.IMAGES,
      video: byStage.VIDEO,
      review: byStage.REVIEW,
      inProduction,
      ready: byStage.READY,
      scheduled: byStage.SCHEDULED,
      published: byStage.PUBLISHED,
      failedPosts: n.failedPosts,
      scheduledToday: n.scheduledToday,
      scheduledThisWeek: n.scheduledThisWeek,
      monthViews: n.monthViews,
      /** Some of this month's views were generated for simulated posts */
      monthViewsSimulated: n.monthViewsSimulated,
      /** Content at stage Published whose posts were all simulated */
      publishedSimulated: n.publishedSimulated,
    },
    byStage,
    ready: tasks.filter((t) => t.list === "ready").map(task),
    incomplete: tasks.filter((t) => t.list === "incomplete").map(task),
    upcoming: posts.filter((p) => p.list === "upcoming").map(card),
    /** The first WEEK_DAY_POSTS of each day; dayTotal says how many that day has */
    weekSchedules: posts.filter((p) => p.list === "week").map(card),
    failed: posts.filter((p) => p.list === "failed").map(card),
    accountIssues: n.accountIssues ?? [],
    activity: activity.map((a) => ({ ...a, by: actorLabel(a) })),
  };
}
export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
