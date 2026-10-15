import { db } from "@/lib/db";
import { isClaudeConfigured } from "@/lib/ai/claude";
import { actorLabel } from "@/lib/activity";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { mediaUrl } from "@/lib/media-url";
import { NOTIFICATION_LABELS, type NotificationTypeCode } from "@/lib/workflow/statuses";
import { notificationPrefs } from "../services/settings";
import { workerStatus } from "../worker";
import { getPageContext } from "./shared";

const usage = { _count: { select: { contents: true } } } as const;
const toItem = (t: { id: string; name: string; _count: { contents: number } }) => ({ id: t.id, name: t.name, count: t._count.contents });

/** The publishing worker as its heartbeats show it (PUB-11), and whether the cron trigger is on. */
async function workerInfo(now: Date) {
  const s = await workerStatus(now);
  return {
    running: s.live > 0,
    live: s.live,
    mode: s.mode,
    lastSeenSecondsAgo: s.lastBeatAt ? Math.max(0, Math.round((now.getTime() - s.lastBeatAt.getTime()) / 1000)) : null,
    intervalSeconds: s.intervalSeconds,
    cronEnabled: Boolean(process.env.CRON_SECRET?.trim()),
  };
}

/** Which integration env vars are present — never their values. */
function aiInfo() {
  const configured = isClaudeConfigured();
  return {
    claude: {
      configured,
      via: process.env.ANTHROPIC_API_KEY?.trim() ? "ANTHROPIC_API_KEY" : configured ? "ANTHROPIC_AUTH_TOKEN" : null,
      model: process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5",
    },
  };
}

export async function getSettingsData() {
  const { settings, rules, tz, now } = await getPageContext();
  const [categories, series, campaigns, archived, worker, activity] = await Promise.all([
    db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, ...usage } }),
    db.series.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, ...usage } }),
    db.campaign.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, ...usage } }),
    db.content.findMany({
      where: { archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      select: {
        id: true,
        title: true,
        contentType: true,
        archivedAt: true,
        category: { select: { name: true } },
        coverAsset: { select: { storageKey: true, externalUrl: true } },
        // Posts archiving took out of the queue (WF-07)
        _count: { select: { schedules: { where: { status: "CANCELLED", archivedStatus: { not: null } } } } },
      },
    }),
    workerInfo(now),
    // The workspace's own history (DB-05): everything not tied to a content item
    db.activityLog.findMany({
      where: { contentId: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: { id: true, type: true, message: true, createdAt: true, source: true, actor: { select: { name: true } } },
    }),
  ]);

  const prefs = notificationPrefs(settings);
  const types = Object.keys(NOTIFICATION_LABELS) as NotificationTypeCode[];

  return {
    workspace: { workspaceName: settings.workspaceName, timezone: settings.timezone, defaultLanguage: settings.defaultLanguage },
    rules,
    publishing: { autoRetry: settings.autoRetry, maxRetries: settings.maxRetries, retryDelayMinutes: settings.retryDelayMinutes },
    // Missing preference = on
    notifications: Object.fromEntries(types.map((t) => [t, prefs[t] !== false])) as Record<NotificationTypeCode, boolean>,
    taxonomies: {
      category: categories.map(toItem),
      series: series.map(toItem),
      campaign: campaigns.map(toItem),
    },
    archived: archived.map((c) => ({
      id: c.id,
      title: c.title,
      contentType: c.contentType,
      category: c.category?.name ?? null,
      thumbUrl: mediaUrl(c.coverAsset),
      archivedLabel: c.archivedAt ? fmtDate(c.archivedAt, tz) : "",
      pausedPosts: c._count.schedules,
    })),
    worker,
    ai: aiInfo(),
    activity: activity.map((a) => ({ id: a.id, type: a.type, message: a.message, when: fmtDateTime(a.createdAt, tz), by: actorLabel(a) })),
  };
}

export type SettingsData = Awaited<ReturnType<typeof getSettingsData>>;
export type TaxonomyItem = SettingsData["taxonomies"]["category"][number];
export type ArchivedItem = SettingsData["archived"][number];
