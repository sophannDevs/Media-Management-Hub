import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

import { db } from "@/lib/db";
import { processDueSchedules, processSchedule } from "@/server/services/publishing";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";
import { fake } from "../helpers/fake-provider";
import { clearFaults, failContentStatus, failInserts, waitFor } from "../helpers/faults";

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000);

async function duePost() {
  await seedPlatforms();
  const account = await createAccount("youtube");
  const content = await createReadyContent();
  const schedule = await insertSchedule(content.id, account.id);
  return { account, content, schedule };
}

const reload = (id: string) => db.publishingSchedule.findUniqueOrThrow({ where: { id }, include: { jobs: { orderBy: { startedAt: "asc" } } } });

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
    it.fails(`PUB-01: a failure in ${step} after the platform accepted the post does not post twice`, async () => {
      const { schedule } = await duePost();
      await inject();

      await processSchedule(schedule.id).catch(() => undefined);
      await processDueSchedules(minutesFromNow(20)).catch(() => undefined);

      const s = await reload(schedule.id);
      expect(fake.calls).toHaveLength(1);
      expect(s.status).toBe("PUBLISHED");
      expect(s.externalId).toBe("fake_1");
      expect(s.jobs.map((j) => j.status)).toEqual(["SUCCEEDED"]);
    });
  }

  it.fails("PUB-02: a slow upload is not sent again by a tick 16 minutes later", async () => {
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
});
