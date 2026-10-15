import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDaysToKey, dayKey, dayRangeUtc, fmtDate, fmtDateTime, fmtShort, fmtTime, relativeDay, timeAgo, weekKeys } from "@/lib/dates";
import { mediaUrl } from "@/lib/media-url";
import { providerMeta } from "@/lib/platforms/registry";
import { checklist, completion, deriveStage, imageStage, isReadyToPost, missingRequirements } from "@/lib/workflow/rules";
import { Priority, PRODUCTION_STAGES, Stage } from "@/lib/workflow/statuses";
import { isClaudeConfigured } from "@/lib/ai/claude";
import { type ContentListParams, type ContentSort, parseSort, type SortDir } from "@/lib/content-list";
import { requireUser } from "../auth/dal";
import { toContentState } from "../services/content-state";
import { getSettings } from "../services/settings";
import { listViews } from "../services/views";
import { contentSummarySelect, getContentFormOptions, getPageContext, onlySimulatedPosts, toSummary } from "./shared";

// ---------- List ----------

export type { ContentListParams };

export const PAGE_SIZE = 50;

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

/** SQL sort key of each sortable column, over `c` (Content) and `n` (next post). */
const SORT_KEYS: Record<ContentSort, (dir: SortDir) => Prisma.Sql> = {
  updated: () => Prisma.sql`c."updatedAt"`,
  created: () => Prisma.sql`c."createdAt"`,
  title: () => Prisma.sql`lower(c."title")`,
  priority: () => Prisma.sql`COALESCE(array_position(${Priority.codes}::text[], c."priority"), 99)`,
  stage: () => Prisma.sql`COALESCE(array_position(${Stage.codes}::text[], c."stage"), 99)`,
  completion: () => Prisma.sql`c."completion"`,
  // Items without an upcoming post come last in both directions
  next: (dir) => (dir === "asc" ? Prisma.sql`COALESCE(n."at", 'infinity')` : Prisma.sql`COALESCE(n."at", '-infinity')`),
};

const ACTIVE_POSTS = ["WAITING", "RETRY_SCHEDULED", "PROCESSING"];

/** `n."at"`: the next post still waiting, retrying or publishing (posts more than a day overdue don't count). */
const nextPostJoin = (since: Date) => Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT MIN(s."scheduledAt") AS "at" FROM "PublishingSchedule" s
    WHERE s."contentId" = c."id" AND s."status" IN (${Prisma.join(ACTIVE_POSTS)})
      AND s."scheduledAt" >= (${since} AT TIME ZONE 'UTC')
  ) n ON true`;

/** The list filters as SQL over `c` and `n`, except the stage (the counts group by it). */
function filterSql(params: ContentListParams, now: Date, tz: string) {
  const parts = [Prisma.sql`c."archivedAt" IS NULL`];
  const q = params.q?.trim();
  if (q) {
    // Case-insensitive substring; % and _ in the search are literal
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    parts.push(Prisma.sql`(c."title" ILIKE ${like} OR c."description" ILIKE ${like} OR c."idea" ILIKE ${like}
      OR EXISTS (SELECT 1 FROM "_ContentToTag" ct JOIN "Tag" t ON t."id" = ct."B" WHERE ct."A" = c."id" AND t."name" ILIKE ${like}))`);
  }
  if (params.platform) parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "ContentPlatform" cp WHERE cp."contentId" = c."id" AND cp."platformId" = ${params.platform})`);
  if (params.category) parts.push(Prisma.sql`c."categoryId" = ${params.category}`);
  if (params.priority) parts.push(Prisma.sql`c."priority" = ${params.priority}`);
  if (params.created === "7" || params.created === "30") {
    parts.push(Prisma.sql`c."createdAt" >= (${new Date(now.getTime() - Number(params.created) * 86_400_000)} AT TIME ZONE 'UTC')`);
  }
  // "Scheduled" works on the next upcoming post, in the workspace timezone
  const today = dayKey(now, tz);
  const thisWeek = weekKeys(today);
  const range =
    params.scheduled === "week" ? dayRangeUtc(today, thisWeek[6], tz) : params.scheduled === "next" ? dayRangeUtc(addDaysToKey(thisWeek[6], 1), addDaysToKey(thisWeek[6], 7), tz) : null;
  if (params.scheduled === "none") parts.push(Prisma.sql`n."at" IS NULL`);
  if (range) parts.push(Prisma.sql`n."at" >= (${range.gte} AT TIME ZONE 'UTC') AND n."at" < (${range.lt} AT TIME ZONE 'UTC')`);
  return Prisma.join(parts, " AND ");
}

function stageSql(stage: string) {
  if (stage === "ALL") return Prisma.sql`TRUE`;
  if (stage === "PRODUCTION") return Prisma.sql`c."stage" IN (${Prisma.join(PRODUCTION_STAGES)})`;
  return Prisma.sql`c."stage" = ${stage}`;
}

/**
 * One page of the list (PERF-01): filtering, sorting, counting and paging run
 * in SQL on the stored stage (WF-03), so the cost doesn't grow with the
 * library. Paging is by keyset: `after` / `before` name the row the page
 * starts after / ends before, and its sort key is read from the row itself.
 */
export async function getContentList(params: ContentListParams) {
  const ctx = await getPageContext();
  const [page, views] = await Promise.all([listPage(params, ctx), listViews((await requireUser()).id)]);
  // The row a link paged from was deleted (or nothing is left past it): start over
  return { ...(page ?? (await listPage({ ...params, after: undefined, before: undefined }, ctx))!), views };
}

async function listPage(params: ContentListParams, { now, tz }: { now: Date; tz: string }) {
  const { sort, dir } = parseSort(params);
  const stageFilter = params.stage?.toUpperCase() || "ALL";
  // The next-post join only when something reads n."at"
  const join = sort === "next" || params.scheduled ? nextPostJoin(new Date(now.getTime() - 86_400_000)) : Prisma.empty;
  const filters = filterSql(params, now, tz);
  const key = SORT_KEYS[sort](dir);

  const cursor = params.after ?? params.before ?? null;
  const backwards = !params.after && !!params.before;
  // Walking backwards reads the page in reverse order, then flips it
  const forward = backwards ? (dir === "asc" ? "desc" : "asc") : dir;
  const order = forward === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const beyond = forward === "asc" ? Prisma.sql`>` : Prisma.sql`<`;

  const pageQuery = db.$queryRaw<{ id: string }[]>`
    WITH base AS (
      SELECT c."id", ${key} AS k FROM "Content" c ${join}
      WHERE ${filters} AND ${stageSql(stageFilter)}
    ),
    cur AS (SELECT ${key} AS k, c."id" FROM "Content" c ${join} WHERE c."id" = ${cursor})
    SELECT b."id" FROM base b
    WHERE ${cursor}::text IS NULL OR (b.k, b."id") ${beyond} (SELECT k, "id" FROM cur)
    ORDER BY b.k ${order}, b."id" ${order}
    LIMIT ${PAGE_SIZE + 1}`;
  const countsQuery = db.$queryRaw<{ stage: string; n: number }[]>`
    SELECT c."stage", COUNT(*)::int AS n FROM "Content" c ${join} WHERE ${filters} GROUP BY c."stage"`;
  const [pageRows, stageRows, options] = await Promise.all([pageQuery, countsQuery, getContentFormOptions()]);
  if (cursor && !pageRows.length) return null;

  const more = pageRows.length > PAGE_SIZE;
  const ids = pageRows.slice(0, PAGE_SIZE).map((r) => r.id);
  if (backwards) ids.reverse();

  const byStage = new Map(stageRows.map((r) => [r.stage, r.n]));
  const sum = (stages: readonly string[]) => stages.reduce((n, s) => n + (byStage.get(s) ?? 0), 0);
  const counts = Object.fromEntries(
    QUICK_FILTERS.map((f) => [f.key, f.key === "ALL" ? sum([...byStage.keys()]) : f.key === "PRODUCTION" ? sum(PRODUCTION_STAGES) : sum([f.key])]),
  ) as Record<string, number>;
  const matching = stageFilter === "ALL" ? counts.ALL : stageFilter === "PRODUCTION" ? counts.PRODUCTION : sum([stageFilter]);

  // Position of the page, for "51–100 of 873": rows sorted before its first one
  let offset = 0;
  if (cursor && ids.length) {
    const before = dir === "asc" ? Prisma.sql`<` : Prisma.sql`>`;
    const [{ n }] = await db.$queryRaw<{ n: number }[]>`
      WITH base AS (
        SELECT c."id", ${key} AS k FROM "Content" c ${join}
        WHERE ${filters} AND ${stageSql(stageFilter)}
      )
      SELECT COUNT(*)::int AS n FROM base b WHERE (b.k, b."id") ${before} (SELECT k, "id" FROM base WHERE "id" = ${ids[0]})`;
    offset = n;
  }

  // One statement with the relations joined in, not one per relation (the page budget is 12 queries)
  const rows = ids.length ? await db.content.findMany({ where: { id: { in: ids } }, select: contentSummarySelect, relationLoadStrategy: "join" }) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const c = toSummary(r, now);
    return [
      {
        ...c,
        createdLabel: fmtShort(c.createdAt, tz),
        targetLabel: c.targetPublishDate ? fmtShort(c.targetPublishDate, tz) : null,
        next: c.nextSchedule
          ? { platformId: c.nextSchedule.platformId, day: relativeDay(c.nextSchedule.scheduledAt, now, tz), time: fmtTime(c.nextSchedule.scheduledAt, tz), status: c.nextSchedule.status }
          : null,
      },
    ];
  });

  return {
    stageFilter,
    sort,
    dir,
    counts,
    options,
    items,
    page: {
      from: items.length ? offset + 1 : 0,
      to: offset + items.length,
      matching,
      /** Cursor for the previous / next page, or null at either end */
      prev: items.length && (backwards ? more : !!cursor) ? items[0].id : null,
      next: items.length && (backwards ? true : more) ? items[items.length - 1].id : null,
    },
  };
}
export type ContentListData = Awaited<ReturnType<typeof getContentList>>;
export type ContentListItem = ContentListData["items"][number];

export const PICKER_LIMIT = 20;

/**
 * Title search for content pickers (PERF-11): the most recently updated
 * matches, ready to post first unless `readyFirst` is off. Readiness is the
 * stored state, so this costs the same at any library size.
 */
export async function searchContentOptions(q: string, { readyFirst = true, limit = PICKER_LIMIT } = {}) {
  const term = q.trim().slice(0, 200);
  const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db.$queryRaw<{ id: string; title: string; missingMask: number; stage: string }[]>`
    SELECT "id", "title", "missingMask", "stage" FROM "Content"
    WHERE "archivedAt" IS NULL AND (${term} = '' OR "title" ILIKE ${like})
    ORDER BY ${readyFirst ? Prisma.sql`("missingMask" = 0) DESC,` : Prisma.empty} "updatedAt" DESC, "id"
    LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, title: r.title, ready: r.missingMask === 0, stage: r.stage }));
}
export type ContentOption = Awaited<ReturnType<typeof searchContentOptions>>[number];

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

// ---------- Workspace: activity history and script version text (PERF-05) ----------

export const ACTIVITY_PAGE = 50;
const ACTIVITY_ORDER = [{ createdAt: "desc" }, { id: "desc" }] satisfies Prisma.ActivityLogOrderByWithRelationInput[];

type ActivityRow = { id: string; type: string; message: string; createdAt: Date };
const toActivity = (a: ActivityRow, tz: string) => ({ id: a.id, type: a.type, message: a.message, day: fmtDate(a.createdAt, tz), time: fmtTime(a.createdAt, tz) });

/** A page of rows plus the cursor (the last row's id) of the next one, from a query that fetched one extra. */
function pageOf<T extends { id: string }>(rows: T[]) {
  const items = rows.slice(0, ACTIVITY_PAGE);
  return { items, nextCursor: rows.length > ACTIVITY_PAGE ? items[items.length - 1].id : null };
}

/** The next page of a content item's history, after the row with id `after` (keyset: stable while new events arrive). */
export async function getActivityPage(contentId: string, after: string | null) {
  const { timezone: tz } = await getSettings();
  const rows = await db.activityLog.findMany({
    where: { contentId },
    orderBy: ACTIVITY_ORDER,
    take: ACTIVITY_PAGE + 1,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    select: { id: true, type: true, message: true, createdAt: true },
  });
  const { items, nextCursor } = pageOf(rows);
  return { items: items.map((a) => toActivity(a, tz)), nextCursor };
}

/** The full text of one saved script version, or null. */
export async function getScriptVersionBody(versionId: string) {
  return db.scriptVersion.findUnique({ where: { id: versionId }, select: { body: true } });
}
export type ActivityPage = Awaited<ReturnType<typeof getActivityPage>>;

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
      // Version metadata only: the text of each version is fetched when it is opened (PERF-05)
      script: { include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, note: true, status: true, source: true, wordCount: true, createdAt: true } } } },
      scriptDraft: { select: { body: true, baseVersion: true, updatedAt: true } },
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
      // One page of the history; the rest loads on demand (PERF-05). One extra row says whether there is more.
      activities: { orderBy: ACTIVITY_ORDER, take: ACTIVITY_PAGE + 1 },
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
      /** A post is being sent or due within two minutes: the page refreshes itself (PUB-06) */
      inFlight: c.schedules.some(
        (s) =>
          s.status === "PROCESSING" ||
          (s.status === "WAITING" && s.scheduledAt.getTime() <= now.getTime() + 120_000) ||
          (s.status === "RETRY_SCHEDULED" && !!s.nextAttemptAt && s.nextAttemptAt.getTime() <= now.getTime() + 120_000),
      ),
    },
    script: {
      body: c.script?.body ?? "",
      currentVersion: c.script?.currentVersion ?? 0,
      updatedLabel: c.script ? fmtDateTime(c.script.updatedAt, tz) : null,
      // Unsaved text autosaved earlier (UX-03). Only a draft that still applies: started from the current version and different from it
      draft:
        c.scriptDraft && c.scriptDraft.baseVersion === (c.script?.currentVersion ?? 0) && c.scriptDraft.body !== (c.script?.body ?? "")
          ? { body: c.scriptDraft.body, at: c.scriptDraft.updatedAt.getTime() }
          : null,
      versions: (c.script?.versions ?? []).map((v) => ({
        id: v.id,
        version: v.version,
        note: v.note,
        status: v.status,
        source: v.source,
        words: v.wordCount,
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
    activity: (() => {
      const { items, nextCursor } = pageOf(c.activities);
      return { items: items.map((a) => toActivity(a, tz)), nextCursor };
    })(),
    settings: { timezone: settings.timezone },
  };
}
export type ContentWorkspace = NonNullable<Awaited<ReturnType<typeof getContentWorkspace>>>;
