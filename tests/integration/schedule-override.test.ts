import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

import { db } from "@/lib/db";
import { processSchedule } from "@/server/services/publishing";
import { createSchedule, removeOverride, updateSchedule } from "@/server/services/schedule";
import { createAccount, createReadyContent, inMinutes, seedPlatforms } from "../helpers/factories";
import { fake } from "../helpers/fake-provider";

beforeEach(async () => {
  fake.reset();
  await seedPlatforms();
  await db.workspaceSettings.update({ where: { id: 1 }, data: { requireFinalVideo: true, requireReview: true } });
});

/** Content with a final video whose review is still open: only a soft requirement is missing. */
async function inReview() {
  const account = await createAccount("youtube");
  const content = await createReadyContent({ reviewStatus: "IN_REVIEW", publishingStatus: "NOT_READY" });
  const input = { contentId: content.id, platformId: "youtube", accountId: account.id, title: "Early", ...inMinutes(60) };
  return { account, content, input };
}

describe("schedule override (WF-01)", () => {
  it("content without a video cannot be scheduled even with the video rule off", async () => {
    await db.workspaceSettings.update({ where: { id: 1 }, data: { requireFinalVideo: false } });
    const account = await createAccount("youtube");
    const content = await createReadyContent();
    await db.content.update({ where: { id: content.id }, data: { videoAssetId: null, videoStatus: "NOT_STARTED" } });
    const input = { contentId: content.id, platformId: "youtube", accountId: account.id, title: "No video", ...inMinutes(60) };

    await expect(createSchedule(input)).rejects.toMatchObject({ details: [expect.stringMatching(/can't be overridden: final video is missing/)] });
    await expect(createSchedule({ ...input, override: { reason: "Ship it" } })).rejects.toThrow();
    expect(await db.publishingSchedule.count({ where: { contentId: content.id } })).toBe(0);
  });

  it("refuses an override without a reason", async () => {
    const { input } = await inReview();
    await expect(createSchedule({ ...input, override: { reason: " " } })).rejects.toMatchObject({
      details: ["Give a reason for scheduling before the content is ready."],
    });
  });

  it("records the override with its reason and logs it", async () => {
    const { content, input } = await inReview();
    const s = await createSchedule({ ...input, override: { reason: "Client approved by phone" } });

    expect(JSON.parse(s.overrideRules!)).toEqual(["review"]);
    expect(s.overrideReason).toBe("Client approved by phone");
    expect(s.overrideAt).toBeInstanceOf(Date);
    const log = await db.activityLog.findFirstOrThrow({ where: { contentId: content.id, type: "schedule.override" } });
    expect(log.message).toContain("Client approved by phone");
    expect(log.message).toContain("content has not been reviewed");
  });

  it("publishes an overridden post, and stops it once the override is removed", async () => {
    const { input } = await inReview();
    const kept = await createSchedule({ ...input, override: { reason: "Approved by phone" } });
    await db.publishingSchedule.update({ where: { id: kept.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    expect(await processSchedule(kept.id)).toBe("published");

    const { input: other } = await inReview();
    const revoked = await createSchedule({ ...other, override: { reason: "Approved by phone" } });
    await removeOverride(revoked.id);
    await db.publishingSchedule.update({ where: { id: revoked.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    expect(await processSchedule(revoked.id)).toBe("failed");
    const after = await db.publishingSchedule.findUniqueOrThrow({ where: { id: revoked.id } });
    expect(after.lastErrorCode).toBe("VALIDATION");
    expect(after.lastError).toContain("content has not been reviewed");
    expect(fake.calls).toHaveLength(1);
  });

  it("drops the override on edit once the content is ready", async () => {
    const { content, input } = await inReview();
    const s = await createSchedule({ ...input, override: { reason: "Approved by phone" } });
    await db.content.update({ where: { id: content.id }, data: { reviewStatus: "APPROVED" } });

    await updateSchedule(s.id, { ...input, title: "Edited" });

    const after = await db.publishingSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.overrideRules).toBeNull();
    expect(after.overrideReason).toBeNull();
  });
});
