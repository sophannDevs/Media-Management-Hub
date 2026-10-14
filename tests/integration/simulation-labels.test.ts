import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

import { db } from "@/lib/db";
import { syncMockAnalytics } from "@/server/services/analytics-sync";
import { processSchedule } from "@/server/services/publishing";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";
import { fake } from "../helpers/fake-provider";

beforeEach(async () => {
  fake.reset();
  await db.analyticsSnapshot.deleteMany();
  await db.publishingSchedule.deleteMany();
  await seedPlatforms();
});

async function publishWith(mock: boolean) {
  fake.mock = mock;
  const account = await createAccount("youtube");
  const content = await createReadyContent();
  const s = await insertSchedule(content.id, account.id, { activeKey: `${content.id}:${account.id}` });
  expect(await processSchedule(s.id)).toBe("published");
  return db.publishingSchedule.findUniqueOrThrow({ where: { id: s.id } });
}

describe("simulation labels (PUB-05)", () => {
  it("a post published by a simulated provider is recorded as simulated and announced as such", async () => {
    const s = await publishWith(true);
    expect(s.simulated).toBe(true);
    const n = await db.notification.findUniqueOrThrow({ where: { dedupeKey: `published:${s.id}` } });
    expect(n.title).toBe("Simulated publish complete");
    expect(n.message).toContain("Nothing was sent to YouTube");
  });

  it("a post published by a real provider is not marked simulated", async () => {
    const s = await publishWith(false);
    expect(s.simulated).toBe(false);
    const n = await db.notification.findUniqueOrThrow({ where: { dedupeKey: `published:${s.id}` } });
    expect(n.title).toBe("Successfully published");
  });

  it("generates metrics only for simulated posts, and marks them MOCK", async () => {
    const simulated = await publishWith(true);
    const real = await publishWith(false);

    await syncMockAnalytics();

    const rows = await db.analyticsSnapshot.findMany({ select: { scheduleId: true, source: true } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.scheduleId === simulated.id && r.source === "MOCK")).toBe(true);
    expect(rows.some((r) => r.scheduleId === real.id)).toBe(false);
  });
});
