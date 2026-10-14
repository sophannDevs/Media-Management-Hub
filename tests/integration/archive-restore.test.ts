import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { archiveContents, restoreContents } from "@/server/services/content";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";

// WF-07: archiving takes a content's waiting posts out of the queue; restoring
// can put them back exactly as they were.

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000);
const post = (id: string) => db.publishingSchedule.findUniqueOrThrow({ where: { id }, select: { status: true, activeKey: true, archivedStatus: true, nextAttemptAt: true } });

beforeEach(async () => {
  await db.publishingSchedule.deleteMany();
  await seedPlatforms();
});

async function setup() {
  const yt = await createAccount("youtube");
  const fb = await createAccount("facebook");
  const content = await createReadyContent();
  const waiting = await insertSchedule(content.id, yt.id, { scheduledAt: inHours(24), activeKey: `${content.id}:${yt.id}` });
  const retrying = await insertSchedule(content.id, fb.id, { status: "RETRY_SCHEDULED", scheduledAt: inHours(-2), nextAttemptAt: inHours(1), attempts: 1, activeKey: `${content.id}:${fb.id}` });
  return { content, yt, fb, waiting, retrying };
}

describe("archive and restore with posts (WF-07)", () => {
  it("archive then restore returns the same posts to the queue", async () => {
    const { content, waiting, retrying } = await setup();
    const before = [await post(waiting.id), await post(retrying.id)];

    expect(await archiveContents([content.id])).toEqual({ cancelled: 2 });
    expect(await post(waiting.id)).toMatchObject({ status: "CANCELLED", activeKey: null, archivedStatus: "WAITING" });
    expect(await post(retrying.id)).toMatchObject({ status: "CANCELLED", activeKey: null, archivedStatus: "RETRY_SCHEDULED" });

    expect(await restoreContents([content.id], true)).toEqual({ restored: 2, expired: 0, conflicts: 0 });
    expect([await post(waiting.id), await post(retrying.id)]).toEqual(before);
    const c = await db.content.findUniqueOrThrow({ where: { id: content.id }, select: { archivedAt: true, stage: true } });
    expect(c).toEqual({ archivedAt: null, stage: "SCHEDULED" });
    const log = await db.activityLog.findFirstOrThrow({ where: { contentId: content.id }, orderBy: { createdAt: "desc" } });
    expect(log.message).toBe("Restored from archive — 2 posts back in the queue");
  });

  it("restore without posts leaves them cancelled for good", async () => {
    const { content, waiting } = await setup();
    await archiveContents([content.id]);
    expect(await restoreContents([content.id], false)).toEqual({ restored: 0, expired: 0, conflicts: 0 });
    expect(await post(waiting.id)).toMatchObject({ status: "CANCELLED", archivedStatus: null });
    expect((await db.content.findUniqueOrThrow({ where: { id: content.id } })).stage).toBe("READY");
  });

  it("a post whose time passed while archived stays cancelled", async () => {
    const { content, waiting, retrying } = await setup();
    await archiveContents([content.id]);
    await db.publishingSchedule.update({ where: { id: waiting.id }, data: { scheduledAt: inHours(-1) } });
    expect(await restoreContents([content.id])).toEqual({ restored: 1, expired: 1, conflicts: 0 });
    expect(await post(waiting.id)).toMatchObject({ status: "CANCELLED", archivedStatus: null });
    expect((await post(retrying.id)).status).toBe("RETRY_SCHEDULED");
  });

  it("a post replaced by a newer one to the same account stays cancelled", async () => {
    const { content, yt, waiting } = await setup();
    await archiveContents([content.id]);
    const newer = await insertSchedule(content.id, yt.id, { scheduledAt: inHours(48), activeKey: `${content.id}:${yt.id}` });
    expect(await restoreContents([content.id])).toEqual({ restored: 1, expired: 0, conflicts: 1 });
    expect(await post(waiting.id)).toMatchObject({ status: "CANCELLED", archivedStatus: null });
    expect((await post(newer.id)).status).toBe("WAITING");
  });

  it("leaves a post that is publishing right now alone", async () => {
    const { content, yt } = await setup();
    await db.publishingSchedule.deleteMany({ where: { contentId: content.id, accountId: yt.id } });
    const live = await insertSchedule(content.id, yt.id, { status: "PROCESSING", activeKey: `${content.id}:${yt.id}` });
    expect(await archiveContents([content.id])).toEqual({ cancelled: 1 });
    expect(await post(live.id)).toMatchObject({ status: "PROCESSING", archivedStatus: null });
  });
});
