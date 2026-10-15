import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Files go to a throwaway folder (the storage root is read when the module loads)
const dir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const p = mkdtempSync(join(tmpdir(), "mediaflow-reconcile-"));
  process.env.STORAGE_DIR = p;
  return p;
});

import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { createMediaAsset } from "@/server/services/media";
import { RECONCILE_GRACE_MS, reconcileStorage } from "@/server/services/storage-reconcile";
import { runPeriodic } from "@/server/worker";
import { seedPlatforms } from "../helpers/factories";

// MEDIA-03: storage and the database are brought back in step.

const DAY = 86_400_000;
const put = (key: string, ageMs = 0) => {
  const full = path.join(dir, key);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, Buffer.alloc(16, 1));
  if (ageMs) {
    const t = (Date.now() - ageMs) / 1000;
    utimesSync(full, t, t);
  }
};

beforeEach(async () => {
  await seedPlatforms();
  await db.mediaAsset.deleteMany();
  rmSync(path.join(dir, "media"), { recursive: true, force: true });
  rmSync(path.join(dir, "seed"), { recursive: true, force: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("storage reconcile (MEDIA-03)", () => {
  it("removes old files no asset references, keeps young ones and referenced ones, and reports assets whose file is gone", async () => {
    put("media/2026/10/kept.mp4", 3 * DAY);
    await createMediaAsset({ type: "VIDEO", fileName: "kept.mp4", storageKey: "media/2026/10/kept.mp4", mimeType: "video/mp4", size: 16 });
    put("media/2026/10/old-stray.mp4", 2 * DAY);
    put("media/2026/09/older-stray.png", 40 * DAY);
    put("media/2026/10/fresh-stray.mp4"); // an upload being registered right now
    await createMediaAsset({ type: "IMAGE", fileName: "vanished.png", storageKey: "media/2026/10/vanished.png", mimeType: "image/png", size: 16 });
    // Files outside the listed prefix (the seed's, an older layout) are looked up one by one, never presumed missing
    put("seed/c1/thumbnail.svg", 3 * DAY);
    await createMediaAsset({ type: "IMAGE", fileName: "thumbnail.svg", storageKey: "seed/c1/thumbnail.svg", mimeType: "image/svg+xml", size: 16 });
    await createMediaAsset({ type: "IMAGE", fileName: "seed-gone.svg", storageKey: "seed/c1/gone.svg", mimeType: "image/svg+xml", size: 16 });

    const dry = await reconcileStorage({ dryRun: true });
    expect(dry).toMatchObject({ listed: 4, referenced: 1, pending: 1, dryRun: true });
    expect(dry.orphans.sort()).toEqual(["media/2026/09/older-stray.png", "media/2026/10/old-stray.mp4"]);
    expect(dry.missing.map((m) => m.storageKey).sort()).toEqual(["media/2026/10/vanished.png", "seed/c1/gone.svg"]);
    expect(dry.missing.find((m) => m.fileName === "vanished.png")).toMatchObject({ id: expect.any(String) });
    expect(await storage.stat("media/2026/10/old-stray.mp4")).not.toBeNull(); // a dry run removes nothing

    const real = await reconcileStorage();
    expect(real.orphans).toHaveLength(2);
    expect(await storage.stat("media/2026/10/old-stray.mp4")).toBeNull();
    expect(await storage.stat("media/2026/09/older-stray.png")).toBeNull();
    expect(await storage.stat("media/2026/10/kept.mp4")).not.toBeNull();
    expect(await storage.stat("media/2026/10/fresh-stray.mp4")).not.toBeNull();
    // The asset without a file is reported, not deleted
    expect(await db.mediaAsset.count({ where: { fileName: { in: ["vanished.png", "seed-gone.svg"] } } })).toBe(2);
    expect(await storage.stat("seed/c1/thumbnail.svg")).not.toBeNull(); // outside the prefix: never removed either

    const again = await reconcileStorage();
    expect(again).toMatchObject({ listed: 2, referenced: 1, orphans: [], pending: 1 });
  });

  it("respects the grace period it is given", async () => {
    put("media/2026/10/hour-old.mp4", 3_600_000);
    expect((await reconcileStorage({ dryRun: true })).orphans).toEqual([]);
    expect((await reconcileStorage({ dryRun: true, graceMs: 60_000 })).orphans).toEqual(["media/2026/10/hour-old.mp4"]);
    expect(RECONCILE_GRACE_MS).toBe(DAY);
  });
});

describe("the worker's daily pass (MEDIA-03)", () => {
  it("runs the reconcile once a day across workers", async () => {
    await db.scheduledTask.deleteMany({ where: { name: "storage-reconcile" } });
    let runs = 0;
    const job = async () => void runs++;
    expect(await runPeriodic("storage-reconcile", job)).toBe(true);
    expect(await runPeriodic("storage-reconcile", job)).toBe(false); // same day: another worker, or the next tick
    expect(await runPeriodic("storage-reconcile", job, new Date(Date.now() + 25 * 3_600_000))).toBe(true);
    expect(runs).toBe(2);
    const task = await db.scheduledTask.findUniqueOrThrow({ where: { name: "storage-reconcile" } });
    expect(task.lastFinishedAt).toBeInstanceOf(Date);
    expect(task.lastError).toBeNull();
  });
});
