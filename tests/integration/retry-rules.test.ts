import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

import { db } from "@/lib/db";
import { PublishError, type PublishErrorCode } from "@/lib/platforms/types";
import { NotificationType } from "@/lib/workflow/statuses";
import { processSchedule } from "@/server/services/publishing";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";
import { fake } from "../helpers/fake-provider";

// PUB-08: each kind of failure is retried its own way, through the real pipeline.

const MIN = 60_000;
const settings = { autoRetry: true, maxRetries: 3, retryDelayMinutes: 15 };

function refuse(code: PublishErrorCode, retryable: boolean, extra: { retryAfterSeconds?: number; quotaResetAt?: Date } = {}) {
  fake.setBehavior(async () => {
    const e = new PublishError(`${code} from the platform`, code, retryable);
    e.retryAfterSeconds = extra.retryAfterSeconds ?? null;
    e.quotaResetAt = extra.quotaResetAt ?? null;
    throw e;
  });
}

async function duePost() {
  const account = await createAccount("youtube", { name: "Rules channel" });
  const content = await createReadyContent();
  const schedule = await insertSchedule(content.id, account.id, { activeKey: `${content.id}:${account.id}` });
  return { account, content, schedule };
}
const latestJob = (id: string) => db.publishingJob.findFirstOrThrow({ where: { scheduleId: id }, orderBy: { attempt: "desc" } });
const row = (id: string) => db.publishingSchedule.findUniqueOrThrow({ where: { id } });
const waitOf = (next: Date | null, from: Date) => (next ? next.getTime() - from.getTime() : null);

beforeEach(async () => {
  await seedPlatforms();
  await db.workspaceSettings.update({ where: { id: 1 }, data: settings });
  fake.reset();
  await db.publishingSchedule.deleteMany();
  await db.notification.deleteMany();
});

describe("retry rules (PUB-08)", () => {
  it("backs off exponentially on network failures: about 15 minutes, then about 30", async () => {
    const { schedule } = await duePost();
    refuse("NETWORK", true);
    const t0 = Date.now();
    expect(await processSchedule(schedule.id)).toBe("retry");
    const first = waitOf((await row(schedule.id)).nextAttemptAt, new Date(t0))!;
    expect(first).toBeGreaterThanOrEqual(15 * MIN * 0.8 - 1000);
    expect(first).toBeLessThanOrEqual(15 * MIN * 1.2 + 1000);
    expect((await latestJob(schedule.id)).retryReason).toMatch(/^NETWORK: temporary failure, backing off; automatic retry 1 of 3 in \d+ min$/);

    const t1 = Date.now();
    expect(await processSchedule(schedule.id)).toBe("retry");
    const second = waitOf((await row(schedule.id)).nextAttemptAt, new Date(t1))!;
    expect(second).toBeGreaterThanOrEqual(30 * MIN * 0.8 - 1000);
    expect(second).toBeLessThanOrEqual(30 * MIN * 1.2 + 1000);
    expect((await latestJob(schedule.id)).retryReason).toMatch(/retry 2 of 3/);
  });

  it("waits exactly as long as the platform asked when it is rate limiting", async () => {
    const { schedule } = await duePost();
    refuse("RATE", true, { retryAfterSeconds: 120 });
    const t0 = Date.now();
    expect(await processSchedule(schedule.id)).toBe("retry");
    const wait = waitOf((await row(schedule.id)).nextAttemptAt, new Date(t0))!;
    expect(wait).toBeGreaterThanOrEqual(120_000 - 1000);
    expect(wait).toBeLessThanOrEqual(120_000 + 1000);
    expect((await latestJob(schedule.id)).retryReason).toMatch(/RATE: the platform asked to wait 2 min; automatic retry 1 of 3/);
  });

  it("waits for the quota to reset instead of retrying every 15 minutes", async () => {
    const { schedule } = await duePost();
    const reset = new Date(Date.now() + 5 * 3_600_000);
    refuse("QUOTA", true, { quotaResetAt: reset });
    expect(await processSchedule(schedule.id)).toBe("retry");
    const s = await row(schedule.id);
    expect(Math.abs(s.nextAttemptAt!.getTime() - reset.getTime())).toBeLessThan(1000);
    const job = await latestJob(schedule.id);
    expect(job.retryReason).toMatch(/QUOTA: waiting for the quota to reset; automatic retry 1 of 3 in 5 h/);
    expect(job.retryAt).toEqual(s.nextAttemptAt);

    // Without a known reset time: an hour, not the configured 15 minutes
    const other = await duePost();
    refuse("QUOTA", true);
    const t0 = Date.now();
    await processSchedule(other.schedule.id);
    const wait = waitOf((await row(other.schedule.id)).nextAttemptAt, new Date(t0))!;
    expect(Math.abs(wait - 60 * MIN)).toBeLessThan(1000);
  });

  it("pauses the account on a dead sign-in and tells the owner, without retrying", async () => {
    const { account, schedule } = await duePost();
    refuse("AUTH", false);
    expect(await processSchedule(schedule.id)).toBe("failed");
    expect(await row(schedule.id)).toMatchObject({ status: "FAILED", nextAttemptAt: null, autoRetries: 0 });
    expect((await latestJob(schedule.id)).retryReason).toMatch(/AUTH: .*paused until it is reconnected/);
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("TOKEN_EXPIRED");
    expect(await db.notification.count({ where: { type: NotificationType.PUBLISH_FAILED } })).toBe(1);
    expect(fake.calls).toHaveLength(1);
  });

  it("marks a post the platform refused as needing attention, and leaves the account alone", async () => {
    const { account, schedule } = await duePost();
    refuse("VALIDATION", false);
    expect(await processSchedule(schedule.id)).toBe("failed");
    expect(await row(schedule.id)).toMatchObject({ status: "FAILED", platformStatus: "REJECTED" });
    expect((await latestJob(schedule.id)).retryReason).toMatch(/VALIDATION: the platform refused the post itself; fix the post and retry it/);
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("CONNECTED");
  });

  it("never retries an unrecognised error on its own, even if the provider called it retryable", async () => {
    const { schedule } = await duePost();
    refuse("UNKNOWN", true);
    expect(await processSchedule(schedule.id)).toBe("failed");
    expect((await latestJob(schedule.id)).retryReason).toMatch(/^UNKNOWN: an error the app doesn't recognise/);
  });

  it("keeps the hard cap: the fourth network failure stops, whatever the backoff says", async () => {
    const { schedule } = await duePost();
    refuse("NETWORK", true);
    expect(await processSchedule(schedule.id)).toBe("retry");
    expect(await processSchedule(schedule.id)).toBe("retry");
    expect(await processSchedule(schedule.id)).toBe("retry");
    expect(await processSchedule(schedule.id)).toBe("failed");
    expect((await latestJob(schedule.id)).retryReason).toBe("NETWORK: no automatic retries left (3 used)");
    expect(await row(schedule.id)).toMatchObject({ status: "FAILED", autoRetries: 3, attempts: 4 });
  });
});
