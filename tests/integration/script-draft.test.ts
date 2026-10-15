import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { DELETE, PUT } from "@/app/api/content/[id]/script-draft/route";
import { db } from "@/lib/db";
import { saveScriptAction } from "@/server/actions/content";
import { getContentWorkspace } from "@/server/queries/content";
import { createContent } from "@/server/services/content";
import { MAX_SCRIPT_CHARS } from "@/server/services/script";
import { seedPlatforms } from "../helpers/factories";

// UX-03: the script editor autosaves what is being typed, apart from the versions.

let contentId = "";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const put = (id: string, body: unknown, headers: Record<string, string> = {}) =>
  PUT(new Request(`http://app.test/api/content/${id}/script-draft`, { method: "PUT", headers: { host: "app.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), ctx(id));
const del = (id: string) => DELETE(new Request(`http://app.test/api/content/${id}/script-draft`, { method: "DELETE", headers: { host: "app.test" } }), ctx(id));
const draftOf = async () => (await getContentWorkspace(contentId))!.script.draft;

beforeAll(async () => {
  await seedPlatforms();
  contentId = (await createContent({ title: "Draft target" })).id;
  expect(await saveScriptAction(contentId, "Version one of the script.")).toMatchObject({ ok: true });
});

describe("script drafts (UX-03)", () => {
  it("keeps the text and offers it back with the workspace", async () => {
    expect(await draftOf()).toBeNull();
    const res = await put(contentId, { body: "Version one of the script, plus two new lines.", baseVersion: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, savedAt: expect.any(String) });
    expect(await draftOf()).toEqual({ body: "Version one of the script, plus two new lines.", at: expect.any(Number) });
  });

  it("keeps one draft per content, replaced by each save, and touches nothing else", async () => {
    const before = await db.script.findUniqueOrThrow({ where: { contentId } });
    await put(contentId, { body: "Second try.", baseVersion: 1 });
    expect((await draftOf())?.body).toBe("Second try.");
    expect(await db.scriptDraft.count({ where: { contentId } })).toBe(1);
    // Not a version, and the script's own "saved at" stays where it was
    const after = await db.script.findUniqueOrThrow({ where: { contentId } });
    expect(after.currentVersion).toBe(before.currentVersion);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await db.activityLog.count({ where: { contentId, message: { contains: "draft" } } })).toBe(0);
  });

  it("is not offered when it matches the saved text or started from an older version", async () => {
    await put(contentId, { body: "Version one of the script.", baseVersion: 1 });
    expect(await draftOf()).toBeNull();
    await put(contentId, { body: "Written against version 0.", baseVersion: 0 });
    expect(await draftOf()).toBeNull();
  });

  it("is replaced by saving a version", async () => {
    await put(contentId, { body: "Final wording.", baseVersion: 1 });
    expect(await saveScriptAction(contentId, "Final wording.")).toMatchObject({ ok: true });
    expect(await db.scriptDraft.count({ where: { contentId } })).toBe(0);
    expect(await draftOf()).toBeNull();
  });

  it("can be discarded", async () => {
    await put(contentId, { body: "Something to throw away.", baseVersion: 2 });
    expect((await draftOf())?.body).toBe("Something to throw away.");
    expect((await del(contentId)).status).toBe(200);
    expect(await draftOf()).toBeNull();
  });

  it("goes with the content when it is deleted", async () => {
    const other = (await createContent({ title: "Short lived" })).id;
    await put(other, { body: "Draft for a doomed item.", baseVersion: 0 });
    expect(await db.scriptDraft.count({ where: { contentId: other } })).toBe(1);
    await db.content.delete({ where: { id: other } });
    expect(await db.scriptDraft.count({ where: { contentId: other } })).toBe(0);
  });

  it("refuses bad input, unknown content and other sites", async () => {
    expect((await put(contentId, { body: 5, baseVersion: 1 })).status).toBe(400);
    expect((await put(contentId, { body: "x", baseVersion: -1 })).status).toBe(400);
    const tooLong = await put(contentId, { body: "x".repeat(MAX_SCRIPT_CHARS + 1), baseVersion: 2 });
    expect(tooLong.status).toBe(413);
    expect(await tooLong.json()).toMatchObject({ ok: false, code: "TOO_LARGE" });
    const gone = await put("no-such-content", { body: "x", baseVersion: 0 });
    expect(gone.status).toBe(404);
    expect(await db.scriptDraft.count({ where: { contentId: "no-such-content" } })).toBe(0);
    expect((await put(contentId, { body: "from elsewhere", baseVersion: 2 }, { origin: "https://evil.example" })).status).toBe(403);
    expect(await draftOf()).toBeNull();
  });
});
