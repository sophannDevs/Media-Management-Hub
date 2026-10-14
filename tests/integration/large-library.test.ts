import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getCalendarData } from "@/server/queries/calendar";
import { getContentList } from "@/server/queries/content";
import { getDashboardData } from "@/server/queries/dashboard";
import { seedPlatforms } from "../helpers/factories";

// PERF-02: Prisma 6.19 panicked ("no entry found for key") once the shared
// content select loaded about 1,000 items with their ordered images.
const ITEMS = 1_200;

beforeAll(async () => {
  await seedPlatforms();
  const ids = Array.from({ length: ITEMS }, (_, i) => `bulk_${String(i).padStart(5, "0")}`);
  await db.content.createMany({ data: ids.map((id, i) => ({ id, title: `Bulk item ${i}`, scriptStatus: i % 3 ? "APPROVED" : "GENERATED" })) });
  await db.mediaAsset.createMany({
    data: ids.flatMap((contentId, i) => [
      { contentId, type: "IMAGE", fileName: "a.png", storageKey: `bulk/${i}/a.png`, isSelected: i % 2 === 0 },
      { contentId, type: "IMAGE", fileName: "b.png", storageKey: `bulk/${i}/b.png` },
    ]),
  });
}, 120_000);

describe(`a library of ${ITEMS} content items`, () => {
  it.fails("PERF-02: the content list, dashboard and calendar still load", async () => {
    const list = await getContentList({});
    const dashboard = await getDashboardData();
    const calendar = await getCalendarData({ view: "month" });

    expect(list.total).toBe(ITEMS);
    expect(dashboard.counts.total).toBe(ITEMS);
    expect(Array.isArray(calendar.ready)).toBe(true);
  });
});
