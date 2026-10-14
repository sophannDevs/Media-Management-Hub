import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { CONTENT_SORTS, type ContentListParams, type ContentSort } from "@/lib/content-list";
import { Priority, Stage } from "@/lib/workflow/statuses";
import { getContentList, PAGE_SIZE } from "@/server/queries/content";
import { createAccount, seedPlatforms } from "../helpers/factories";

// PERF-01: the list is filtered, sorted, counted and paged in SQL. Paging is
// by keyset, so walking every page must visit every matching row exactly
// once, in the same order as sorting them all at once.

const N = 130;
const STAGES = ["IDEA", "SCRIPT", "IMAGES", "READY", "SCHEDULED", "PUBLISHED"];
const DAY = 86_400_000;
const now = Date.now();
let rows: { id: string; title: string; priority: string; stage: string; completion: number; createdAt: Date; updatedAt: Date; next: Date | null }[] = [];

beforeAll(async () => {
  await seedPlatforms();
  const account = await createAccount("youtube");
  rows = Array.from({ length: N }, (_, i) => ({
    id: `list_${String(i).padStart(4, "0")}`,
    // Repeated titles, priorities, stages and completions: ties must still page cleanly
    title: `${["alpha", "Bravo", "charlie", "Delta"][i % 4]} ${i % 7}`,
    priority: Priority.codes[i % 3],
    stage: STAGES[i % STAGES.length],
    completion: (i * 7) % 100,
    createdAt: new Date(now - (i % 40) * DAY),
    updatedAt: new Date(now - ((i * 13) % 97) * 3_600_000),
    next: i % 5 === 0 ? new Date(now + ((i % 11) + 1) * DAY) : null,
  }));
  await db.content.createMany({
    data: rows.map(({ id, title, priority, stage, completion, createdAt, updatedAt }) => ({
      id, title, priority, stage, completion, createdAt, updatedAt, description: id === "list_0007" ? "100% organic_growth" : "",
    })),
  });
  await db.contentPlatform.createMany({ data: rows.map((r, i) => ({ contentId: r.id, platformId: i % 2 ? "youtube" : "facebook" })) });
  await db.publishingSchedule.createMany({
    data: rows.flatMap((r) => (r.next ? [{ contentId: r.id, accountId: account.id, platformId: "youtube", scheduledAt: r.next, timezone: "UTC", title: r.title }] : [])),
  });
}, 60_000);

/** Every row the list shows for these parameters, following "Next" to the end. */
async function walk(params: ContentListParams) {
  const seen: string[] = [];
  let page = await getContentList(params);
  for (;;) {
    expect(page.items.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(page.page.from).toBe(seen.length + 1);
    seen.push(...page.items.map((i) => i.id));
    if (!page.page.next) break;
    page = await getContentList({ ...params, after: page.page.next });
  }
  return seen;
}

const rank = (codes: readonly string[], v: string) => codes.indexOf(v);
const keyOf: Record<ContentSort, (r: (typeof rows)[number], dir: "asc" | "desc") => number | string> = {
  updated: (r) => r.updatedAt.getTime(),
  created: (r) => r.createdAt.getTime(),
  title: (r) => r.title.toLowerCase(),
  priority: (r) => rank(Priority.codes, r.priority),
  stage: (r) => rank(Stage.codes, r.stage),
  completion: (r) => r.completion,
  next: (r, dir) => r.next?.getTime() ?? (dir === "asc" ? Infinity : -Infinity),
};

/** The same order computed in JavaScript: key, then id, both in the sort direction. */
function expected(sort: ContentSort, dir: "asc" | "desc", filter: (r: (typeof rows)[number]) => boolean = () => true) {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .filter(filter)
    .sort((a, b) => {
      const ka = keyOf[sort](a, dir);
      const kb = keyOf[sort](b, dir);
      if (ka !== kb) return (ka < kb ? -1 : 1) * sign;
      return (a.id < b.id ? -1 : 1) * sign;
    })
    .map((r) => r.id);
}

describe("content list paging and sorting (PERF-01)", () => {
  for (const sort of Object.keys(CONTENT_SORTS) as ContentSort[]) {
    for (const dir of ["asc", "desc"] as const) {
      it(`pages through everything once, sorted by ${sort} ${dir}`, async () => {
        expect(await walk({ sort, dir })).toEqual(expected(sort, dir));
      });
    }
  }

  it("walks back with Previous to the same pages", async () => {
    const forward: string[][] = [];
    let page = await getContentList({ sort: "priority" });
    forward.push(page.items.map((i) => i.id));
    while (page.page.next) {
      page = await getContentList({ sort: "priority", after: page.page.next });
      forward.push(page.items.map((i) => i.id));
    }
    expect(forward.length).toBe(Math.ceil(N / PAGE_SIZE));
    for (let p = forward.length - 2; p >= 0; p--) {
      page = await getContentList({ sort: "priority", before: page.page.prev! });
      expect(page.items.map((i) => i.id)).toEqual(forward[p]);
      expect(page.page.from).toBe(p * PAGE_SIZE + 1);
    }
    expect(page.page.prev).toBeNull();
  });

  it("counts every quick filter in SQL and pages within a stage", async () => {
    const list = await getContentList({});
    const count = (stages: string[]) => rows.filter((r) => stages.includes(r.stage)).length;
    expect(list.counts.ALL).toBe(N);
    expect(list.counts.PRODUCTION).toBe(count(["IDEA", "SCRIPT", "IMAGES"]));
    expect(list.counts.READY).toBe(count(["READY"]));
    expect(list.page).toMatchObject({ from: 1, to: PAGE_SIZE, matching: N, prev: null });

    const ideas = await walk({ stage: "IDEA", sort: "title" });
    expect(ideas).toEqual(expected("title", "asc", (r) => r.stage === "IDEA"));
  });

  it("filters by platform, priority, schedule and search in SQL", async () => {
    expect(await walk({ platform: "youtube", sort: "created" })).toEqual(expected("created", "desc", (r) => rows.indexOf(r) % 2 === 1));
    expect(await walk({ priority: "HIGH" })).toEqual(expected("updated", "desc", (r) => r.priority === "HIGH"));
    expect(await walk({ scheduled: "none" })).toEqual(expected("updated", "desc", (r) => !r.next));
    // % and _ are literal characters in a search, not wildcards
    expect((await getContentList({ q: "100% organic_" })).items.map((i) => i.id)).toEqual(["list_0007"]);
    expect((await getContentList({ q: "100%_organic" })).items).toEqual([]);
    expect((await getContentList({ q: "BRAVO 3" })).page.matching).toBe(rows.filter((r) => r.title.toLowerCase().includes("bravo 3")).length);
  });

  it("starts over when the cursor row no longer exists", async () => {
    const page = await getContentList({ after: "no-such-id" });
    expect(page.items.map((i) => i.id)).toEqual(expected("updated", "desc").slice(0, PAGE_SIZE));
    expect(page.page).toMatchObject({ from: 1, prev: null });
  });
});
