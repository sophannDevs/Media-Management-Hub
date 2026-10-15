import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { GET as duplicate } from "@/app/api/media/duplicate/route";
import { db } from "@/lib/db";
import { bulkAssignMediaAction, bulkDeleteMediaAction } from "@/server/actions/media";
import { createContent } from "@/server/services/content";
import { assignMediaToContents, createMediaAsset, deleteMediaAssets, findDuplicate } from "@/server/services/media";
import { seedPlatforms } from "../helpers/factories";

// MEDIA-02: several files at once, and the same file twice.

const linked = (type: string, name: string, contentId: string | null = null, extra: Partial<Parameters<typeof createMediaAsset>[0]> = {}) =>
  createMediaAsset({ contentId, type, fileName: name, externalUrl: `https://cdn.test/${name}`, mimeType: type === "IMAGE" ? "image/png" : "video/mp4", size: 10, ...extra });

beforeEach(async () => {
  await seedPlatforms();
  await db.mediaAsset.deleteMany();
  await db.content.deleteMany();
});

describe("bulk delete (MEDIA-02)", () => {
  it("removes several files with each one's workflow side effects, and skips ones already gone", async () => {
    const c = await createContent({ title: "Bulk target" });
    const video = await linked("VIDEO", "final.mp4", c.id);
    const image = await linked("IMAGE", "a.png", c.id);
    const loose = await linked("IMAGE", "loose.png");
    expect((await db.content.findUniqueOrThrow({ where: { id: c.id } })).videoAssetId).toBe(video.id);

    const r = await bulkDeleteMediaAction([video.id, image.id, loose.id, "no-such-asset"]);
    expect(r).toMatchObject({ ok: true, message: "3 files deleted" });
    expect(await db.mediaAsset.count()).toBe(0);
    const after = await db.content.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.videoAssetId).toBeNull();
    expect(after.videoStatus).toBe("NOT_STARTED");
    expect(after.imageStatus).toBe("NOT_STARTED");

    expect(await deleteMediaAssets([])).toEqual({ removed: 0 });
    expect(await bulkDeleteMediaAction([])).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("bulk move (MEDIA-02)", () => {
  it("moves several files to one content item, or unassigns them", async () => {
    const from = await createContent({ title: "From" });
    const to = await createContent({ title: "To" });
    const a = await linked("IMAGE", "a.png", from.id);
    const b = await linked("IMAGE", "b.png");
    const r = await bulkAssignMediaAction([a.id, b.id], to.id);
    expect(r).toMatchObject({ ok: true, message: "2 files moved" });
    const rows = await db.mediaAsset.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.every((x) => x.contentId === to.id)).toBe(true);
    expect((await db.content.findUniqueOrThrow({ where: { id: to.id } })).imageStatus).toBe("GENERATED");
    expect((await db.content.findUniqueOrThrow({ where: { id: from.id } })).imageStatus).toBe("NOT_STARTED");

    expect(await bulkAssignMediaAction([a.id, b.id], null)).toMatchObject({ ok: true, message: "2 files unassigned" });
    expect((await db.mediaAsset.findMany({ where: { id: { in: [a.id, b.id] } } })).every((x) => x.contentId === null)).toBe(true);
    expect(await bulkAssignMediaAction([a.id], "no-such-content")).toMatchObject({ ok: false, error: "Content not found." });
    expect(await assignMediaToContents(["gone"], null)).toEqual({ moved: 0 });
  });
});

describe("duplicate detection (MEDIA-02)", () => {
  const SHA = "a".repeat(64);

  it("finds the earliest stored file with the same bytes and the content it belongs to", async () => {
    expect(await findDuplicate(SHA)).toBeNull();
    const c = await createContent({ title: "Owner" });
    const first = await createMediaAsset({ contentId: c.id, type: "VIDEO", fileName: "one.mp4", storageKey: "media/2026/10/one.mp4", mimeType: "video/mp4", size: 10, sha256: SHA });
    await createMediaAsset({ type: "VIDEO", fileName: "two.mp4", storageKey: "media/2026/10/two.mp4", mimeType: "video/mp4", size: 10, sha256: SHA });
    // A linked file with the same hash is not a stored copy
    await linked("VIDEO", "linked.mp4", null, { sha256: SHA });
    expect(await findDuplicate(SHA)).toMatchObject({ id: first.id, fileName: "one.mp4", type: "VIDEO", content: { id: c.id, title: "Owner" } });
    expect(await findDuplicate(SHA, first.id)).toMatchObject({ fileName: "two.mp4" });
  });

  it("answers the browser's early check", async () => {
    const get = (q: string) => duplicate(new Request(`http://app.test/api/media/duplicate?${q}`, { headers: { host: "app.test" } }));
    expect((await get("sha256=nope")).status).toBe(400);
    expect(await (await get(`sha256=${SHA}`)).json()).toEqual({ ok: true, duplicateOf: null });
    await createMediaAsset({ type: "IMAGE", fileName: "pic.png", storageKey: "media/2026/10/pic.png", mimeType: "image/png", size: 5, sha256: SHA });
    const found = await (await get(`sha256=${SHA.toUpperCase()}`)).json();
    expect(found.duplicateOf).toMatchObject({ fileName: "pic.png", type: "IMAGE", content: null });
  });
});
