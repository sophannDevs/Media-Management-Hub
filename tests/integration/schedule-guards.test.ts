import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

import { db } from "@/lib/db";
import { createSchedule } from "@/server/services/schedule";
import { createAccount, createReadyContent, inMinutes, seedPlatforms } from "../helpers/factories";

beforeEach(async () => {
  await seedPlatforms();
  await db.workspaceSettings.update({ where: { id: 1 }, data: { requireFinalVideo: true } });
});

describe("schedule guards", () => {
  it("creates a schedule for ready content", async () => {
    const account = await createAccount("youtube");
    const content = await createReadyContent();
    const s = await createSchedule({ contentId: content.id, platformId: "youtube", accountId: account.id, title: "Launch", ...inMinutes(60) });
    expect(s.status).toBe("WAITING");
  });

  it.fails("PUB-03: scheduling the same post twice at once leaves one active schedule", async () => {
    const account = await createAccount("youtube");
    const content = await createReadyContent();
    const input = { contentId: content.id, platformId: "youtube", accountId: account.id, title: "Launch", ...inMinutes(60) };

    const results = await Promise.allSettled([createSchedule(input), createSchedule(input)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.publishingSchedule.count({ where: { contentId: content.id } })).toBe(1);
  });

  it.fails("WF-01: content without a video cannot be scheduled even with the video rule off", async () => {
    await db.workspaceSettings.update({ where: { id: 1 }, data: { requireFinalVideo: false } });
    const account = await createAccount("youtube");
    const content = await createReadyContent();
    await db.content.update({ where: { id: content.id }, data: { videoAssetId: null, videoStatus: "NOT_STARTED" } });

    await expect(
      createSchedule({ contentId: content.id, platformId: "youtube", accountId: account.id, title: "No video", ...inMinutes(60) }),
    ).rejects.toThrow(/video/i);
  });
});
