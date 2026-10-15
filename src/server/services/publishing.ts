import { randomUUID } from "node:crypto";
import os from "node:os";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { SecretsError } from "@/lib/secrets";
import { dayDiff } from "@/lib/dates";
import { logger } from "@/lib/log";
import { getProvider } from "@/lib/platforms/registry";
import { type PlatformProvider, PublishError, type PublishMedia, type PublishRequest, type PublishResult, type ReconcileResult } from "@/lib/platforms/types";
import { storage } from "@/lib/storage";
import { blockingRequirements, missingRequirements } from "@/lib/workflow/rules";
import { ActivityType, NotificationType } from "@/lib/workflow/statuses";
import { purgeExpiredSessions } from "../auth/session";
import { logActivity } from "./activity";
import { openToken } from "./tokens";
import { contentStateSelect, toContentState } from "./content-state";
import { syncPublishingStatus } from "./content";
import { notify } from "./notifications";
import { getSettings, rulesFrom, type Settings } from "./settings";

// One publish attempt runs in four steps, and a success the platform has
// confirmed is never turned back into a failure:
//   1. claim    – move the post to PROCESSING and take a lease, atomically
//   2. publish  – call the platform while a heartbeat renews the lease
//   3. persist  – save the platform's answer (retried on its own, never re-sent)
//   4. effects  – activity log, notification, status sync (best effort)
// A post whose lease expired (the process stopped mid-upload) is never sent
// again blindly: the platform is asked what happened first.

/** Lease holder id for this process (also its WorkerHeartbeat id). */
export const WORKER_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const leaseMs = () => Math.max(10, Number(process.env.PUBLISH_LEASE_SECONDS) || 120) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A JS Date as the UTC wall-clock the DateTime columns hold (raw SQL binds a Date as timestamptz). */
const utc = (d: Date) => Prisma.sql`(${d} AT TIME ZONE 'UTC')`;

const scheduleInclude = {
  account: true,
  platform: true,
  thumbnailAsset: true,
  content: { select: { ...contentStateSelect, id: true, title: true, archivedAt: true, videoAsset: true, thumbnailAsset: true } },
} satisfies Prisma.PublishingScheduleInclude;
type LoadedSchedule = Prisma.PublishingScheduleGetPayload<{ include: typeof scheduleInclude }>;
/** The attempt row being written: created when the attempt starts, finished once (PUB-09). */
type AttemptRow = { id: string; attempt: number; startedAt: Date; platformRequestId?: string };

type MediaRow = { fileName: string; mimeType: string; size: number; storageKey: string | null; externalUrl: string | null } | null;
const toPublishMedia = (m: MediaRow): PublishMedia | null =>
  m ? { fileName: m.fileName, mimeType: m.mimeType, size: m.size, localPath: m.storageKey ? storage.localPath(m.storageKey) : null, url: m.externalUrl } : null;

/** A JSON column as a plain object, or null. */
function asObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toRequest(s: LoadedSchedule): PublishRequest {
  return {
    scheduleId: s.id,
    account: {
      id: s.account.id,
      name: s.account.name,
      status: s.account.status,
      externalId: s.account.externalId,
      // Stored encrypted (SEC-04): the token itself exists only here, on its way to the platform
      accessToken: openToken(s.account.accessToken),
      tokenExpiresAt: s.account.tokenExpiresAt,
    },
    title: s.title,
    caption: s.caption,
    hashtags: s.hashtags,
    visibility: s.visibility,
    video: toPublishMedia(s.content.videoAsset),
    thumbnail: toPublishMedia(s.thumbnailAsset ?? s.content.thumbnailAsset),
    options: asObject(s.options) ?? {},
  };
}

const log = logger.child({ component: "publisher", workerId: WORKER_ID });

/** Retries a write that records what the platform already did; losing it could cause a second post. */
async function persist<T>(label: string, write: () => Promise<T>): Promise<T> {
  for (let attempt = 1, delay = 200; ; attempt++, delay *= 3) {
    try {
      return await write();
    } catch (e) {
      if (attempt >= 5) throw e;
      log.warn("write failed, retrying", { label, attempt, of: 5, err: e });
      await sleep(delay);
    }
  }
}

/** Runs a side effect after the outcome is saved; its failure never changes the outcome. */
async function bestEffort(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    log.error("side effect failed; the post's outcome is already saved", { label, err: e });
  }
}

function startHeartbeat(scheduleId: string) {
  let last = Date.now();
  const renew = () => {
    last = Date.now();
    return db.publishingSchedule
      .updateMany({ where: { id: scheduleId, status: "PROCESSING", lockedBy: WORKER_ID }, data: { lockedUntil: new Date(Date.now() + leaseMs()) } })
      .catch((e) => log.error("could not renew the lease", { scheduleId, err: e }));
  };
  const timer = setInterval(renew, leaseMs() / 3);
  timer.unref?.();
  return {
    /** Upload progress: renews early when the last renewal is getting old. */
    progress: () => {
      if (Date.now() - last > leaseMs() / 6) void renew();
    },
    stop: () => clearInterval(timer),
  };
}
type Heartbeat = ReturnType<typeof startHeartbeat>;

export type ProcessResult = "published" | "retry" | "failed" | "skipped";

/** Publishes one schedule. Safe to call concurrently: the row is claimed atomically. */
export async function processSchedule(scheduleId: string): Promise<ProcessResult> {
  const claimed = await db.publishingSchedule.updateMany({
    where: { id: scheduleId, status: { in: ["WAITING", "RETRY_SCHEDULED"] } },
    data: { status: "PROCESSING", attempts: { increment: 1 }, lockedBy: WORKER_ID, lockedUntil: new Date(Date.now() + leaseMs()) },
  });
  if (claimed.count === 0) return "skipped";
  return runClaimed(scheduleId);
}

/**
 * Claims the next due post for this worker (PUB-11). FOR UPDATE SKIP LOCKED
 * lets several workers take from the queue at the same time without waiting
 * on, or claiming, each other's rows. Raw SQL, so updatedAt is set here.
 */
export async function claimNextDue(now = new Date()): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "PublishingSchedule"
    SET "status" = 'PROCESSING', "attempts" = "attempts" + 1, "lockedBy" = ${WORKER_ID},
        "lockedUntil" = ${utc(new Date(Date.now() + leaseMs()))}, "updatedAt" = ${utc(new Date())}
    WHERE "id" = (
      SELECT "id" FROM "PublishingSchedule"
      WHERE ("status" = 'WAITING' AND "scheduledAt" <= ${utc(now)})
         OR ("status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= ${utc(now)})
      ORDER BY "scheduledAt", "id"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  return rows[0]?.id ?? null;
}

/** Runs the attempt of a post this worker has claimed, renewing its lease meanwhile. */
async function runClaimed(scheduleId: string): Promise<ProcessResult> {
  const heartbeat = startHeartbeat(scheduleId);
  try {
    return await attempt(scheduleId, heartbeat);
  } finally {
    heartbeat.stop();
  }
}

async function attempt(scheduleId: string, heartbeat: Heartbeat): Promise<ProcessResult> {
  let s: LoadedSchedule;
  let settings: Settings;
  let job: AttemptRow;
  try {
    s = await db.publishingSchedule.findUniqueOrThrow({ where: { id: scheduleId }, include: scheduleInclude });
    settings = await getSettings();
    const startedAt = new Date();
    // What put this attempt in the queue: its time came, an automatic retry, or a person
    const trigger = s.nextAttemptAt === null ? "SCHEDULED" : s.autoRetries > 0 ? "RETRY" : "MANUAL";
    // The attempt number comes from the log itself, never from a counter that resets (PUB-09)
    const [row] = await db.$queryRaw<{ id: string; attempt: number }[]>`
      INSERT INTO "PublishingJob" ("id", "scheduleId", "attempt", "status", "trigger", "workerId", "startedAt")
      SELECT ${randomUUID()}, ${scheduleId}, COALESCE(MAX("attempt"), 0) + 1, 'PROCESSING', ${trigger}, ${WORKER_ID}, ${utc(startedAt)}
      FROM "PublishingJob" WHERE "scheduleId" = ${scheduleId}
      RETURNING "id", "attempt"`;
    job = { id: row.id, attempt: row.attempt, startedAt };
  } catch (e) {
    // Nothing was sent: give the post back to the queue
    await bestEffort("release claim", () =>
      db.publishingSchedule.updateMany({
        where: { id: scheduleId, status: "PROCESSING", lockedBy: WORKER_ID },
        data: { status: "RETRY_SCHEDULED", nextAttemptAt: new Date(Date.now() + 60_000), lockedBy: null, lockedUntil: null },
      }),
    );
    throw e;
  }
  await bestEffort("status sync", () => syncPublishingStatus(s.contentId));

  const provider = getProvider(s.platformId);
  if (!provider) return recordFailure(s, job, new PublishError(`No integration for platform "${s.platformId}".`, "VALIDATION", false), settings);
  const refusal = preflight(s, settings);
  if (refusal) return recordFailure(s, job, refusal, settings);

  let request: PublishRequest;
  try {
    request = toRequest(s);
  } catch (e) {
    if (!(e instanceof SecretsError)) throw e;
    // The stored credentials can't be read (key changed or value damaged): the account needs reconnecting
    return recordFailure(s, job, new PublishError(`The stored credentials for "${s.account.name}" can't be read: ${e.message} Reconnect the account.`, "AUTH", false), settings);
  }
  const uploadState = asObject(s.uploadState);
  const simulated = provider.isMock;

  // The previous attempt ended without a clear answer: ask the platform before sending again
  if (s.lastErrorCode === "UNKNOWN_OUTCOME") {
    const check = await reconcile(provider, request, uploadState);
    if (check.status === "published") return recordSuccess(s, job, check.result, { simulated, reconciled: true });
    if (check.status === "unknown") {
      const err = new PublishError(
        `Couldn't confirm whether the earlier attempt went live (${check.reason}). Check ${s.platform.name} first and retry only if the post isn't there.`,
        "UNKNOWN_OUTCOME",
        false,
      );
      return recordFailure(s, job, err, settings);
    }
  }

  let phase: "UPLOADING" | "PROCESSING" | null = null;
  let result: PublishResult;
  try {
    result = await provider.publish(request, {
      uploadState,
      saveUploadState: async (state) => {
        await persist("save upload state", () =>
          db.publishingSchedule.update({ where: { id: scheduleId }, data: { uploadState: state as Prisma.InputJsonObject } }),
        );
      },
      progress: (info) => {
        heartbeat.progress();
        if (info?.platformRequestId) job.platformRequestId = info.platformRequestId;
        if (info?.phase && info.phase !== phase) {
          phase = info.phase;
          void bestEffort("platform status", () => db.publishingSchedule.update({ where: { id: scheduleId }, data: { platformStatus: info.phase } }));
        }
      },
    });
  } catch (e) {
    return recordFailure(s, job, classify(e, provider), settings, { fromPlatform: true });
  }
  return recordSuccess(s, job, result, { simulated, reconciled: false });
}

/**
 * Checks that need no platform call. A failure here means nothing was sent.
 * Hard requirements always apply; soft ones the post's override waived don't (WF-01).
 */
function preflight(s: LoadedSchedule, settings: Settings): PublishError | null {
  if (s.content.archivedAt) return new PublishError("Content is archived.", "VALIDATION", false);
  const missing = missingRequirements(toContentState(s.content), rulesFrom(settings));
  const blocking = blockingRequirements(missing, overriddenKeys(s.overrideRules));
  if (blocking.length) {
    return new PublishError(
      `Content is no longer Ready to Post: ${blocking.map((m) => m.label.toLowerCase()).join(", ")}.`,
      "VALIDATION",
      false,
    );
  }
  return null;
}

function overriddenKeys(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
}

/**
 * Anything other than a PublishError may have happened after the platform
 * received the post, so its outcome is unknown. It is retried only through
 * reconciliation, and only when the provider can reconcile.
 */
function classify(e: unknown, provider: PlatformProvider): PublishError {
  if (e instanceof PublishError && e.code !== "UNKNOWN_OUTCOME") return e;
  const message = e instanceof Error ? e.message : String(e);
  return new PublishError(e instanceof PublishError ? message : `Publishing stopped unexpectedly: ${message}`, "UNKNOWN_OUTCOME", !!provider.reconcile);
}

async function reconcile(provider: PlatformProvider, req: PublishRequest, uploadState: Record<string, unknown> | null): Promise<ReconcileResult> {
  if (!provider.reconcile) return { status: "unknown", reason: `${provider.name} can't report on interrupted uploads` };
  try {
    return await provider.reconcile(req, uploadState);
  } catch (e) {
    return { status: "unknown", reason: e instanceof Error ? e.message : "the platform check failed" };
  }
}

async function recordSuccess(
  s: LoadedSchedule,
  job: AttemptRow,
  result: PublishResult,
  { simulated, reconciled }: { simulated: boolean; reconciled: boolean },
): Promise<ProcessResult> {
  const now = new Date();
  try {
    // The platform's id is saved first, on its own: if the full update below
    // keeps failing, recovery still sees the post as sent and won't send it again.
    await persist("save external id", () =>
      db.publishingSchedule.update({ where: { id: s.id }, data: { externalId: result.externalId, externalUrl: result.url, simulated } }),
    );
    await persist("mark published", () =>
      db.$transaction([
        db.publishingSchedule.update({
          where: { id: s.id },
          data: {
            status: "PUBLISHED",
            publishedAt: now,
            activeKey: null,
            lockedBy: null,
            lockedUntil: null,
            nextAttemptAt: null,
            lastError: null,
            lastErrorCode: null,
            uploadState: Prisma.DbNull,
            platformStatus: "LIVE",
          },
        }),
        db.publishingJob.update({
          where: { id: job.id },
          data: { status: "SUCCEEDED", finishedAt: now, durationMs: now.getTime() - job.startedAt.getTime(), externalId: result.externalId, platformRequestId: job.platformRequestId ?? null },
        }),
      ]),
    );
  } catch (e) {
    log.error("the platform accepted the post but the result could not be saved; it will not be sent again (recovery checks the platform when the lease expires)", {
      scheduleId: s.id,
      jobId: job.id,
      platform: s.platformId,
      externalId: result.externalId,
      url: result.url,
      err: e,
    });
    throw e;
  }
  log.info("post published", { scheduleId: s.id, jobId: job.id, platform: s.platformId, account: s.account.name, attempt: job.attempt, simulated, reconciled, externalId: result.externalId });

  await bestEffort("activity log", () =>
    logActivity({
      contentId: s.contentId,
      type: ActivityType.PUBLISHED,
      message: `${simulated ? "Simulated publish to" : "Published to"} ${s.platform.name} (${s.account.name})${reconciled ? ", confirmed after an interrupted attempt" : ""}`,
      meta: { url: result.url, simulated },
    }),
  );
  await bestEffort("notification", () =>
    notify({
      type: NotificationType.PUBLISHED,
      title: simulated ? "Simulated publish complete" : "Successfully published",
      message: simulated
        ? `"${s.content.title}" went through the simulated ${s.platform.name} publisher. Nothing was sent to ${s.platform.name}.`
        : `"${s.content.title}" is live on ${s.platform.name}.`,
      href: `/content/${s.contentId}?tab=publishing`,
      dedupeKey: `published:${s.id}`,
    }),
  );
  await bestEffort("status sync", () => syncPublishingStatus(s.contentId));
  return "published";
}

async function recordFailure(s: LoadedSchedule, job: AttemptRow, err: PublishError, settings: Settings, opts: { fromPlatform?: boolean } = {}): Promise<ProcessResult> {
  const now = new Date();
  // The budget counts automatic retries since the last action by a person, not every attempt ever made (PUB-09)
  const retry = err.retryable && settings.autoRetry && s.autoRetries < settings.maxRetries;
  // An unknown outcome is checked with the platform on the next attempt, so it can come back soon
  const delayMinutes = err.code === "UNKNOWN_OUTCOME" ? 1 : settings.retryDelayMinutes;
  const retryAt = retry ? new Date(now.getTime() + delayMinutes * 60_000) : null;
  // Why the next attempt was, or wasn't, scheduled: kept on the attempt row
  const retryReason = retry
    ? `${err.code}: automatic retry ${s.autoRetries + 1} of ${settings.maxRetries} in ${delayMinutes} min`
    : !err.retryable
      ? `${err.code}: not retried automatically`
      : !settings.autoRetry
        ? `${err.code}: automatic retries are off`
        : `${err.code}: no automatic retries left (${settings.maxRetries} used)`;

  await persist("record failure", () =>
    db.$transaction([
      db.publishingJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: err.message, errorCode: err.code, finishedAt: now, durationMs: now.getTime() - job.startedAt.getTime(), platformRequestId: job.platformRequestId ?? null, retryAt, retryReason },
      }),
      db.publishingSchedule.update({
        where: { id: s.id },
        data: {
          ...(retry ? { status: "RETRY_SCHEDULED", nextAttemptAt: retryAt, autoRetries: { increment: 1 } } : { status: "FAILED", nextAttemptAt: null, activeKey: null }),
          // The platform itself refused the post (ARCH-02); a failure before the upload never reached it
          ...(opts.fromPlatform && err.code === "VALIDATION" ? { platformStatus: "REJECTED" } : {}),
          lastError: err.message,
          lastErrorCode: err.code,
          lockedBy: null,
          lockedUntil: null,
        },
      }),
    ]),
  );

  log.warn("publish attempt failed", { scheduleId: s.id, jobId: job.id, platform: s.platformId, account: s.account.name, attempt: job.attempt, code: err.code, willRetry: retry, retryReason, message: err.message });
  if (err.code === "AUTH") {
    await bestEffort("mark account", () => db.socialAccount.update({ where: { id: s.accountId }, data: { status: "TOKEN_EXPIRED", lastError: err.message } }));
    await bestEffort("blocked posts notice", () => notifyBlockedPosts(s.accountId));
  }
  await bestEffort("activity log", () =>
    logActivity({
      contentId: s.contentId,
      type: ActivityType.PUBLISH_FAILED,
      message: retry ? `${s.platform.name} upload failed — retry scheduled` : `${s.platform.name} publishing failed`,
      meta: { error: err.message, code: err.code },
    }),
  );
  if (!retry) {
    await bestEffort("notification", () =>
      notify({
        type: NotificationType.PUBLISH_FAILED,
        title: err.code === "UNKNOWN_OUTCOME" ? "Check this post on the platform" : "Publishing failed",
        message: `"${s.content.title}" could not be posted to ${s.account.name}: ${err.message}`,
        href: `/schedule?status=failed`,
        dedupeKey: `failed:${s.id}:${job.attempt}`,
      }),
    );
  }
  await bestEffort("status sync", () => syncPublishingStatus(s.contentId));
  return retry ? "retry" : "failed";
}

/**
 * Posts whose lease expired: the worker stopped mid-attempt (restart, crash,
 * sleep). If the platform's answer was already saved the post is published;
 * otherwise it is queued as UNKNOWN_OUTCOME, so the next attempt asks the
 * platform before sending anything. Lease expiry uses the wall clock (leases
 * are about whether a process is still alive); `dueAt` is when the recovered
 * post becomes due again (the current tick).
 */
export async function recoverExpiredLeases(dueAt = new Date()) {
  const now = new Date();
  const expired = await db.publishingSchedule.findMany({
    where: {
      status: "PROCESSING",
      // Rows claimed before leases existed have no lockedUntil
      OR: [{ lockedUntil: { lt: now } }, { lockedUntil: null, updatedAt: { lt: new Date(now.getTime() - leaseMs()) } }],
    },
    select: { id: true, contentId: true, lockedUntil: true, externalId: true },
  });

  for (const s of expired) {
    // Conditional on the lease seen above, so a renewal that lands meanwhile wins
    const where = { id: s.id, status: "PROCESSING", lockedUntil: s.lockedUntil };
    const released = { lockedBy: null, lockedUntil: null, nextAttemptAt: null };
    const moved = s.externalId
      ? await db.publishingSchedule.updateMany({ where, data: { ...released, status: "PUBLISHED", publishedAt: now, activeKey: null, lastError: null, lastErrorCode: null } })
      : await db.publishingSchedule.updateMany({
          where,
          data: {
            ...released,
            status: "RETRY_SCHEDULED",
            nextAttemptAt: dueAt,
            lastErrorCode: "UNKNOWN_OUTCOME",
            lastError: "Publishing was interrupted. The platform is checked before anything is sent again.",
          },
        });
    if (moved.count === 0) continue;
    log.warn("an attempt was interrupted; the post was recovered", { scheduleId: s.id, outcome: s.externalId ? "already published" : "checked with the platform before any resend" });
    await db.publishingJob.updateMany({
      where: { scheduleId: s.id, status: "PROCESSING" },
      data: s.externalId
        ? { status: "SUCCEEDED", finishedAt: now }
        : { status: "FAILED", error: "Interrupted: the worker stopped during this attempt.", errorCode: "UNKNOWN_OUTCOME", finishedAt: now },
    });
    await bestEffort("status sync", () => syncPublishingStatus(s.contentId));
  }
  return expired.length;
}

/**
 * Processes the posts that are due, one claim at a time (at most `limit` per
 * call). Cheap when nothing is due: two indexed queries. Returns a summary.
 */
export async function processDueSchedules(now = new Date(), limit = 20) {
  await recoverExpiredLeases(now);
  const summary = { processed: 0, published: 0, failed: 0, retry: 0 };
  for (let i = 0; i < limit; i++) {
    const id = await claimNextDue(now);
    if (!id) break;
    const r = await runClaimed(id);
    summary.processed++;
    summary[r === "published" ? "published" : r === "retry" ? "retry" : "failed"]++;
  }
  return summary;
}

/**
 * Event, not a scan (PUB-10): an account just stopped working (token expired,
 * refused by the platform, disconnected). One notice per account and day names
 * the posts it now blocks.
 */
export async function notifyBlockedPosts(accountId: string) {
  const blocked = await db.publishingSchedule.findMany({
    where: { accountId, status: { in: ["WAITING", "RETRY_SCHEDULED"] } },
    select: { content: { select: { title: true } }, account: { select: { name: true } } },
    take: 50,
  });
  if (!blocked.length) return;
  const account = blocked[0].account.name;
  await notify({
    type: NotificationType.TOKEN_EXPIRED,
    title: "Account needs reconnecting",
    message:
      blocked.length === 1
        ? `"${blocked[0].content.title}" is scheduled on "${account}", which is not connected.`
        : `${blocked.length}${blocked.length === 50 ? "+" : ""} posts are scheduled on "${account}", which is not connected.`,
    href: "/accounts",
    dedupeKey: `blocked:${accountId}:${new Date().toISOString().slice(0, 10)}`,
  });
}

/** Hourly housekeeping: token expiry, tomorrow's posts, incomplete assets, old sessions and worker rows. */
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
    await notifyBlockedPosts(a.id);
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

  await purgeExpiredSessions();
  // Workers that stopped beating a day ago are gone
  await db.workerHeartbeat.deleteMany({ where: { lastBeatAt: { lt: new Date(now.getTime() - 86_400_000) } } });
}
