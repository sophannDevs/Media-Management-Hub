import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getCalendarData } from "@/server/queries/calendar";
import { getContentList } from "@/server/queries/content";
import { getDashboardData } from "@/server/queries/dashboard";
import { getMediaLibrary, parseMediaFilters } from "@/server/queries/media";
import { getQueueData } from "@/server/queries/schedule";
import { createAccount, seedPlatforms } from "../helpers/factories";

// PERF-02: Prisma 6.19 on SQLite loads a relation in chunks once there are
// more than 999 parent rows, and panicked ("no entry found for key") when the
// relation was ordered by a field it didn't select. Every list page is loaded
// here past that boundary. LARGE_LIBRARY_ITEMS raises the size for manual runs.
const ITEMS = Number(process.env.LARGE_LIBRARY_ITEMS) || 1_200;
const SCHEDULED = Math.min(ITEMS, 1_100);

beforeAll(async () => {
  await seedPlatforms();
  const account = await createAccount("youtube");
  const ids = Array.from({ length: ITEMS }, (_, i) => `bulk_${String(i).padStart(6, "0")}`);
  await db.content.createMany({ data: ids.map((id, i) => ({ id, title: `Bulk item ${i}`, scriptStatus: i % 3 ? "APPROVED" : "GENERATED" })) });
  await db.mediaAsset.createMany({
    data: ids.flatMap((contentId, i) => [
      { contentId, type: "IMAGE", fileName: "a.png", storageKey: `bulk/${i}/a.png`, isSelected: i % 2 === 0 },
      { contentId, type: "IMAGE", fileName: "b.png", storageKey: `bulk/${i}/b.png` },
    ]),
  });
  // Posts in the visible month, so the calendar and queue load past the chunk boundary too
  const soon = Date.now() + 3_600_000;
  await db.publishingSchedule.createMany({
    data: ids.slice(0, SCHEDULED).map((contentId, i) => ({
      contentId,
      accountId: account.id,
      platformId: "youtube",
      scheduledAt: new Date(soon + i * 60_000),
      timezone: "UTC",
      title: `Bulk post ${i}`,
      activeKey: `${contentId}:${account.id}`,
    })),
  });
}, 180_000);

describe(`a library of ${ITEMS} content items`, () => {
  it("PERF-02: the content list, dashboard, calendar, queue and media library still load", async () => {
    const list = await getContentList({});
    const dashboard = await getDashboardData();
    const calendar = await getCalendarData({ view: "month" });
    const queue = await getQueueData({ status: "all" });
    const media = await getMediaLibrary(parseMediaFilters({}));

    expect(list.page.matching).toBe(ITEMS);
    expect(list.items).toHaveLength(50);
    expect(dashboard.counts.total).toBe(ITEMS);
    expect(calendar.events.length).toBeGreaterThan(0);
    expect(queue.rows.length).toBeGreaterThan(0);
    expect(media.items.length).toBeGreaterThan(0);
  });
});
