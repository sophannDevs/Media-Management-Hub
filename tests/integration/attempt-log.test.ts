import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

import { db } from "@/lib/db";
import { PublishError } from "@/lib/platforms/types";
import { canTransition, SCHEDULE_STATUSES } from "@/lib/workflow/schedule-machine";
import { processSchedule } from "@/server/services/publishing";
import { retrySchedule } from "@/server/services/schedule";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";
import { fake } from "../helpers/fake-provider";

// PUB-09: attempts are an append-only log with their own numbering; the
// automatic-retry budget is separate. ARCH-02: the database enforces the
// schedule's state machine.

const jobsOf = (id: string) => db.publishingJob.findMany({ where: { scheduleId: id }, orderBy: { attempt: "asc" } });
const scheduleOf = (id: string) => db.publishingSchedule.findUniqueOrThrow({ where: { id } });
const refuse = (code: ConstructorParameters<typeof PublishError>[1], retryable: boolean) => fake.setBehavior(async () => {
  throw new PublishError(`${code} from the platform`, code, retryable);
});

async function duePost() {
  const account = await createAccount("youtube");
  const content = await createReadyContent();
  const schedule = await insertSchedule(content.id, account.id, { activeKey: `${content.id}:${account.id}` });
  return { account, content, schedule };
}

beforeEach(async () => {
  await seedPlatforms();
  await db.workspaceSettings.update({ where: { id: 1 }, data: { autoRetry: true, maxRetries: 2, retryDelayMinutes: 15 } });
  fake.reset();
  await db.publishingSchedule.deleteMany();
});

describe("attempt log (PUB-09)", () => {
  it("numbers attempts from the log, so a manual retry continues the count instead of restarting it", async () => {
    const { schedule } = await duePost();
    refuse("VALIDATION", false);
    expect(await processSchedule(schedule.id)).toBe("failed");
    expect((await jobsOf(schedule.id)).map((j) => [j.attempt, j.status, j.trigger])).toEqual([[1, "FAILED", "SCHEDULED"]]);
    expect(await scheduleOf(schedule.id)).toMatchObject({ status: "FAILED", attempts: 1, autoRetries: 0, platformStatus: "REJECTED" });

    await retrySchedule(schedule.id);
    expect(await scheduleOf(schedule.id)).toMatchObject({ status: "RETRY_SCHEDULED", attempts: 1, autoRetries: 0, platformStatus: null });

    fake.reset();
    expect(await processSchedule(schedule.id)).toBe("published");
    const jobs = await jobsOf(schedule.id);
    expect(jobs.map((j) => [j.attempt, j.status, j.trigger])).toEqual([
      [1, "FAILED", "SCHEDULED"],
      [2, "SUCCEEDED", "MANUAL"],
    ]);
    expect(jobs[1]).toMatchObject({ externalId: "fake_1", workerId: expect.any(String) });
    expect(jobs[1].durationMs).toBeGreaterThanOrEqual(0);
    expect(jobs[1].finishedAt!.getTime()).toBeGreaterThanOrEqual(jobs[1].startedAt.getTime());
    expect(await scheduleOf(schedule.id)).toMatchObject({ status: "PUBLISHED", attempts: 2, platformStatus: "LIVE" });
  });

  it("spends the automatic-retry budget, records why each retry was scheduled, and a person's retry refills it", async () => {
    const { schedule } = await duePost();
    refuse("NETWORK", true);
    expect(await processSchedule(schedule.id)).toBe("retry");
    expect(await processSchedule(schedule.id)).toBe("retry");
    expect(await processSchedule(schedule.id)).toBe("failed");

    let jobs = await jobsOf(schedule.id);
    expect(jobs.map((j) => [j.attempt, j.trigger, j.errorCode])).toEqual([
      [1, "SCHEDULED", "NETWORK"],
      [2, "RETRY", "NETWORK"],
      [3, "RETRY", "NETWORK"],
    ]);
    expect(jobs[0].retryReason).toMatch(/NETWORK.*retry 1 of 2/);
    expect(jobs[0].retryAt).toBeInstanceOf(Date);
    expect(jobs[1].retryReason).toMatch(/retry 2 of 2/);
    expect(jobs[2].retryReason).toMatch(/no automatic retries left/);
    expect(jobs[2].retryAt).toBeNull();
    expect(await scheduleOf(schedule.id)).toMatchObject({ status: "FAILED", attempts: 3, autoRetries: 2 });

    await retrySchedule(schedule.id);
    expect(await scheduleOf(schedule.id)).toMatchObject({ status: "RETRY_SCHEDULED", attempts: 3, autoRetries: 0 });
    expect(await processSchedule(schedule.id)).toBe("retry");
    jobs = await jobsOf(schedule.id);
    expect(jobs.map((j) => [j.attempt, j.trigger])).toEqual([[1, "SCHEDULED"], [2, "RETRY"], [3, "RETRY"], [4, "MANUAL"]]);
    expect(await scheduleOf(schedule.id)).toMatchObject({ status: "RETRY_SCHEDULED", attempts: 4, autoRetries: 1 });
  });

  it("never changes a finished attempt, and never numbers two attempts alike", async () => {
    const { schedule } = await duePost();
    expect(await processSchedule(schedule.id)).toBe("published");
    const [done] = await jobsOf(schedule.id);
    await expect(db.publishingJob.update({ where: { id: done.id }, data: { status: "FAILED" } })).rejects.toThrow(/finished attempt is never changed/);
    await expect(db.publishingJob.update({ where: { id: done.id }, data: { error: "rewritten" } })).rejects.toThrow(/finished attempt is never changed/);
    expect(await db.publishingJob.findUniqueOrThrow({ where: { id: done.id } })).toMatchObject({ status: "SUCCEEDED", error: null });

    // An attempt still running can be finished (that is how it ends)
    const running = await db.publishingJob.create({ data: { scheduleId: schedule.id, attempt: 2, status: "PROCESSING" } });
    await db.publishingJob.update({ where: { id: running.id }, data: { status: "FAILED", finishedAt: new Date() } });

    await expect(db.publishingJob.create({ data: { scheduleId: schedule.id, attempt: 2, status: "PROCESSING" } })).rejects.toThrow(/Unique constraint/);
  });
});

describe("schedule state machine in the database (ARCH-02)", () => {
  it("allows exactly the transitions the code's table allows", async () => {
    const account = await createAccount("youtube");
    const content = await createReadyContent();
    const results: string[] = [];
    const expected: string[] = [];
    for (const from of SCHEDULE_STATUSES) {
      for (const to of SCHEDULE_STATUSES) {
        const row = await insertSchedule(content.id, account.id, { status: from, activeKey: null });
        let ok = true;
        try {
          await db.publishingSchedule.update({ where: { id: row.id }, data: { status: to } });
        } catch (e) {
          ok = false;
          expect(String(e)).toMatch(new RegExp(`status ${from} cannot become ${to}`));
        }
        results.push(`${from} -> ${to}: ${ok ? "allowed" : "refused"}`);
        expected.push(`${from} -> ${to}: ${canTransition(from, to) ? "allowed" : "refused"}`);
      }
    }
    expect(results).toEqual(expected);
  });
});
