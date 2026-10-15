import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { syncAllPublishingStatuses, syncPublishingStatus, syncPublishingStatuses } from "@/server/services/content";
import { deleteMediaAssets } from "@/server/services/media";
import { updateSettings } from "@/server/services/workspace";
import { createReadyContent, seedPlatforms } from "../helpers/factories";

// WF-04: the status recompute is one transaction per pass, not three queries per item.

const stageOf = async (id: string) => (await db.content.findUniqueOrThrow({ where: { id }, select: { stage: true } })).stage;

beforeEach(async () => {
  await seedPlatforms();
  await db.content.deleteMany();
  await db.activityLog.deleteMany();
  await db.notification.deleteMany();
  await db.workspaceSettings.update({ where: { id: 1 }, data: { requireFinalVideo: true } });
});

describe("status recompute (WF-04)", () => {
  it("a rule change recomputes every item in one pass and reports it once", async () => {
    const done = await createReadyContent({ title: "Done" });
    const cutting = await createReadyContent({ title: "Cutting", videoStatus: "EDITING" });
    const draft = await createReadyContent({ title: "Rough cut", videoStatus: "EDITING" });
    expect([await stageOf(done.id), await stageOf(cutting.id), await stageOf(draft.id)]).toEqual(["READY", "VIDEO", "VIDEO"]);

    const r = await updateSettings({ requireFinalVideo: false });
    expect(r.recomputed).toEqual({ count: 3, updated: 2, ready: 2 });
    expect([await stageOf(cutting.id), await stageOf(draft.id)]).toEqual(["READY", "READY"]);
    // One event for the rule change, not one per item
    const logs = await db.activityLog.findMany({ where: { type: "status.changed" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ contentId: null, entityType: "SETTINGS", message: "Workflow rules changed: 2 items now Ready to Post", meta: { recomputed: 3, updated: 2, ready: 2 } });
    expect(await db.notification.count()).toBe(1);

    expect((await updateSettings({ requireFinalVideo: true })).recomputed).toEqual({ count: 3, updated: 2, ready: 0 });
    expect(await stageOf(cutting.id)).toBe("VIDEO");
    expect(await db.activityLog.count({ where: { type: "status.changed" } })).toBe(1); // nothing became ready: nothing to say
    // A save that doesn't touch the rules recomputes nothing
    expect((await updateSettings({ workspaceName: "Studio" })).recomputed).toBeNull();
  });

  it("a single change still announces readiness, once", async () => {
    const c = await createReadyContent({ title: "Nearly", videoStatus: "EDITING" });
    expect(await stageOf(c.id)).toBe("VIDEO");
    await db.content.update({ where: { id: c.id }, data: { videoStatus: "FINAL" } });
    expect(await syncPublishingStatus(c.id)).toBe("READY");
    expect(await syncPublishingStatus(c.id)).toBe("READY");
    expect(await db.activityLog.findMany({ where: { contentId: c.id, type: "status.changed" } })).toHaveLength(1);
    expect(await syncPublishingStatus("no-such-content")).toBeNull();
  });

  it("bulk actions recompute their items together, once", async () => {
    const a = await createReadyContent({ title: "A" });
    const b = await createReadyContent({ title: "B" });
    const r = await syncPublishingStatuses([a.id, b.id, "missing", a.id]);
    expect(r).toMatchObject({ count: 2, updated: 0, ready: [] });
    expect([...r.status.entries()].sort()).toEqual([
      [a.id, "READY"],
      [b.id, "READY"],
    ]);
    expect(await syncPublishingStatuses([])).toMatchObject({ count: 0, updated: 0 });

    // Deleting the only image of each: both go back to Image Pending in one pass
    const images = await db.mediaAsset.findMany({ where: { type: "IMAGE", contentId: { in: [a.id, b.id] } }, select: { id: true } });
    expect(await deleteMediaAssets(images.map((i) => i.id))).toEqual({ removed: 2 });
    expect([await stageOf(a.id), await stageOf(b.id)]).toEqual(["IMAGES", "IMAGES"]);
  });

  it("the stored values are what a fresh pass would compute, even with changes landing at the same time", async () => {
    const c = await createReadyContent({ title: "Busy" });
    await Promise.all([
      syncPublishingStatus(c.id),
      (async () => {
        await db.content.update({ where: { id: c.id }, data: { videoStatus: "EDITING" } });
        await syncPublishingStatus(c.id);
      })(),
      syncAllPublishingStatuses(),
    ]);
    expect(await stageOf(c.id)).toBe("VIDEO");
    expect((await syncPublishingStatuses([c.id])).updated).toBe(0);
  });
});
