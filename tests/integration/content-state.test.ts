import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

import { db } from "@/lib/db";
import { deriveContentState } from "@/lib/workflow/rules";
import { archiveContents, createContent, setChecklistFlag, setProductionStatus, syncPublishingStatus } from "@/server/services/content";
import { contentStateSelect, coverAssetId, toContentState } from "@/server/services/content-state";
import { saveImagePrompt } from "@/server/services/image-prompt";
import { createMediaAsset, deleteMediaAsset, setContentThumbnail, setImageSelected } from "@/server/services/media";
import { processSchedule } from "@/server/services/publishing";
import { createSchedule } from "@/server/services/schedule";
import { saveScriptVersion } from "@/server/services/script";
import { getRules } from "@/server/services/settings";
import { updateSettings } from "@/server/services/workspace";
import { createAccount, createReadyContent, inMinutes, seedPlatforms } from "../helpers/factories";
import { fake } from "../helpers/fake-provider";

// WF-03: stage, missing requirements, completion and cover are stored on
// Content. Whatever changes them, the stored values must equal what the rules
// derive from the data at that moment.

const storedSelect = { id: true, stage: true, missingMask: true, completion: true, coverAssetId: true, ...contentStateSelect };

/** Rows whose stored values differ from the derived ones (empty when consistent). */
async function inconsistencies() {
  const rules = await getRules();
  const rows = await db.content.findMany({ select: storedSelect });
  return rows.flatMap((row) => {
    const derived = { ...deriveContentState(toContentState(row), rules), coverAssetId: coverAssetId(row) };
    const stored = { publishingStatus: row.publishingStatus, stage: row.stage, missingMask: row.missingMask, completion: row.completion, coverAssetId: row.coverAssetId };
    return JSON.stringify(stored) === JSON.stringify(derived) ? [] : [{ id: row.id, stored, derived }];
  });
}

const stored = (id: string) => db.content.findUniqueOrThrow({ where: { id }, select: { stage: true, missingMask: true, completion: true, coverAssetId: true, publishingStatus: true } });

let n = 0;
const image = (contentId: string) => createMediaAsset({ contentId, type: "IMAGE", fileName: `frame-${n}.png`, storageKey: `test/frame-${n++}.png`, mimeType: "image/png" });

beforeEach(async () => {
  fake.reset();
  await db.publishingSchedule.deleteMany();
  await db.content.deleteMany();
  await db.mediaAsset.deleteMany();
  await seedPlatforms();
  await db.workspaceSettings.update({ where: { id: 1 }, data: { requireScriptApproved: true, requireImagesApproved: true, requireFinalVideo: true, requireReview: true, requireThumbnail: false } });
});

describe("stored content state (WF-03)", () => {
  it("stays equal to the derived state through the whole workflow", async () => {
    const steps: string[] = [];
    const check = async (step: string) => {
      steps.push(step);
      expect(await inconsistencies(), step).toEqual([]);
    };

    const { id } = await createContent({ title: "Stored state walk-through" });
    await check("created");
    expect(await stored(id)).toMatchObject({ stage: "IDEA", missingMask: 39, completion: 8, coverAssetId: null });

    await saveScriptVersion(id, "Opening line.\nSecond line.");
    await check("script saved");
    expect((await stored(id)).stage).toBe("SCRIPT");

    await setProductionStatus(id, "scriptStatus", "APPROVED");
    await saveImagePrompt(id, { prompt: "A lighthouse at dusk" });
    await check("script approved, prompt saved");
    expect((await stored(id)).stage).toBe("IMAGES");

    const first = await image(id);
    const second = await image(id);
    await check("images uploaded");
    expect((await stored(id)).coverAssetId).toBe(first.id);

    await setImageSelected(second.id, true);
    await check("image selected");
    expect((await stored(id)).coverAssetId).toBe(second.id);

    await setProductionStatus(id, "imageStatus", "APPROVED");
    await createMediaAsset({ contentId: id, type: "VIDEO", fileName: "final.mp4", storageKey: "test/final.mp4", mimeType: "video/mp4" });
    await check("video uploaded");
    expect(await stored(id)).toMatchObject({ stage: "VIDEO", missingMask: 16 + 32 });

    await setProductionStatus(id, "videoStatus", "FINAL");
    await setContentThumbnail(id, first.id);
    await setChecklistFlag(id, "titleFinalized", true);
    await check("video final, thumbnail, title finalized");
    expect(await stored(id)).toMatchObject({ stage: "REVIEW", coverAssetId: first.id });

    await setProductionStatus(id, "reviewStatus", "APPROVED");
    await check("reviewed");
    expect(await stored(id)).toMatchObject({ stage: "READY", missingMask: 0, publishingStatus: "READY" });

    // Rule changes recompute every item
    await setContentThumbnail(id, null);
    await updateSettings({ requireThumbnail: true });
    await check("thumbnail rule on, no thumbnail");
    expect(await stored(id)).toMatchObject({ missingMask: 64, publishingStatus: "NOT_READY" });
    await updateSettings({ requireThumbnail: false });
    await check("thumbnail rule off");

    const account = await createAccount("youtube");
    const s = await createSchedule({ contentId: id, platformId: "youtube", accountId: account.id, ...inMinutes(60), title: "Stored state walk-through" });
    await check("scheduled");
    expect((await stored(id)).stage).toBe("SCHEDULED");

    await db.publishingSchedule.update({ where: { id: s.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    expect(await processSchedule(s.id)).toBe("published");
    await check("published");
    expect((await stored(id)).stage).toBe("PUBLISHED");

    await deleteMediaAsset(second.id);
    await check("cover image deleted");
    expect((await stored(id)).coverAssetId).toBe(first.id);

    await archiveContents([id]);
    await check("archived");
    expect(steps).toHaveLength(14);
  });

  it("the migration's backfill computes the same values as the code", async () => {
    // A spread of states, under rules that differ from the defaults
    await updateSettings({ requireThumbnail: true, requireReview: false });
    const ready = await createReadyContent();
    await setContentThumbnail(ready.id, null);
    await createContent({ title: "Untouched" });
    const scripted = await createContent({ title: "Scripted", hashtags: "#a" });
    await saveScriptVersion(scripted.id, "Some text");
    await image(scripted.id);
    await setChecklistFlag(scripted.id, "descriptionFinalized", true);
    // Whitespace is no script and no hashtags, in SQL as in the code
    const blank = await createContent({ title: "Blank" });
    await db.content.update({ where: { id: blank.id }, data: { hashtags: " \t " } });
    await db.script.update({ where: { contentId: blank.id }, data: { body: " \n\t " } });
    await syncPublishingStatus(blank.id);
    const scheduled = await createReadyContent();
    const frame = await db.mediaAsset.findFirstOrThrow({ where: { contentId: scheduled.id, type: "IMAGE" } });
    await setContentThumbnail(scheduled.id, frame.id);
    const account = await createAccount("youtube");
    await createSchedule({ contentId: scheduled.id, platformId: "youtube", accountId: account.id, ...inMinutes(90), title: "Scheduled" });
    expect(await inconsistencies()).toEqual([]);
    const before = await db.content.findMany({ select: { id: true, stage: true, missingMask: true, completion: true, coverAssetId: true }, orderBy: { id: "asc" } });

    // Forget the stored values, then run the backfill statement of the migration
    await db.$executeRaw`UPDATE "Content" SET "stage" = 'IDEA', "missingMask" = 0, "completion" = 0, "coverAssetId" = NULL`;
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261014075226_content_state/migration.sql"), "utf8");
    const backfill = sql.slice(sql.indexOf("WITH r AS ("));
    expect(backfill).toMatch(/^WITH r AS \(/);
    await db.$executeRawUnsafe(backfill);

    expect(await inconsistencies()).toEqual([]);
    expect(await db.content.findMany({ select: { id: true, stage: true, missingMask: true, completion: true, coverAssetId: true }, orderBy: { id: "asc" } })).toEqual(before);
    expect(new Set(before.map((c) => c.stage))).toEqual(new Set(["VIDEO", "IDEA", "SCRIPT", "SCHEDULED"]));
  });

  it("refreshing derived values does not count as an edit", async () => {
    const c = await createReadyContent();
    const { updatedAt } = await db.content.findUniqueOrThrow({ where: { id: c.id }, select: { updatedAt: true } });
    await updateSettings({ requireThumbnail: true });
    const after = await db.content.findUniqueOrThrow({ where: { id: c.id }, select: { updatedAt: true, missingMask: true } });
    expect(after.missingMask).toBe(64);
    expect(after.updatedAt).toEqual(updatedAt);
  });
});
