import { db } from "@/lib/db";
import { dayDiff } from "@/lib/dates";
import { getProvider } from "@/lib/platforms/registry";
import { PublishError, type PublishMedia } from "@/lib/platforms/types";
import { storage } from "@/lib/storage";
import { isReadyToPost } from "@/lib/workflow/rules";
import { ActivityType, NotificationType } from "@/lib/workflow/statuses";
import { logActivity } from "./activity";
import { syncMockAnalytics } from "./analytics-sync";
import { contentStateSelect, toContentState } from "./content-state";
import { syncPublishingStatus } from "./content";
import { notify } from "./notifications";
import { getSettings, rulesFrom } from "./settings";

const STUCK_AFTER_MS = 15 * 60 * 1000;

type MediaRow = { fileName: string; mimeType: string; size: number; storageKey: string | null; externalUrl: string | null } | null;
const toPublishMedia = (m: MediaRow): PublishMedia | null =>
  m ? { fileName: m.fileName, mimeType: m.mimeType, size: m.size, localPath: m.storageKey ? storage.localPath(m.storageKey) : null, url: m.externalUrl } : null;

/** Publishes one schedule. Safe to call concurrently: the row is claimed atomically. */
export async function processSchedule(scheduleId: string) {
  const claimed = await db.publishingSchedule.updateMany({
    where: { id: scheduleId, status: { in: ["WAITING", "RETRY_SCHEDULED"] } },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return "skipped" as const;

  const s = await db.publishingSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
    include: {
      account: true,
      platform: true,
      thumbnailAsset: true,
      content: { select: { ...contentStateSelect, id: true, title: true, archivedAt: true, videoAsset: true, thumbnailAsset: true } },
    },
  });
  await syncPublishingStatus(s.contentId);
  const job = await db.publishingJob.create({ data: { scheduleId, attempt: s.attempts, status: "PROCESSING" } });
  const settings = await getSettings();

  try {
    const provider = getProvider(s.platformId);
    if (!provider) throw new PublishError(`No integration for platform "${s.platformId}".`, "VALIDATION", false);
    if (s.content.archivedAt) throw new PublishError("Content is archived.", "VALIDATION", false);
    if (!isReadyToPost(toContentState(s.content), rulesFrom(settings))) {
      throw new PublishError("Content is no longer Ready to Post (an asset or approval changed).", "VALIDATION", false);
    }

    const result = await provider.publish({
      scheduleId,
      account: {
        id: s.account.id,
        name: s.account.name,
        status: s.account.status,
        externalId: s.account.externalId,
        accessToken: s.account.accessToken,
        tokenExpiresAt: s.account.tokenExpiresAt,
      },
      title: s.title,
      caption: s.caption,
      hashtags: s.hashtags,
      visibility: s.visibility,
      video: toPublishMedia(s.content.videoAsset),
      thumbnail: toPublishMedia(s.thumbnailAsset ?? s.content.thumbnailAsset),
      options: JSON.parse(s.options || "{}") as Record<string, unknown>,
    });

    const now = new Date();
    await db.$transaction([
      db.publishingJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: now } }),
      db.publishingSchedule.update({
        where: { id: scheduleId },
        data: { status: "PUBLISHED", publishedAt: now, externalId: result.externalId, externalUrl: result.url, lastError: null, nextAttemptAt: null },
      }),
    ]);
    await logActivity({ contentId: s.contentId, type: ActivityType.PUBLISHED, message: `Published to ${s.platform.name} (${s.account.name})`, meta: { url: result.url } });
    await notify({
      type: NotificationType.PUBLISHED,
      title: "Successfully published",
      message: `"${s.content.title}" is live on ${s.platform.name}.`,
      href: `/content/${s.contentId}?tab=publishing`,
      dedupeKey: `published:${scheduleId}`,
    });
    await syncPublishingStatus(s.contentId);
    return "published" as const;
  } catch (e) {
    const err = e instanceof PublishError ? e : new PublishError(e instanceof Error ? e.message : "Unknown error", "UNKNOWN", true);
    const canRetry = err.retryable && settings.autoRetry && s.attempts < settings.maxRetries;
    const now = new Date();

    await db.$transaction([
      db.publishingJob.update({ where: { id: job.id }, data: { status: "FAILED", error: err.message, finishedAt: now } }),
      db.publishingSchedule.update({
        where: { id: scheduleId },
        data: canRetry
          ? { status: "RETRY_SCHEDULED", lastError: err.message, nextAttemptAt: new Date(now.getTime() + settings.retryDelayMinutes * 60_000) }
          : { status: "FAILED", lastError: err.message, nextAttemptAt: null },
      }),
    ]);
    if (err.code === "AUTH") {
      await db.socialAccount.update({ where: { id: s.accountId }, data: { status: "TOKEN_EXPIRED", lastError: err.message } });
    }
    await logActivity({
      contentId: s.contentId,
      type: ActivityType.PUBLISH_FAILED,
      message: canRetry ? `${s.platform.name} upload failed — retry scheduled` : `${s.platform.name} publishing failed`,
      meta: { error: err.message, code: err.code },
    });
    if (!canRetry) {
      await notify({
        type: NotificationType.PUBLISH_FAILED,
        title: "Publishing failed",
        message: `"${s.content.title}" could not be posted to ${s.account.name}: ${err.message}`,
        href: `/schedule?status=failed`,
        dedupeKey: `failed:${scheduleId}:${s.attempts}`,
      });
    }
    await syncPublishingStatus(s.contentId);
    return canRetry ? ("retry" as const) : ("failed" as const);
  }
}

/** Processes every post that is due. Returns a summary for logs / the UI. */
export async function processDueSchedules(now = new Date()) {
  // Recover posts stuck in PROCESSING (e.g. the server restarted mid-upload)
  await db.publishingSchedule.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
    data: { status: "RETRY_SCHEDULED", nextAttemptAt: now, lastError: "Publishing was interrupted; retrying." },
  });

  const due = await db.publishingSchedule.findMany({
    where: {
      OR: [
        { status: "WAITING", scheduledAt: { lte: now } },
        { status: "RETRY_SCHEDULED", nextAttemptAt: { lte: now } },
      ],
    },
    orderBy: { scheduledAt: "asc" },
    select: { id: true },
    take: 20,
  });
  const summary = { processed: 0, published: 0, failed: 0, retry: 0 };
  for (const { id } of due) {
    const r = await processSchedule(id);
    if (r === "skipped") continue;
    summary.processed++;
    summary[r === "published" ? "published" : r === "retry" ? "retry" : "failed"]++;
  }
  return summary;
}

/** Periodic housekeeping: token expiry, reminders, incomplete-asset warnings, analytics. */
export async function runMaintenance(now = new Date()) {
  const settings = await getSettings();
  const tz = settings.timezone;

  // Expired tokens
  const expired = await db.socialAccount.findMany({ where: { status: "CONNECTED", tokenExpiresAt: { lt: now } } });
  for (const a of expired) {
    await db.socialAccount.update({ where: { id: a.id }, data: { status: "TOKEN_EXPIRED" } });
    await notify({
      type: NotificationType.TOKEN_EXPIRED,
      title: "Token expired",
      message: `Reconnect "${a.name}" to keep publishing.`,
      href: "/accounts",
      dedupeKey: `token:${a.id}:${a.tokenExpiresAt?.toISOString()}`,
    });
  }
  // Waiting posts on disconnected accounts
  const blocked = await db.publishingSchedule.findMany({
    where: { status: "WAITING", account: { status: { not: "CONNECTED" } } },
    include: { account: true, content: { select: { title: true } } },
  });
  for (const s of blocked) {
    await notify({
      type: NotificationType.TOKEN_EXPIRED,
      title: "Account needs reconnecting",
      message: `"${s.content.title}" is scheduled on "${s.account.name}", which is not connected.`,
      href: "/accounts",
      dedupeKey: `blocked:${s.id}`,
    });
  }

  // Scheduled for tomorrow
  const soon = await db.publishingSchedule.findMany({
    where: { status: "WAITING", scheduledAt: { gte: now, lte: new Date(now.getTime() + 48 * 3_600_000) } },
    include: { platform: true, content: { select: { title: true } } },
  });
  for (const s of soon) {
    if (dayDiff(s.scheduledAt, now, tz) !== 1) continue;
    await notify({
      type: NotificationType.SCHEDULED_TOMORROW,
      title: "Scheduled for tomorrow",
      message: `"${s.content.title}" goes live on ${s.platform.name} tomorrow.`,
      href: "/calendar",
      dedupeKey: `tomorrow:${s.id}:${s.scheduledAt.toISOString()}`,
    });
  }

  // Target date close but assets incomplete
  const upcoming = await db.content.findMany({
    where: {
      archivedAt: null,
      publishingStatus: { in: ["DRAFT", "NOT_READY"] },
      targetPublishDate: { gte: now, lte: new Date(now.getTime() + 3 * 86_400_000) },
    },
    select: { id: true, title: true, targetPublishDate: true },
  });
  for (const c of upcoming) {
    await notify({
      type: NotificationType.INCOMPLETE_ASSETS,
      title: "Incomplete assets",
      message: `"${c.title}" is due soon but isn't ready to post yet.`,
      href: `/content/${c.id}`,
      dedupeKey: `incomplete:${c.id}:${c.targetPublishDate?.toISOString().slice(0, 10)}`,
    });
  }

  await syncMockAnalytics(now);
}
