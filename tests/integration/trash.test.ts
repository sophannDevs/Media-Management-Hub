import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getContentList } from "@/server/queries/content";
import { getSettingsData } from "@/server/queries/settings";
import { archiveContents, purgeContents, purgeExpiredTrash, restoreFromTrash, TRASH_DAYS, trashContents } from "@/server/services/content";
import { runPeriodic } from "@/server/worker";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";

// WF-05: deleting content keeps its history until a person, not a cascade, removes it.

const DAY = 86_400_000;
const flags = (id: string) => db.content.findUniqueOrThrow({ where: { id }, select: { archivedAt: true, deletedAt: true, trashedFromArchive: true } });
const listed = async () => (await getContentList({})).items.map((i) => i.title).sort();
const inTrash = async () => (await getSettingsData()).trash.map((t) => t.title).sort();

beforeEach(async () => {
  await seedPlatforms();
  await db.content.deleteMany();
  await db.socialAccount.deleteMany();
  await db.activityLog.deleteMany();
  await db.scheduledTask.deleteMany();
});

describe("the trash (WF-05)", () => {
  it("moving content to the trash hides it, takes its waiting posts out of the queue and keeps everything else", async () => {
    const account = await createAccount("youtube");
    const c = await createReadyContent({ title: "Going" });
    const waiting = await insertSchedule(c.id, account.id, { status: "WAITING", scheduledAt: new Date(Date.now() + DAY) });
    await insertSchedule(c.id, account.id, { status: "PUBLISHED", scheduledAt: new Date(Date.now() - DAY) });

    expect(await trashContents([c.id])).toEqual({ trashed: 1, cancelled: 1 });
    expect(await flags(c.id)).toMatchObject({ deletedAt: expect.any(Date), archivedAt: expect.any(Date), trashedFromArchive: false });
    expect(await listed()).toEqual([]);
    const settings = await getSettingsData();
    expect(settings.archived).toEqual([]); // the trash is not the archive
    expect(settings.trash.map((t) => [t.title, t.publishedPosts, t.pausedPosts, t.fromArchive, t.purgeLabel])).toEqual([["Going", 1, 1, false, null]]);
    // Nothing of it is gone: both posts are there, the waiting one remembered as such
    expect(await db.publishingSchedule.count({ where: { contentId: c.id } })).toBe(2);
    expect(await db.publishingSchedule.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ status: "CANCELLED", archivedStatus: "WAITING" });
    expect(await db.mediaAsset.count({ where: { contentId: c.id } })).toBe(2);
    expect((await db.activityLog.findMany({ where: { contentId: c.id, type: "content.updated" } })).map((l) => l.message)).toEqual(["Moved to the trash"]);
    // Already there: nothing to do
    expect(await trashContents([c.id])).toEqual({ trashed: 0, cancelled: 0 });
  });

  it("restoring puts it back where it was: active with its posts, or still archived", async () => {
    const account = await createAccount("youtube");
    const active = await createReadyContent({ title: "Active" });
    const post = await insertSchedule(active.id, account.id, { status: "WAITING", scheduledAt: new Date(Date.now() + DAY) });
    await trashContents([active.id]);
    expect(await restoreFromTrash([active.id])).toEqual({ count: 1, restored: 1, expired: 0, conflicts: 0 });
    expect(await flags(active.id)).toMatchObject({ deletedAt: null, archivedAt: null });
    expect((await db.publishingSchedule.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("WAITING");

    const shelved = await createReadyContent({ title: "Shelved" });
    await archiveContents([shelved.id]);
    await trashContents([shelved.id]);
    expect(await flags(shelved.id)).toMatchObject({ deletedAt: expect.any(Date), trashedFromArchive: true });
    expect(await restoreFromTrash([shelved.id])).toEqual({ count: 1, restored: 0, expired: 0, conflicts: 0 });
    expect(await flags(shelved.id)).toMatchObject({ deletedAt: null, archivedAt: expect.any(Date) });

    expect(await listed()).toEqual(["Active"]);
    expect((await getSettingsData()).archived.map((a) => a.title)).toEqual(["Shelved"]);
    expect(await inTrash()).toEqual([]);
  });

  it("removing for good needs the title when a post went live, and waits while one is being published", async () => {
    const account = await createAccount("youtube");
    const live = await createReadyContent({ title: "Live one" });
    await insertSchedule(live.id, account.id, { status: "PUBLISHED", scheduledAt: new Date(Date.now() - DAY) });
    await trashContents([live.id]);
    await expect(purgeContents([live.id])).rejects.toThrow("Type its title");
    await expect(purgeContents([live.id], { confirmTitle: "Live" })).rejects.toThrow("1 published post");
    expect(await inTrash()).toEqual(["Live one"]);

    const busy = await createReadyContent({ title: "Busy" });
    await insertSchedule(busy.id, account.id, { status: "PROCESSING", scheduledAt: new Date(Date.now() - 60_000) });
    await expect(purgeContents([busy.id])).rejects.toThrow("being published right now");

    expect(await purgeContents([live.id], { confirmTitle: " Live one " })).toEqual({ removed: 1 });
    expect(await db.content.count({ where: { id: live.id } })).toBe(0);
    expect(await db.publishingSchedule.count({ where: { contentId: live.id } })).toBe(0);
    const log = await db.activityLog.findFirstOrThrow({ where: { type: "content.deleted" } });
    expect(log).toMatchObject({ contentId: null, entityType: "CONTENT", entityId: live.id, message: "Removed for good: “Live one” (with 1 published post of history)" });

    // Nothing went live: a plain confirmation is enough
    const plain = await createReadyContent({ title: "Plain" });
    expect(await purgeContents([plain.id])).toEqual({ removed: 1 });
  });

  it("the daily purge removes what is past its retention, never what went live, once a day across workers", async () => {
    const account = await createAccount("youtube");
    const now = new Date();
    const stale = new Date(now.getTime() - (TRASH_DAYS + 1) * DAY);
    const old = await createReadyContent({ title: "Old" });
    const oldLive = await createReadyContent({ title: "Old live" });
    await insertSchedule(oldLive.id, account.id, { status: "PUBLISHED", scheduledAt: new Date(now.getTime() - 40 * DAY) });
    const young = await createReadyContent({ title: "Young" });
    await trashContents([old.id, oldLive.id, young.id]);
    await db.content.updateMany({ where: { id: { in: [old.id, oldLive.id] } }, data: { deletedAt: stale } });

    expect(await purgeExpiredTrash(now)).toEqual({ purged: 1, kept: 1 });
    expect(await inTrash()).toEqual(["Old live", "Young"]);
    expect(await purgeExpiredTrash(now)).toEqual({ purged: 0, kept: 1 });

    const fn = vi.fn(async () => {});
    expect(await runPeriodic("trash-purge", fn, now)).toBe(true);
    expect(await runPeriodic("trash-purge", fn, new Date(now.getTime() + 3_600_000))).toBe(false);
    expect(await runPeriodic("trash-purge", fn, new Date(now.getTime() + DAY + 1))).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
