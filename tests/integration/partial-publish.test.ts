import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getContentList } from "@/server/queries/content";
import { contentSummarySelect, toSummary } from "@/server/queries/shared";
import { syncPublishingStatus } from "@/server/services/content";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";

// WF-02: per-platform results don't collapse into one word.

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

beforeEach(async () => {
  await seedPlatforms();
  await db.content.deleteMany();
  await db.socialAccount.deleteMany();
});

describe("per-platform results (WF-02)", () => {
  it("a video live on one platform and failed on another is Partly Published, with a chip per post", async () => {
    const yt = await createAccount("youtube", { name: "Main channel" });
    const fb = await createAccount("facebook", { name: "Brand page" });
    const c = await createReadyContent({ title: "Mixed" });
    await insertSchedule(c.id, yt.id, { status: "PUBLISHED", scheduledAt: at(120) });
    await insertSchedule(c.id, fb.id, { status: "FAILED", scheduledAt: at(60) });

    expect(await syncPublishingStatus(c.id)).toBe("PARTIAL");
    expect(await db.content.findUniqueOrThrow({ where: { id: c.id }, select: { publishingStatus: true, stage: true } })).toEqual({ publishingStatus: "PARTIAL", stage: "PARTIAL" });

    const summary = toSummary(await db.content.findUniqueOrThrow({ where: { id: c.id }, select: contentSummarySelect }), new Date());
    expect(summary.stage).toBe("PARTIAL");
    expect(summary.posts.map((p) => [p.platformId, p.status, p.account, p.simulated])).toEqual([
      ["youtube", "PUBLISHED", "Main channel", false],
      ["facebook", "FAILED", "Brand page", false],
    ]);

    // A retry on Facebook: the summary says scheduled again, the chips still show YouTube live
    await db.publishingSchedule.updateMany({ where: { contentId: c.id, platformId: "facebook" }, data: { status: "RETRY_SCHEDULED" } });
    expect(await syncPublishingStatus(c.id)).toBe("SCHEDULED");
    // Cancelled posts don't count
    await db.publishingSchedule.updateMany({ where: { contentId: c.id, platformId: "facebook" }, data: { status: "CANCELLED" } });
    expect(await syncPublishingStatus(c.id)).toBe("PUBLISHED");
  });

  it("the list filters by published on any platform, on every platform it was posted to, or not yet", async () => {
    const yt = await createAccount("youtube");
    const fb = await createAccount("facebook");
    const make = async (title: string, posts: [string, string][]) => {
      const c = await createReadyContent({ title });
      for (const [account, status] of posts) await insertSchedule(c.id, account === "yt" ? yt.id : fb.id, { status });
      await syncPublishingStatus(c.id);
      return c;
    };
    await make("Partial", [["yt", "PUBLISHED"], ["fb", "FAILED"]]);
    await make("Full", [["yt", "PUBLISHED"], ["fb", "PUBLISHED"]]);
    await make("One of one", [["yt", "PUBLISHED"]]);
    await make("Pending", [["yt", "WAITING"]]);
    await make("Nothing yet", []);

    const titles = async (params: Parameters<typeof getContentList>[0]) => (await getContentList(params)).items.map((i) => i.title).sort();
    expect(await titles({ published: "any" })).toEqual(["Full", "One of one", "Partial"]);
    expect(await titles({ published: "all" })).toEqual(["Full", "One of one"]);
    expect(await titles({ published: "none" })).toEqual(["Nothing yet", "Pending"]);
    expect(await titles({ stage: "PARTIAL" })).toEqual(["Partial"]);
    expect(await titles({ stage: "PUBLISHED" })).toEqual(["Full", "One of one"]);
    expect(await titles({ published: "any", stage: "PARTIAL" })).toEqual(["Partial"]);
  });
});
