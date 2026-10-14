import { db } from "@/lib/db";

// Mock analytics provider. Generates believable daily metrics for every
// published post so the Analytics page works before the YouTube Analytics /
// Facebook Insights integrations exist (phase 3 replaces this with real syncs).

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function mockDailyMetrics(seed: string, platformId: string, dayIndex: number) {
  const base = (platformId === "youtube" ? 6000 : 2500) * (0.5 + hash(seed) * 1.5);
  const decay = Math.pow(platformId === "youtube" ? 0.86 : 0.72, dayIndex);
  const noise = 0.8 + hash(`${seed}:${dayIndex}`) * 0.4;
  const views = Math.max(20, Math.round(base * decay * noise + base * 0.03));
  const engagement = platformId === "youtube" ? 0.07 : 0.095;
  return {
    views,
    likes: Math.round(views * engagement * 0.75),
    comments: Math.round(views * engagement * 0.08),
    shares: Math.round(views * engagement * (platformId === "facebook" ? 0.35 : 0.1)),
    watchMinutes: Math.round(views * (platformId === "youtube" ? 4.2 : 0.9)),
  };
}

/**
 * Fills in the days each simulated post has no numbers for yet (PUB-10: daily,
 * in batches: one query for what exists, inserts in chunks; metrics are a pure
 * function of the post and day, so nothing needs refreshing).
 */
export async function syncMockAnalytics(now = new Date()) {
  // Only simulated posts get generated numbers; real posts wait for the platform sync
  const published = await db.publishingSchedule.findMany({
    where: { status: "PUBLISHED", simulated: true, publishedAt: { not: null } },
    select: { id: true, contentId: true, platformId: true, publishedAt: true },
  });
  if (!published.length) return 0;
  const last = await db.analyticsSnapshot.groupBy({
    by: ["contentId", "platformId"],
    where: { contentId: { in: [...new Set(published.map((s) => s.contentId))] } },
    _max: { date: true },
  });
  const lastDay = new Map(last.map((l) => [`${l.contentId}:${l.platformId}`, l._max.date?.getTime() ?? -Infinity]));

  const today = startOfUtcDay(now);
  const rows = [];
  for (const s of published) {
    const start = startOfUtcDay(s.publishedAt!);
    const days = Math.min(90, Math.round((today.getTime() - start.getTime()) / 86_400_000));
    const after = lastDay.get(`${s.contentId}:${s.platformId}`) ?? -Infinity;
    for (let i = 0; i <= days; i++) {
      const date = new Date(start.getTime() + i * 86_400_000);
      if (date.getTime() <= after) continue;
      rows.push({ ...mockDailyMetrics(s.id, s.platformId, i), contentId: s.contentId, platformId: s.platformId, scheduleId: s.id, date, source: "MOCK" });
    }
  }
  for (let i = 0; i < rows.length; i += 2_000) {
    await db.analyticsSnapshot.createMany({ data: rows.slice(i, i + 2_000), skipDuplicates: true });
  }
  return rows.length;
}
