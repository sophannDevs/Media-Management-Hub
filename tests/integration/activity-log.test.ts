import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runAsUser, runAsWorker } from "@/server/auth/actor";
import { authenticate } from "@/server/auth/owner";
import { hashPassword } from "@/server/auth/password";
import { runInRequest } from "@/server/request-context";
import { logActivity, resolveActor } from "@/server/services/activity";
import { createContent } from "@/server/services/content";
import { createMediaAsset } from "@/server/services/media";
import { connectAccount, createPrompt, createTaxonomy, deleteAccount, deletePrompt, deleteTaxonomy, disconnectAccount, reconnectAccount, renameTaxonomy, setDefaultAccount, updatePrompt, updateSettings } from "@/server/services/workspace";
import { seedPlatforms } from "../helpers/factories";

// DB-05: every change leaves one log row that says who did it and what it was about.

const OWNER = "test-owner";
const rows = (where: Prisma.ActivityLogWhereInput = {}) => db.activityLog.findMany({ where, orderBy: { createdAt: "asc" } });

beforeEach(async () => {
  await seedPlatforms();
  await db.activityLog.deleteMany();
  await db.socialAccount.deleteMany();
  await db.aiPrompt.deleteMany();
});

describe("who did it", () => {
  it("records the signed-in user, the worker, the request's session, or the system", async () => {
    await runAsUser(OWNER, () => logActivity({ type: "x.user", message: "by a person" }));
    await runAsWorker(() => logActivity({ type: "x.worker", message: "by the worker" }));
    await logActivity({ type: "x.system", message: "by nobody in particular" });
    // A Route Handler sets no actor: the session of the request being served stands in (tests sign in as the owner)
    await runInRequest({ requestId: "r1" }, () => logActivity({ type: "x.request", message: "from a route" }));
    expect(await resolveActor()).toEqual({ userId: null, source: "SYSTEM" });

    const all = await rows();
    expect(all.map((r) => [r.type, r.actorId, r.source])).toEqual([
      ["x.user", OWNER, "USER"],
      ["x.worker", null, "WORKER"],
      ["x.system", null, "SYSTEM"],
      ["x.request", OWNER, "USER"],
    ]);
    // Deleting the person keeps the row, without the link
    await db.user.delete({ where: { id: OWNER } });
    expect((await db.activityLog.findFirstOrThrow({ where: { type: "x.user" } })).actorId).toBeNull();
  });

  it("records sign-ins and wrong passwords against the owner's account, and nothing for an unknown email", async () => {
    const user = await db.user.create({ data: { name: "Sam", email: "sam@test.local", passwordHash: await hashPassword("correct horse battery") } });
    await expect(authenticate("sam@test.local", "wrong")).rejects.toThrow("incorrect");
    await expect(authenticate("nobody@test.local", "wrong")).rejects.toThrow("incorrect");
    await authenticate("sam@test.local", "correct horse battery");
    const all = await rows({ entityType: "USER" });
    expect(all.map((r) => [r.type, r.entityId, r.actorId, r.source])).toEqual([
      ["user.signin_failed", user.id, null, "SYSTEM"],
      ["user.signed_in", user.id, user.id, "USER"],
    ]);
    expect(all[0].message).toBe("Sign-in failed for sam@test.local: wrong password");
    expect(all[1].message).toBe("Sam signed in");
  });
});

describe("what it was about", () => {
  it("a settings change logs the fields that changed, and a save that changes nothing logs nothing", async () => {
    await runAsUser(OWNER, () => updateSettings({ requireFinalVideo: false, timezone: "Asia/Seoul", workspaceName: "Studio" }));
    const [row] = await rows({ entityType: "SETTINGS" });
    expect(row).toMatchObject({ type: "settings.updated", actorId: OWNER, source: "USER", entityId: "1" });
    expect(row.message).toBe("Settings changed: Require final video off; Timezone Asia/Seoul; Workspace name Studio");
    expect(Object.keys(row.meta as object).length).toBe(1);
    expect((row.meta as { changed: Record<string, unknown> }).changed).toEqual({
      requireFinalVideo: { from: true, to: false },
      timezone: { from: "UTC", to: "Asia/Seoul" },
      workspaceName: { from: expect.any(String), to: "Studio" },
    });
    await runAsUser(OWNER, () => updateSettings({ requireFinalVideo: false, timezone: "Asia/Seoul" }));
    expect(await rows({ entityType: "SETTINGS" })).toHaveLength(1);
  });

  it("account changes are logged against the account", async () => {
    const a = await runAsUser(OWNER, () => connectAccount({ platformId: "youtube", name: "Main channel" }));
    const b = await runAsUser(OWNER, () => connectAccount({ platformId: "youtube", name: "Second channel" }));
    await runAsUser(OWNER, () => setDefaultAccount(b.id));
    await runAsUser(OWNER, () => disconnectAccount(a.id));
    await runAsUser(OWNER, () => reconnectAccount(a.id));
    await runAsUser(OWNER, () => deleteAccount(a.id));
    const all = await rows({ entityType: "ACCOUNT" });
    expect(all.map((r) => [r.type, r.entityId, r.message])).toEqual([
      ["account.connected", a.id, "YouTube account connected: Main channel"],
      ["account.connected", b.id, "YouTube account connected: Second channel"],
      ["account.updated", b.id, "Second channel is now the default YouTube account"],
      ["account.disconnected", a.id, "YouTube account disconnected: Main channel"],
      ["account.reconnected", a.id, "YouTube account reconnected: Main channel"],
      ["account.deleted", a.id, "YouTube account removed: Main channel"],
    ]);
    expect(all.every((r) => r.actorId === OWNER && r.contentId === null)).toBe(true);
  });

  it("prompts and labels are logged, a rename to the same name is not", async () => {
    const p = await runAsUser(OWNER, () => createPrompt({ name: "Hook", category: "SCRIPT", provider: "CLAUDE", content: "Write a hook" }));
    await runAsUser(OWNER, () => updatePrompt(p.id, { name: "Hook v2", category: "SCRIPT", provider: "CLAUDE", content: "Write a better hook" }));
    await runAsUser(OWNER, () => deletePrompt(p.id));
    const c = await runAsUser(OWNER, () => createTaxonomy("category", "Tutorials"));
    await runAsUser(OWNER, () => renameTaxonomy("category", c.id, "Tutorials"));
    await runAsUser(OWNER, () => renameTaxonomy("category", c.id, "How-to"));
    await runAsUser(OWNER, () => deleteTaxonomy("category", c.id));
    expect((await rows({ entityType: "PROMPT" })).map((r) => [r.entityId, r.message])).toEqual([
      [p.id, "Prompt created: Hook"],
      [p.id, "Prompt updated: Hook v2"],
      [p.id, "Prompt deleted: Hook v2"],
    ]);
    expect((await rows({ entityType: "TAXONOMY" })).map((r) => [r.entityId, r.message, (r.meta as { kind: string }).kind])).toEqual([
      [c.id, "Category created: Tutorials", "category"],
      [c.id, "Category renamed: Tutorials → How-to", "category"],
      [c.id, "Category deleted: How-to", "category"],
    ]);
  });

  it("content rows name the content item, file rows the file", async () => {
    const content = await runAsUser(OWNER, () => createContent({ title: "Logged" }));
    const asset = await runAsUser(OWNER, () => createMediaAsset({ contentId: content.id, type: "IMAGE", fileName: "a.png", storageKey: "media/2026/10/a.png", mimeType: "image/png", size: 10 }));
    const all = await rows({ contentId: content.id });
    expect(all.map((r) => [r.type, r.entityType, r.entityId, r.actorId])).toEqual([
      ["content.created", "CONTENT", content.id, OWNER],
      ["media.uploaded", "MEDIA", asset.id, OWNER],
    ]);
  });
});
