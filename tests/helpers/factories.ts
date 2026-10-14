import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

let n = 0;
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(n++).toString(36)}`;

export async function seedPlatforms() {
  await db.platform.upsert({ where: { id: "youtube" }, update: {}, create: { id: "youtube", name: "YouTube", sortOrder: 0 } });
  await db.platform.upsert({ where: { id: "facebook" }, update: {}, create: { id: "facebook", name: "Facebook", sortOrder: 1 } });
  await db.workspaceSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, timezone: "UTC" } });
}

export async function createAccount(platformId = "youtube", data: Partial<Prisma.SocialAccountUncheckedCreateInput> = {}) {
  return db.socialAccount.create({
    data: {
      platformId,
      name: data.name ?? `Test ${platformId} account`,
      status: "CONNECTED",
      accessToken: "test-token",
      tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
      ...data,
    },
  });
}

/** Content that passes every workflow rule: approved script, selected images, final video, reviewed. */
export async function createReadyContent(data: Partial<Prisma.ContentUncheckedCreateInput> = {}) {
  const content = await db.content.create({
    data: {
      title: data.title ?? uid("Ready video"),
      scriptStatus: "APPROVED",
      imageStatus: "APPROVED",
      videoStatus: "FINAL",
      reviewStatus: "APPROVED",
      publishingStatus: "READY",
      hashtags: "#test",
      script: { create: { body: "A finished script." } },
      platforms: { create: [{ platformId: "youtube" }, { platformId: "facebook" }] },
      ...data,
    },
  });
  await db.mediaAsset.create({
    data: { contentId: content.id, type: "IMAGE", fileName: "frame.png", storageKey: `${uid("test")}/frame.png`, mimeType: "image/png", size: 10, isSelected: true },
  });
  const video = await db.mediaAsset.create({
    data: { contentId: content.id, type: "VIDEO", fileName: "final.mp4", storageKey: `${uid("test")}/final.mp4`, mimeType: "video/mp4", size: 1000 },
  });
  return db.content.update({ where: { id: content.id }, data: { videoAssetId: video.id } });
}

/** Inserts a schedule row directly (no validation), for setting up a given state. */
export async function insertSchedule(contentId: string, accountId: string, data: Partial<Prisma.PublishingScheduleUncheckedCreateInput> = {}) {
  const account = await db.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
  return db.publishingSchedule.create({
    data: {
      contentId,
      accountId,
      platformId: account.platformId,
      scheduledAt: new Date(Date.now() - 60_000),
      timezone: "UTC",
      title: "Scheduled title",
      ...data,
    },
  });
}

/** Wall-clock date and time strings (UTC) for a moment `minutes` from now. */
export function inMinutes(minutes: number) {
  const iso = new Date(Date.now() + minutes * 60_000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), timezone: "UTC" };
}
