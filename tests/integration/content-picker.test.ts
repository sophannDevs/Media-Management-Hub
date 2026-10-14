import { beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers call connection() to opt out of prerendering; there is no request scope here
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { NextRequest } from "next/server";
import { GET as search } from "@/app/api/content/search/route";
import { GET as scheduleForm } from "@/app/api/schedule/form/route";
import { PICKER_LIMIT, searchContentOptions } from "@/server/queries/content";
import { getScheduleFormData, type ScheduleFormData } from "@/server/queries/schedule-form";
import { createContent } from "@/server/services/content";
import { createReadyContent, seedPlatforms } from "../helpers/factories";

// PERF-11: the schedule dialog no longer loads every content item. The picker
// searches (top 20, ready first) and the form loads one item.

let newestReady = "";
let draft = "";

beforeAll(async () => {
  await seedPlatforms();
  for (let i = 0; i < 25; i++) draft = (await createContent({ title: `Draft video ${i}` })).id;
  await createContent({ title: "100% organic_growth" });
  for (let i = 0; i < 3; i++) newestReady = (await createReadyContent({ title: `Ready video ${i}` })).id;
}, 60_000);

describe("content picker (PERF-11)", () => {
  it("returns at most 20 matches, ready to post first", async () => {
    const all = await searchContentOptions("");
    expect(all).toHaveLength(PICKER_LIMIT);
    expect(all.slice(0, 3).every((o) => o.ready)).toBe(true);
    expect(all.slice(3).some((o) => o.ready)).toBe(false);
  });

  it("matches titles case-insensitively, with % and _ as plain characters", async () => {
    expect((await searchContentOptions("READY VIDEO")).map((o) => o.title).sort()).toEqual(["Ready video 0", "Ready video 1", "Ready video 2"]);
    expect((await searchContentOptions("100% organic_")).map((o) => o.title)).toEqual(["100% organic_growth"]);
    expect(await searchContentOptions("100%_organic")).toEqual([]);
  });

  it("is served by GET /api/content/search", async () => {
    const res = await search(new NextRequest("http://app.test/api/content/search?q=draft%20video%201"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as { title: string; ready: boolean }[];
    expect(body.map((o) => o.title).sort()).toEqual(["Draft video 1", "Draft video 10", "Draft video 11", "Draft video 12", "Draft video 13", "Draft video 14", "Draft video 15", "Draft video 16", "Draft video 17", "Draft video 18", "Draft video 19"]);
    expect(body.every((o) => !o.ready)).toBe(true);
  });

  it("serves the dialog's data as a GET read (ARCH-03)", async () => {
    const res = await scheduleForm(new NextRequest(`http://app.test/api/schedule/form?contentId=${draft}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const data = (await res.json()) as ScheduleFormData;
    expect(data.content).toMatchObject({ id: draft, ready: false });
    expect(data.platforms.map((p) => p.id)).toContain("youtube");
  });

  it("opens the dialog with one item and no full list", async () => {
    const data = await getScheduleFormData({});
    expect(data).not.toHaveProperty("contents");
    expect(data.content).toMatchObject({ id: newestReady, ready: true, missing: [] });

    const notReady = await getScheduleFormData({ contentId: draft });
    expect(notReady.content?.ready).toBe(false);
    expect(notReady.content?.missing).toEqual([
      { label: "Final video is missing", hard: true },
      { label: "Script is not approved", hard: false },
      { label: "Images are not approved", hard: false },
      { label: "Content has not been reviewed", hard: false },
    ]);
  });
});
