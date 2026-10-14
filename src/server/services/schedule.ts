import { db } from "@/lib/db";
import { zonedToUtc } from "@/lib/dates";
import { getProvider } from "@/lib/platforms/registry";
import { normalizeHashtags, validateSchedule } from "@/lib/workflow/rules";
import { ActivityType } from "@/lib/workflow/statuses";
import { ServiceError } from "../errors";
import { logActivity } from "./activity";
import { getReadiness, syncPublishingStatus } from "./content";

export interface ScheduleInput {
  contentId: string;
  platformId: string;
  accountId: string;
  /** Wall-clock date/time in `timezone` */
  date: string;
  time: string;
  timezone: string;
  title: string;
  caption?: string;
  hashtags?: string;
  thumbnailAssetId?: string | null;
  visibility?: string;
}

async function validate(input: ScheduleInput) {
  const provider = getProvider(input.platformId);
  const platform = await db.platform.findUnique({ where: { id: input.platformId } });
  const account = input.accountId ? await db.socialAccount.findUnique({ where: { id: input.accountId } }) : null;
  const readiness = await getReadiness(input.contentId);
  let scheduledAt: Date | null = null;
  try {
    scheduledAt = zonedToUtc(input.date, input.time, input.timezone);
  } catch {
    scheduledAt = null;
  }

  const errors = validateSchedule({
    contentReady: readiness.ready,
    missing: readiness.missing,
    platformId: input.platformId,
    platformEnabled: !!platform?.enabled && !!provider,
    account: account ? { status: account.status, platformId: account.platformId, name: account.name } : null,
    scheduledAt,
    now: new Date(),
    title: input.title,
    maxTitleLength: provider?.maxTitleLength,
  });
  if (provider && input.caption && input.caption.length > provider.maxCaptionLength) {
    errors.push(`${provider.captionLabel} must be ${provider.maxCaptionLength} characters or less.`);
  }
  if (provider && input.visibility && !provider.visibilityOptions.some((v) => v.value === input.visibility)) {
    errors.push("Invalid visibility option.");
  }
  if (input.thumbnailAssetId) {
    const t = await db.mediaAsset.findUnique({ where: { id: input.thumbnailAssetId }, select: { contentId: true } });
    if (!t || t.contentId !== input.contentId) errors.push("Thumbnail must belong to this content.");
  }
  if (errors.length) throw new ServiceError("Can't schedule this post yet.", errors);
  return { provider: provider!, scheduledAt: scheduledAt!, account: account! };
}

export async function createSchedule(input: ScheduleInput) {
  const { provider, scheduledAt, account } = await validate(input);
  const schedule = await db.publishingSchedule.create({
    data: {
      contentId: input.contentId,
      platformId: input.platformId,
      accountId: input.accountId,
      scheduledAt,
      timezone: input.timezone,
      title: input.title.trim(),
      caption: input.caption ?? "",
      hashtags: normalizeHashtags(input.hashtags ?? ""),
      thumbnailAssetId: input.thumbnailAssetId || null,
      visibility: input.visibility || provider.defaultVisibility,
    },
  });
  // Make sure the platform is listed as a target of the content
  await db.contentPlatform.upsert({
    where: { contentId_platformId: { contentId: input.contentId, platformId: input.platformId } },
    update: {},
    create: { contentId: input.contentId, platformId: input.platformId },
  });
  await logActivity({
    contentId: input.contentId,
    type: ActivityType.SCHEDULE_CREATED,
    message: `Scheduled for ${provider.name} (${account.name}) — ${input.date} ${input.time}`,
    meta: { scheduleId: schedule.id },
  });
  await syncPublishingStatus(input.contentId);
  return schedule;
}

export async function updateSchedule(id: string, input: ScheduleInput) {
  const existing = await db.publishingSchedule.findUnique({ where: { id } });
  if (!existing) throw new ServiceError("Schedule not found.");
  if (existing.status === "PUBLISHED" || existing.status === "PROCESSING") {
    throw new ServiceError("This post is already being published and can't be edited.");
  }
  const { provider, scheduledAt } = await validate({ ...input, contentId: existing.contentId });
  await db.publishingSchedule.update({
    where: { id },
    data: {
      platformId: input.platformId,
      accountId: input.accountId,
      scheduledAt,
      timezone: input.timezone,
      title: input.title.trim(),
      caption: input.caption ?? "",
      hashtags: normalizeHashtags(input.hashtags ?? ""),
      thumbnailAssetId: input.thumbnailAssetId || null,
      visibility: input.visibility || provider.defaultVisibility,
      // Editing a failed/cancelled post puts it back in the queue
      status: "WAITING",
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    },
  });
  await logActivity({
    contentId: existing.contentId,
    type: ActivityType.SCHEDULE_CHANGED,
    message: `${provider.name} schedule changed to ${input.date} ${input.time}`,
    meta: { scheduleId: id },
  });
  await syncPublishingStatus(existing.contentId);
}

/** Moves a post to a new time, keeping all other settings (used by calendar drag & drop). */
export async function reschedule(id: string, scheduledAt: Date) {
  const s = await db.publishingSchedule.findUnique({ where: { id }, include: { platform: true, account: true } });
  if (!s) throw new ServiceError("Schedule not found.");
  if (["PUBLISHED", "PROCESSING"].includes(s.status)) throw new ServiceError("Published posts can't be moved.");
  if (scheduledAt.getTime() <= Date.now()) throw new ServiceError("Scheduled time must be in the future.");
  if (s.account.status !== "CONNECTED") throw new ServiceError(`Reconnect "${s.account.name}" before rescheduling.`);

  await db.publishingSchedule.update({
    where: { id },
    data: { scheduledAt, status: "WAITING", attempts: 0, nextAttemptAt: null, lastError: null },
  });
  await logActivity({
    contentId: s.contentId,
    type: ActivityType.SCHEDULE_CHANGED,
    message: `${s.platform.name} post rescheduled`,
    meta: { scheduleId: id, from: s.scheduledAt, to: scheduledAt },
  });
  await syncPublishingStatus(s.contentId);
}

export async function cancelSchedule(id: string) {
  const s = await db.publishingSchedule.findUnique({ where: { id }, include: { platform: true } });
  if (!s) throw new ServiceError("Schedule not found.");
  if (s.status === "PUBLISHED") throw new ServiceError("Published posts can't be cancelled.");
  if (s.status === "PROCESSING") throw new ServiceError("This post is publishing right now.");
  await db.publishingSchedule.update({ where: { id }, data: { status: "CANCELLED", nextAttemptAt: null } });
  await logActivity({ contentId: s.contentId, type: ActivityType.SCHEDULE_CANCELLED, message: `${s.platform.name} post cancelled` });
  await syncPublishingStatus(s.contentId);
}

/** Puts a failed post back in the queue for immediate processing. */
export async function retrySchedule(id: string) {
  const s = await db.publishingSchedule.findUnique({ where: { id }, include: { account: true } });
  if (!s) throw new ServiceError("Schedule not found.");
  if (!["FAILED", "RETRY_SCHEDULED", "CANCELLED"].includes(s.status)) throw new ServiceError("Only failed posts can be retried.");
  if (s.account.status !== "CONNECTED") throw new ServiceError(`Reconnect "${s.account.name}" before retrying.`);
  await db.publishingSchedule.update({
    where: { id },
    data: { status: "RETRY_SCHEDULED", nextAttemptAt: new Date(), attempts: 0 },
  });
  await syncPublishingStatus(s.contentId);
}
