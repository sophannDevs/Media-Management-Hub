import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

import { db } from "@/lib/db";
import { PublishError } from "@/lib/platforms/types";
import { processDueSchedules, processSchedule } from "@/server/services/publishing";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";
import { fake } from "../helpers/fake-provider";
import { clearFaults, failContentStatus, failInserts, waitFor } from "../helpers/faults";

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000);

async function duePost(data: Parameters<typeof insertSchedule>[2] = {}) {
  await seedPlatforms();
  const account = await createAccount("youtube");
  const content = await createReadyContent();
  const schedule = await insertSchedule(content.id, account.id, { activeKey: `${content.id}:${account.id}`, ...data });
  return { account, content, schedule };
}

/** A post the worker claimed and then stopped working on (crash, restart, sleep). */
async function interrupted(data: Parameters<typeof insertSchedule>[2] = {}) {
  const post = await duePost({ status: "PROCESSING", attempts: 1, lockedBy: "dead-worker", lockedUntil: minutesFromNow(-1), ...data });
  await db.publishingJob.create({ data: { scheduleId: post.schedule.id, attempt: 1, status: "PROCESSING" } });
  return post;
}

const reload = (id: string) => db.publishingSchedule.findUniqueOrThrow({ where: { id }, include: { jobs: { orderBy: { attempt: "asc" } } } });

beforeEach(async () => {
  await clearFaults();
  fake.reset();
  await db.publishingSchedule.deleteMany();
});

describe("publishing pipeline", () => {
  it("publishes a due post once and records the result", async () => {
    const { schedule } = await duePost();

    expect(await processSchedule(schedule.id)).toBe("published");
    await processDueSchedules(minutesFromNow(20));

    const s = await reload(schedule.id);
    expect(fake.calls).toHaveLength(1);
    expect(s.status).toBe("PUBLISHED");
    expect(s.externalId).toBe("fake_1");
    expect(s.activeKey).toBeNull();
    expect(s.lockedUntil).toBeNull();
    expect(s.jobs.map((j) => j.status)).toEqual(["SUCCEEDED"]);
  });

  // The platform accepted the post, then a later bookkeeping step failed.
  // Each case must stay PUBLISHED and must never reach the platform twice.
  const afterSuccessFaults: [string, () => Promise<void>][] = [
    ["the notification insert", () => failInserts("Notification")],
    ["the activity log insert", () => failInserts("ActivityLog")],
    ["the content status sync", () => failContentStatus("PUBLISHED")],
  ];

  for (const [step, inject] of afterSuccessFaults) {
    it(`PUB-01: a failure in ${step} after the platform accepted the post does not post twice`, async () => {
      const { schedule } = await duePost();
      await inject();

      expect(await processSchedule(schedule.id)).toBe("published");
      await processDueSchedules(minutesFromNow(20));

      const s = await reload(schedule.id);
      expect(fake.calls).toHaveLength(1);
      expect(s.status).toBe("PUBLISHED");
      expect(s.externalId).toBe("fake_1");
      expect(s.jobs.map((j) => j.status)).toEqual(["SUCCEEDED"]);
    });
  }

  it("PUB-02: a slow upload is not sent again by a tick 16 minutes later", async () => {
    const { schedule } = await duePost();
    const release = fake.block();

    const first = processSchedule(schedule.id);
    expect(await waitFor(() => fake.calls.length === 1)).toBe(true);
    const later = processDueSchedules(minutesFromNow(16));
    await waitFor(() => fake.calls.length > 1, 1500);
    release();
    await Promise.all([first, later]);

    expect(fake.calls).toHaveLength(1);
    expect((await reload(schedule.id)).status).toBe("PUBLISHED");
  });

  it("PUB-02: the lease is held while uploading and released afterwards", async () => {
    const { schedule } = await duePost();
    const release = fake.block();

    const run = processSchedule(schedule.id);
    expect(await waitFor(() => fake.calls.length === 1)).toBe(true);
    const during = await reload(schedule.id);
    expect(during.status).toBe("PROCESSING");
    expect(during.lockedBy).toBeTruthy();
    expect(during.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    release();
    await run;
    const after = await reload(schedule.id);
    expect(after.lockedBy).toBeNull();
    expect(after.lockedUntil).toBeNull();
  });
});

describe("recovering an interrupted attempt", () => {
  it("marks it published when the platform's answer was already saved, without contacting the platform", async () => {
    const { schedule } = await interrupted({ externalId: "yt_saved", externalUrl: "https://platform.test/watch/saved" });

    await processDueSchedules();

    const s = await reload(schedule.id);
    expect(s.status).toBe("PUBLISHED");
    expect(s.externalId).toBe("yt_saved");
    expect(fake.calls).toHaveLength(0);
    expect(fake.reconcileCalls).toHaveLength(0);
  });

  it("asks the platform first, and does not upload again when the post is there", async () => {
    const { schedule } = await interrupted();
    fake.setReconcile(async () => ({ status: "published", result: { externalId: "yt_found", url: "https://platform.test/watch/found" } }));

    await processDueSchedules();

    const s = await reload(schedule.id);
    expect(fake.reconcileCalls).toHaveLength(1);
    expect(fake.calls).toHaveLength(0);
    expect(s.status).toBe("PUBLISHED");
    expect(s.externalId).toBe("yt_found");
    expect(s.jobs.map((j) => [j.status, j.errorCode])).toEqual([["FAILED", "UNKNOWN_OUTCOME"], ["SUCCEEDED", null]]);
  });

  it("uploads once more when the platform confirms the post is not there", async () => {
    const { schedule } = await interrupted();

    await processDueSchedules();

    const s = await reload(schedule.id);
    expect(fake.reconcileCalls).toHaveLength(1);
    expect(fake.calls).toHaveLength(1);
    expect(s.status).toBe("PUBLISHED");
  });

  it("flags the post for a person when the platform can't tell, instead of sending it again", async () => {
    const { schedule } = await interrupted();
    fake.setReconcile(null);

    await processDueSchedules();

    const s = await reload(schedule.id);
    expect(fake.calls).toHaveLength(0);
    expect(s.status).toBe("FAILED");
    expect(s.lastErrorCode).toBe("UNKNOWN_OUTCOME");
    expect(s.activeKey).toBeNull();
  });

  it("treats an unexpected error during upload as an unknown outcome and checks before retrying", async () => {
    const { schedule } = await duePost();
    fake.setBehavior(async () => {
      throw new Error("socket hang up");
    });

    expect(await processSchedule(schedule.id)).toBe("retry");
    const afterFirst = await reload(schedule.id);
    expect(afterFirst.lastErrorCode).toBe("UNKNOWN_OUTCOME");
    expect(afterFirst.status).toBe("RETRY_SCHEDULED");

    fake.setBehavior(async () => fake.success());
    fake.setReconcile(async () => ({ status: "published", result: { externalId: "yt_landed", url: "https://platform.test/watch/landed" } }));
    await processDueSchedules(minutesFromNow(2));

    const s = await reload(schedule.id);
    expect(fake.calls).toHaveLength(1);
    expect(s.status).toBe("PUBLISHED");
    expect(s.externalId).toBe("yt_landed");
  });
});

describe("refusals", () => {
  it("keeps platform refusals as failures with their code, and frees the slot", async () => {
    const { schedule } = await duePost();
    fake.setBehavior(async () => {
      throw new PublishError("Video rejected by the platform.", "VALIDATION", false);
    });

    expect(await processSchedule(schedule.id)).toBe("failed");

    const s = await reload(schedule.id);
    expect(s.status).toBe("FAILED");
    expect(s.lastErrorCode).toBe("VALIDATION");
    expect(s.activeKey).toBeNull();
    expect(s.jobs.map((j) => [j.status, j.errorCode])).toEqual([["FAILED", "VALIDATION"]]);
  });
});
