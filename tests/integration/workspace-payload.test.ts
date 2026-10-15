import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { NextRequest } from "next/server";
import { GET as activityRoute } from "@/app/api/content/[id]/activity/route";
import { GET as versionRoute } from "@/app/api/script-versions/[id]/route";
import { db } from "@/lib/db";
import { ACTIVITY_PAGE, getActivityPage, getContentWorkspace } from "@/server/queries/content";
import { createContent } from "@/server/services/content";
import { seedPlatforms } from "../helpers/factories";

// PERF-05: the workspace carries version metadata and one page of history; the
// text of a version and older events are fetched on demand.

const VERSIONS = 50;
const EVENTS = 230;
const BODY = "A line of script that makes a version heavy. ".repeat(2_300); // ~100 KB
let contentId = "";
let scriptId = "";

beforeAll(async () => {
  await seedPlatforms();
  contentId = (await createContent({ title: "Heavy workspace" })).id;
  const script = await db.script.upsert({ where: { contentId }, update: {}, create: { contentId } });
  scriptId = script.id;
  await db.scriptVersion.createMany({
    data: Array.from({ length: VERSIONS }, (_, i) => ({ scriptId, version: i + 1, body: `v${i + 1} ${BODY}`, wordCount: 100 + i, note: `Version ${i + 1}` })),
  });
  await db.script.update({ where: { id: scriptId }, data: { body: BODY, currentVersion: VERSIONS } });
  const base = Date.now() - EVENTS * 60_000;
  await db.activityLog.createMany({
    data: Array.from({ length: EVENTS }, (_, i) => ({ id: `act_${String(i).padStart(4, "0")}`, contentId, type: "content.updated", message: `Event ${i}`, createdAt: new Date(base + i * 60_000) })),
  });
}, 60_000);

describe("content workspace payload (PERF-05)", () => {
  it("stays small with 50 versions of 100 KB", async () => {
    const data = await getContentWorkspace(contentId);
    const bytes = Buffer.byteLength(JSON.stringify(data));
    console.log(`workspace data with ${VERSIONS} versions of ~100 KB: ${(bytes / 1024).toFixed(0)} KB`);
    // The text of the current script is sent once (the editor needs it); the 50 saved versions add only metadata
    expect(bytes).toBeLessThan(250 * 1024);
    expect(data!.script.versions).toHaveLength(VERSIONS);
    expect(data!.script.versions[0]).toEqual({ id: expect.any(String), version: VERSIONS, note: `Version ${VERSIONS}`, status: "GENERATED", source: "MANUAL", words: 100 + VERSIONS - 1, createdLabel: expect.any(String) });
    expect(JSON.stringify(data!.script.versions)).not.toContain("A line of script");
  });

  it("sends one page of history and says there is more", async () => {
    const { activity } = (await getContentWorkspace(contentId))!;
    expect(activity.items).toHaveLength(ACTIVITY_PAGE);
    // Newest first: the content's own "created" event, then the seeded ones
    expect(activity.items.slice(0, 2).map((a) => a.message)).toEqual(["Content created", `Event ${EVENTS - 1}`]);
    expect(activity.nextCursor).toBe(activity.items[ACTIVITY_PAGE - 1].id);
  });

  it("pages through all of the history exactly once, newest first", async () => {
    const seen: string[] = [];
    const { activity } = (await getContentWorkspace(contentId))!;
    seen.push(...activity.items.map((a) => a.id));
    let cursor = activity.nextCursor;
    while (cursor) {
      const page = await getActivityPage(contentId, cursor);
      seen.push(...page.items.map((a) => a.id));
      cursor = page.nextCursor;
    }
    // The content's own "created" event is part of the history too
    const all = await db.activityLog.findMany({ where: { contentId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    expect(seen).toEqual(all.map((a) => a.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("serves older history and a version's text over GET", async () => {
    const first = (await getContentWorkspace(contentId))!.activity;
    const res = await activityRoute(new NextRequest(`http://app.test/api/content/${contentId}/activity?after=${first.nextCursor}`), { params: Promise.resolve({ id: contentId }) } as never);
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.items).toHaveLength(ACTIVITY_PAGE);
    // Page one held the "created" event and the newest ACTIVITY_PAGE - 1 seeded ones
    expect(page.items[0].message).toBe(`Event ${EVENTS - ACTIVITY_PAGE}`);

    const version = await db.scriptVersion.findFirstOrThrow({ where: { scriptId, version: 7 } });
    const body = await versionRoute(new Request("http://app.test/api/script-versions/x"), { params: Promise.resolve({ id: version.id }) } as never);
    expect(body.status).toBe(200);
    expect(body.headers.get("cache-control")).toContain("immutable");
    expect((await body.json()).body).toBe(`v7 ${BODY}`);

    const missing = await versionRoute(new Request("http://app.test/api/script-versions/nope"), { params: Promise.resolve({ id: "nope" }) } as never);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("the migration fills in the word count of older versions the same way the code counts", async () => {
    const version = await db.scriptVersion.create({ data: { scriptId, version: 999, body: "  one two\tthree\n four  ", wordCount: 0 } });
    const empty = await db.scriptVersion.create({ data: { scriptId, version: 1000, body: "   ", wordCount: 0 } });
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261015013000_script_version_word_counts/migration.sql"), "utf8");
    await db.$executeRawUnsafe(sql);
    expect((await db.scriptVersion.findUniqueOrThrow({ where: { id: version.id } })).wordCount).toBe(4);
    expect((await db.scriptVersion.findUniqueOrThrow({ where: { id: empty.id } })).wordCount).toBe(0);
  });
});
