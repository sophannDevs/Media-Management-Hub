import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";

// DB-01: the hot lookups can be served by an index. Test tables are tiny, so
// PostgreSQL would rightly prefer a sequential scan; it is switched off for the
// check, which then shows whether a usable index exists.
async function plan(sql: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
    const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${sql}`);
    return rows.map((r) => r["QUERY PLAN"]).join(" | ");
  });
}

describe("query plans (DB-01)", () => {
  it("serves a file request by storage key from an index", async () => {
    const p = await plan(`SELECT "mimeType", "fileName" FROM "MediaAsset" WHERE "storageKey" = 'media/2026/10/x.mp4'`);
    expect(p).toMatch(/Index.* on "?MediaAsset_storageKey_key"?|Index Scan using "?MediaAsset_storageKey_key"?/);
  });

  it("finds due retries from an index", async () => {
    const p = await plan(`SELECT "id" FROM "PublishingSchedule" WHERE "status" = 'RETRY_SCHEDULED' AND "nextAttemptAt" <= now()`);
    // On empty tables any index on status ties; what matters is that one serves both conditions
    expect(p).toMatch(/Index Cond: .*status.*nextAttemptAt/);
  });

  it("lists an account's posts from an index", async () => {
    const p = await plan(`SELECT "id" FROM "PublishingSchedule" WHERE "accountId" = 'acc'`);
    expect(p).toContain("PublishingSchedule_accountId_idx");
  });

  it("lists content of a stage, newest first, from an index (WF-03)", async () => {
    const p = await plan(`SELECT "id" FROM "Content" WHERE "archivedAt" IS NULL AND "stage" = 'READY' ORDER BY "updatedAt" DESC LIMIT 50`);
    expect(p).toContain("Content_archivedAt_stage_updatedAt_idx");
  });

  it("lists a platform's posts in a time range from an index", async () => {
    const p = await plan(`SELECT "id" FROM "PublishingSchedule" WHERE "platformId" = 'youtube' AND "scheduledAt" >= now() AND "scheduledAt" < now() + interval '1 day'`);
    expect(p).toContain("PublishingSchedule_platformId_scheduledAt_idx");
  });
});
