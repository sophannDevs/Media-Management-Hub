import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDaysToKey, dayKey, zonedToUtc } from "@/lib/dates";
import { createContent, syncAllPublishingStatuses } from "@/server/services/content";
import { DASHBOARD_LIST, getDashboardData, WEEK_DAY_POSTS } from "@/server/queries/dashboard";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";

// PERF-03: the dashboard reads counts and bounded lists. Its days are the
// workspace's days (UTC+7 here), not UTC's.

const TZ = "Asia/Phnom_Penh";
const today = dayKey(new Date(), TZ);
const at = (key: string, time: string) => zonedToUtc(key, time, TZ);
let archivedFailure = "";

beforeAll(async () => {
  await seedPlatforms();
  await db.workspaceSettings.update({ where: { id: 1 }, data: { timezone: TZ } });
  const account = await createAccount("youtube");

  // 8 ready items (more than a list shows), 3 ideas, priorities mixed
  for (let i = 0; i < 8; i++) await createReadyContent({ title: `Ready ${i}`, priority: ["LOW", "HIGH", "MEDIUM"][i % 3] });
  for (let i = 0; i < 3; i++) await createContent({ title: `Idea ${i}` });

  // Today: 7 posts during the day and one at 23:30, all of the same content; one just after midnight tomorrow
  const host = await createReadyContent({ title: "Busy day" });
  for (let h = 9; h < 16; h++) await insertSchedule(host.id, account.id, { scheduledAt: at(today, `${String(h).padStart(2, "0")}:00`), timezone: TZ });
  await insertSchedule(host.id, account.id, { scheduledAt: at(today, "23:30"), timezone: TZ });
  await insertSchedule(host.id, account.id, { scheduledAt: at(addDaysToKey(today, 1), "00:30"), timezone: TZ });

  // Two failures, one of them on archived content
  const failing = await createReadyContent({ title: "Failing" });
  await insertSchedule(failing.id, account.id, { status: "FAILED", scheduledAt: at(addDaysToKey(today, -1), "10:00"), lastError: "token expired" });
  const archived = await createReadyContent({ title: "Archived failure", archivedAt: new Date() });
  archivedFailure = (await insertSchedule(archived.id, account.id, { status: "FAILED", scheduledAt: at(addDaysToKey(today, -1), "11:00") })).id;
  await syncAllPublishingStatuses();
}, 60_000);

describe("dashboard (PERF-03)", () => {
  it("counts stages with a GROUP BY and everything else in SQL", async () => {
    const d = await getDashboardData();
    const stages = await db.content.groupBy({ by: ["stage"], where: { archivedAt: null }, _count: { _all: true } });
    for (const s of stages) expect(d.byStage[s.stage], s.stage).toBe(s._count._all);
    expect(d.counts.total).toBe(await db.content.count({ where: { archivedAt: null } }));
    expect(d.counts.ideas).toBe(3);
    expect(d.counts.failedPosts).toBe(1);
    // 7 daytime posts + 23:30, all today in Phnom Penh; 00:30 is tomorrow there even though it's still "today" in UTC
    expect(d.counts.scheduledToday).toBe(8);
  });

  it("bounds every list and shows the most urgent first", async () => {
    const d = await getDashboardData();
    expect(d.ready).toHaveLength(DASHBOARD_LIST);
    expect(d.counts.ready).toBeGreaterThan(DASHBOARD_LIST);
    expect(d.ready.slice(0, 2).map((c) => c.priority)).toEqual(["HIGH", "HIGH"]);
    expect(d.upcoming.length).toBeLessThanOrEqual(DASHBOARD_LIST);
    expect(d.upcoming.map((p) => p.scheduledAt.getTime())).toEqual(d.upcoming.map((p) => p.scheduledAt.getTime()).sort((a, b) => a - b));
    expect(d.failed.map((f) => f.id)).not.toContain(archivedFailure);
    expect(d.failed).toHaveLength(1);
  });

  it("lists a few posts per day in the workspace timezone and says how many there are", async () => {
    const d = await getDashboardData();
    const todays = d.weekSchedules.filter((s) => dayKey(s.scheduledAt, TZ) === today);
    expect(todays).toHaveLength(WEEK_DAY_POSTS);
    expect(todays.every((s) => s.dayTotal === 8)).toBe(true);
    // Every listed post sits on the day the strip shows it under
    for (const s of d.weekSchedules) expect(d.week).toContain(dayKey(s.scheduledAt, TZ));
  });
});
