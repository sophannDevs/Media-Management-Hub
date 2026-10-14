import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { GET as health } from "@/app/api/health/route";
import { db } from "@/lib/db";
import { retryScheduleAction } from "@/server/actions/schedule";
import { syncMockAnalytics } from "@/server/services/analytics-sync";
import { claimNextDue, processDueSchedules } from "@/server/services/publishing";
import { queueIntervalSeconds, runPeriodic, tick, workerStatus } from "@/server/worker";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";
import { fake } from "../helpers/fake-provider";

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);

beforeEach(async () => {
  fake.reset();
  await db.analyticsSnapshot.deleteMany();
  await db.publishingSchedule.deleteMany();
  await db.workerHeartbeat.deleteMany();
  await db.scheduledTask.deleteMany();
  await seedPlatforms();
});

/** `n` posts due now, each on its own content (one active post per content and account). */
async function duePosts(n: number) {
  const account = await createAccount("youtube");
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await createReadyContent();
    ids.push((await insertSchedule(c.id, account.id, { activeKey: `${c.id}:${account.id}` })).id);
  }
  return ids;
}

describe("publishing worker (PUB-11)", () => {
  it("lets two workers drain one queue without sending any post twice", async () => {
    const ids = await duePosts(6);
    // Slow uploads, so both workers are busy at the same time
    fake.setBehavior(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return fake.success();
    });
    const [a, b] = await Promise.all([processDueSchedules(), processDueSchedules()]);
    expect(a.processed + b.processed).toBe(6);
    expect(a.processed).toBeGreaterThan(0);
    expect(b.processed).toBeGreaterThan(0);
    expect(fake.calls.map((c) => c.scheduleId).sort()).toEqual([...ids].sort());
    expect(await db.publishingSchedule.count({ where: { status: "PUBLISHED" } })).toBe(6);
  });

  it("claims only posts that are due", async () => {
    const account = await createAccount("youtube");
    const c = await createReadyContent();
    const later = await insertSchedule(c.id, account.id, { scheduledAt: inMinutes(10) });
    expect(await claimNextDue()).toBeNull();
    expect(await claimNextDue(inMinutes(11))).toBe(later.id);
    expect((await db.publishingSchedule.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("PROCESSING");
  });

  it("runs a periodic job once per period, whatever the number of workers", async () => {
    const runs: number[] = [];
    const job = async () => void runs.push(Date.now());
    const now = new Date();
    const [first, second] = await Promise.all([runPeriodic("maintenance", job, now), runPeriodic("maintenance", job, now)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await runPeriodic("maintenance", job, new Date(now.getTime() + 30 * 60_000))).toBe(false);
    expect(await runPeriodic("maintenance", job, new Date(now.getTime() + 61 * 60_000))).toBe(true);
    expect(runs).toHaveLength(2);
    expect(await db.scheduledTask.findUniqueOrThrow({ where: { name: "maintenance" } })).toMatchObject({ lastError: null });
  });

  it("checks in on every pass, which /api/health reports", async () => {
    expect(await (await health()).json()).toMatchObject({ status: "degraded", database: "ok", worker: { running: false } });
    await tick();
    expect((await workerStatus()).live).toBe(1);
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", worker: { running: true, lastSeenSecondsAgo: 0 } });
  });
});

describe("retry (PUB-06)", () => {
  it("queues the post and answers without uploading", async () => {
    const account = await createAccount("youtube");
    const c = await createReadyContent();
    const s = await insertSchedule(c.id, account.id, { status: "FAILED", lastError: "network", attempts: 3 });
    const started = Date.now();
    const r = await retryScheduleAction(s.id);
    expect(Date.now() - started).toBeLessThan(300);
    expect(r).toMatchObject({ ok: true, message: `Queued — the publishing worker sends it within ${queueIntervalSeconds()} seconds` });
    expect(fake.calls).toHaveLength(0);
    expect(await db.publishingSchedule.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "RETRY_SCHEDULED", attempts: 0 });
    // The worker's next pass sends it
    await processDueSchedules(inMinutes(1));
    expect(fake.calls.map((x) => x.scheduleId)).toEqual([s.id]);
  });
});

describe("worker cadence (PUB-10)", () => {
  it("fills in analytics for missing days in batches, and only once", async () => {
    const account = await createAccount("youtube");
    const c = await createReadyContent();
    await insertSchedule(c.id, account.id, { status: "PUBLISHED", simulated: true, publishedAt: new Date(Date.now() - 4 * 86_400_000) });
    const first = await syncMockAnalytics();
    expect(first).toBe(5); // four days ago through today
    expect(await syncMockAnalytics()).toBe(0);
    expect(await db.analyticsSnapshot.count()).toBe(5);
    expect(await syncMockAnalytics(new Date(Date.now() + 86_400_000))).toBe(1);
  });

  it("keeps the queue pass small with thousands of published posts", async () => {
    const account = await createAccount("youtube");
    const c = await createReadyContent();
    await db.publishingSchedule.createMany({
      data: Array.from({ length: 5_000 }, (_, i) => ({
        contentId: c.id, accountId: account.id, platformId: "youtube", scheduledAt: new Date(Date.now() - (i + 1) * 60_000),
        timezone: "UTC", title: `Old post ${i}`, status: "PUBLISHED", publishedAt: new Date(Date.now() - i * 60_000),
      })),
    });
    await processDueSchedules(); // warm-up
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await processDueSchedules();
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    console.log(`queue pass with 5,000 published posts: median ${times[2].toFixed(1)} ms`);
    expect(times[2]).toBeLessThan(100);
  });
});
