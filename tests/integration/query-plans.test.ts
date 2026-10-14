import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";

// DB-01: the hot lookups are served by an index, not a table scan.
async function plan(sql: string) {
  const rows = await db.$queryRawUnsafe<{ detail: string }[]>(`EXPLAIN QUERY PLAN ${sql}`);
  return rows.map((r) => r.detail).join(" | ");
}

describe("query plans (DB-01)", () => {
  it("serves a file request by storage key from an index", async () => {
    const p = await plan(`SELECT "mimeType", "fileName" FROM "MediaAsset" WHERE "storageKey" = 'media/2026/10/x.mp4'`);
    expect(p).toContain("USING INDEX MediaAsset_storageKey_key");
    expect(p).not.toMatch(/SCAN MediaAsset\b(?! USING)/);
  });

  it("finds due retries from an index", async () => {
    const p = await plan(`SELECT "id" FROM "PublishingSchedule" WHERE "status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= 0`);
    expect(p).toContain("PublishingSchedule_status_nextAttemptAt_idx");
  });

  it("lists an account's posts from an index", async () => {
    const p = await plan(`SELECT "id" FROM "PublishingSchedule" WHERE "accountId" = 'acc'`);
    expect(p).toContain("PublishingSchedule_accountId_idx");
  });

  it("lists a platform's posts in a time range from an index", async () => {
    const p = await plan(`SELECT "id" FROM "PublishingSchedule" WHERE "platformId" = 'youtube' AND "scheduledAt" >= 0 AND "scheduledAt" < 1`);
    expect(p).toContain("PublishingSchedule_platformId_scheduledAt_idx");
  });
});
