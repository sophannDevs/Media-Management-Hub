import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fmtDateTime, zonedToUtc } from "@/lib/dates";
import { getProvider } from "@/lib/platforms/registry";
import { normalizeHashtags, type Requirement, scheduleActiveKey, validateSchedule } from "@/lib/workflow/rules";
import { ActivityType, ScheduleStatus } from "@/lib/workflow/statuses";
import { currentUserId } from "../auth/actor";
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
  /** Generated when the form opens: resubmitting the same form returns the post it already created. */
  idempotencyKey?: string;
  /** Post again to an account that already published this content. */
  repost?: boolean;
  /** Schedule before "Ready to Post", waiving the missing soft requirements (WF-01). */
  override?: { reason: string } | null;
}

const NO_OVERRIDE = { overrideRules: Prisma.DbNull, overrideReason: null, overrideAt: null, overrideBy: null };

/** Override columns for a post (the waived soft requirements), or all null when nothing is waived. */
function overrideData(missing: Requirement[], override: ScheduleInput["override"]) {
  const waived = missing.filter((m) => !m.hard).map((m) => m.key);
  if (!override || !waived.length) return { columns: NO_OVERRIDE, waived: [] as string[] };
  return { columns: { overrideRules: waived, overrideReason: override.reason.trim(), overrideAt: new Date(), overrideBy: currentUserId() }, waived };
}

async function logOverride(contentId: string, scheduleId: string, platform: string, missing: Requirement[], reason: string) {
  const waived = missing.filter((m) => !m.hard);
  await logActivity({
    contentId,
    type: ActivityType.SCHEDULE_OVERRIDE,
    message: `${platform} post scheduled before Ready to Post. Reason: “${reason.trim()}”. Waived: ${waived.map((m) => m.label.toLowerCase()).join(", ")}.`,
    meta: { scheduleId, waived: waived.map((m) => m.key), reason: reason.trim() },
  });
}

// Every user-side change is conditional on the status the user saw, so a post
// the worker has just claimed (PROCESSING) is never reset, moved or cancelled
// under it. A change that loses that race is reported as a conflict.

/** Statuses a person can edit or move. PROCESSING belongs to the worker; PUBLISHED is history. */
const EDITABLE = ["WAITING", "RETRY_SCHEDULED", "FAILED", "CANCELLED"];
const CANCELLABLE = ["WAITING", "RETRY_SCHEDULED", "FAILED"];
const RETRYABLE = ["FAILED", "RETRY_SCHEDULED", "CANCELLED"];

function isUniqueViolation(e: unknown, field: string) {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  return String((e.meta as { target?: unknown } | undefined)?.target ?? "").includes(field);
}

async function alreadyScheduled(contentId: string, accountId: string) {
  const other = await db.publishingSchedule.findFirst({
    where: { contentId, accountId, status: { in: ["WAITING", "PROCESSING", "RETRY_SCHEDULED"] } },
    include: { account: { select: { name: true } } },
  });
  if (!other) return new ServiceError("This content already has an active post for this account.", undefined, "ALREADY_SCHEDULED");
  return new ServiceError(
    `Already scheduled to ${other.account.name} for ${fmtDateTime(other.scheduledAt, other.timezone)}. Edit that post instead.`,
    undefined,
    "ALREADY_SCHEDULED",
    { scheduleId: other.id },
  );
}

/** The post changed after it was loaded (usually: the worker started publishing it). */
async function conflict(id: string) {
  const current = await db.publishingSchedule.findUnique({ where: { id }, select: { status: true } });
  if (!current) return new ServiceError("Schedule not found.");
  const message =
    current.status === "PROCESSING"
      ? "This post started publishing a moment ago, so it can't be changed now."
      : `This post is now ${ScheduleStatus.label(current.status).toLowerCase()}, so it can't be changed. Reload to see the latest.`;
  return new ServiceError(message, undefined, "CONFLICT");
}

/** Clears the last error, except an unknown outcome: the next attempt must still check the platform first. */
const clearedError = (lastErrorCode: string | null) => ({ lastError: null, lastErrorCode: lastErrorCode === "UNKNOWN_OUTCOME" ? lastErrorCode : null });

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
    override: input.override,
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
  return { provider: provider!, scheduledAt: scheduledAt!, account: account!, missing: readiness.missing };
}

export async function createSchedule(input: ScheduleInput) {
  if (input.idempotencyKey) {
    const existing = await db.publishingSchedule.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
  }
  const { provider, scheduledAt, account, missing } = await validate(input);
  const override = overrideData(missing, input.override).columns;

  if (!input.repost) {
    const published = await db.publishingSchedule.findFirst({
      where: { contentId: input.contentId, accountId: input.accountId, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
    });
    if (published) {
      throw new ServiceError(
        `Already published to ${account.name} on ${fmtDateTime(published.publishedAt ?? published.scheduledAt, published.timezone)}. Choose "Post again" to publish it a second time.`,
        undefined,
        "ALREADY_PUBLISHED",
        { scheduleId: published.id },
      );
    }
  }

  let schedule;
  try {
    schedule = await db.publishingSchedule.create({
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
        activeKey: scheduleActiveKey("WAITING", input.contentId, input.accountId),
        idempotencyKey: input.idempotencyKey || null,
        ...override,
      },
    });
  } catch (e) {
    // A resubmitted form breaks both unique keys; which one the database reports varies
    if (input.idempotencyKey && (isUniqueViolation(e, "idempotencyKey") || isUniqueViolation(e, "activeKey"))) {
      const same = await db.publishingSchedule.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (same) return same;
    }
    if (isUniqueViolation(e, "activeKey")) throw await alreadyScheduled(input.contentId, input.accountId);
    throw e;
  }
  // Make sure the platform is listed as a target of the content
  await db.contentPlatform.upsert({
    where: { contentId_platformId: { contentId: input.contentId, platformId: input.platformId } },
    update: {},
    create: { contentId: input.contentId, platformId: input.platformId },
  });
  await logActivity({
    contentId: input.contentId,
    type: ActivityType.SCHEDULE_CREATED,
    message: `${input.repost ? "Repost scheduled" : "Scheduled"} for ${provider.name} (${account.name}) — ${input.date} ${input.time}`,
    meta: { scheduleId: schedule.id, repost: !!input.repost },
  });
  if (override.overrideReason) await logOverride(input.contentId, schedule.id, provider.name, missing, override.overrideReason);
  await syncPublishingStatus(input.contentId);
  return schedule;
}

export async function updateSchedule(id: string, input: ScheduleInput) {
  const existing = await db.publishingSchedule.findUnique({ where: { id } });
  if (!existing) throw new ServiceError("Schedule not found.");
  if (!EDITABLE.includes(existing.status)) throw await conflict(id);
  const { provider, scheduledAt, missing } = await validate({ ...input, contentId: existing.contentId });
  // Re-recorded on every edit: kept while it's still needed, cleared once the content is ready
  const { columns: override, waived } = overrideData(missing, input.override);
  const overrideChanged =
    override.overrideReason !== null && (override.overrideReason !== existing.overrideReason || JSON.stringify(waived) !== JSON.stringify(existing.overrideRules ?? []));

  let changed;
  try {
    changed = await db.publishingSchedule.updateMany({
      where: { id, status: { in: EDITABLE } },
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
        activeKey: scheduleActiveKey("WAITING", existing.contentId, input.accountId),
        autoRetries: 0,
        platformStatus: null,
        nextAttemptAt: null,
        uploadState: Prisma.DbNull,
        ...clearedError(existing.lastErrorCode),
        ...override,
        // Keep the original time and author of an override that didn't change
        ...(override.overrideReason && !overrideChanged ? { overrideAt: existing.overrideAt, overrideBy: existing.overrideBy } : {}),
      },
    });
  } catch (e) {
    if (isUniqueViolation(e, "activeKey")) throw await alreadyScheduled(existing.contentId, input.accountId);
    throw e;
  }
  if (changed.count === 0) throw await conflict(id);

  await logActivity({
    contentId: existing.contentId,
    type: ActivityType.SCHEDULE_CHANGED,
    message: `${provider.name} schedule changed to ${input.date} ${input.time}`,
    meta: { scheduleId: id },
  });
  if (overrideChanged) await logOverride(existing.contentId, id, provider.name, missing, override.overrideReason!);
  await syncPublishingStatus(existing.contentId);
}

/** Removes a post's override: it again needs every requirement before it can publish. */
export async function removeOverride(id: string) {
  const s = await db.publishingSchedule.findUnique({ where: { id }, include: { platform: true } });
  if (!s) throw new ServiceError("Schedule not found.");
  if (!s.overrideRules) return;
  const changed = await db.publishingSchedule.updateMany({
    where: { id, status: { in: EDITABLE } },
    data: NO_OVERRIDE,
  });
  if (changed.count === 0) throw await conflict(id);
  await logActivity({
    contentId: s.contentId,
    type: ActivityType.SCHEDULE_OVERRIDE,
    message: `${s.platform.name} override removed: the post needs every requirement before it publishes.`,
    meta: { scheduleId: id },
  });
}

/** Moves a post to a new time, keeping all other settings (used by calendar drag & drop). */
export async function reschedule(id: string, scheduledAt: Date) {
  const s = await db.publishingSchedule.findUnique({ where: { id }, include: { platform: true, account: true } });
  if (!s) throw new ServiceError("Schedule not found.");
  if (["PUBLISHED", "PROCESSING"].includes(s.status)) throw new ServiceError("Published posts can't be moved.");
  if (scheduledAt.getTime() <= Date.now()) throw new ServiceError("Scheduled time must be in the future.");
  if (s.account.status !== "CONNECTED") throw new ServiceError(`Reconnect "${s.account.name}" before rescheduling.`);

  let changed;
  try {
    changed = await db.publishingSchedule.updateMany({
      where: { id, status: { in: EDITABLE } },
      data: {
        scheduledAt,
        status: "WAITING",
        activeKey: scheduleActiveKey("WAITING", s.contentId, s.accountId),
        autoRetries: 0,
        platformStatus: null,
        nextAttemptAt: null,
        ...clearedError(s.lastErrorCode),
      },
    });
  } catch (e) {
    if (isUniqueViolation(e, "activeKey")) throw await alreadyScheduled(s.contentId, s.accountId);
    throw e;
  }
  if (changed.count === 0) throw await conflict(id);

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
  if (s.status === "CANCELLED") return;

  const changed = await db.publishingSchedule.updateMany({
    where: { id, status: { in: CANCELLABLE } },
    data: { status: "CANCELLED", activeKey: null, nextAttemptAt: null },
  });
  if (changed.count === 0) throw await conflict(id);

  await logActivity({ contentId: s.contentId, type: ActivityType.SCHEDULE_CANCELLED, message: `${s.platform.name} post cancelled` });
  await syncPublishingStatus(s.contentId);
}

/**
 * Puts a failed post back in the queue for immediate processing. When the last
 * attempt's outcome is unknown and the platform couldn't be checked, the user
 * must confirm they looked on the platform first (`confirmUnknownOutcome`).
 */
export async function retrySchedule(id: string, opts: { confirmUnknownOutcome?: boolean } = {}) {
  const s = await db.publishingSchedule.findUnique({ where: { id }, include: { account: true, platform: true } });
  if (!s) throw new ServiceError("Schedule not found.");
  if (!RETRYABLE.includes(s.status)) throw new ServiceError("Only failed posts can be retried.");
  if (s.account.status !== "CONNECTED") throw new ServiceError(`Reconnect "${s.account.name}" before retrying.`);

  const unconfirmed = s.status === "FAILED" && s.lastErrorCode === "UNKNOWN_OUTCOME";
  if (unconfirmed && !opts.confirmUnknownOutcome) {
    throw new ServiceError(
      `The last attempt may have gone live on ${s.platform.name}. Look for the post there first, and retry only if it isn't there.`,
      undefined,
      "CONFIRM_UNKNOWN_OUTCOME",
    );
  }

  let changed;
  try {
    changed = await db.publishingSchedule.updateMany({
      where: { id, status: { in: RETRYABLE } },
      data: {
        status: "RETRY_SCHEDULED",
        nextAttemptAt: new Date(),
        autoRetries: 0,
        platformStatus: null,
        activeKey: scheduleActiveKey("RETRY_SCHEDULED", s.contentId, s.accountId),
        // The user checked the platform: send without asking it again
        ...(unconfirmed ? { lastErrorCode: null } : {}),
      },
    });
  } catch (e) {
    if (isUniqueViolation(e, "activeKey")) throw await alreadyScheduled(s.contentId, s.accountId);
    throw e;
  }
  if (changed.count === 0) throw await conflict(id);
  await syncPublishingStatus(s.contentId);
}
