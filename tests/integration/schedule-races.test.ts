import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

// Lets a test run code in the middle of a user-side schedule operation, the
// way the worker's claim can land between the operation's read and its write.
const hooks = vi.hoisted(() => ({ duringValidation: null as null | (() => Promise<unknown>) }));
vi.mock("@/server/services/content", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/content")>();
  return {
    ...mod,
    getReadiness: async (contentId: string) => {
      await hooks.duringValidation?.();
      return mod.getReadiness(contentId);
    },
  };
});

import { db } from "@/lib/db";
import { updateSchedule } from "@/server/services/schedule";
import { createAccount, createReadyContent, inMinutes, insertSchedule, seedPlatforms } from "../helpers/factories";

describe("user edits racing the worker", () => {
  it.fails("PUB-04: an edit is refused when the worker claims the post mid-edit", async () => {
    await seedPlatforms();
    const account = await createAccount("youtube");
    const content = await createReadyContent();
    const s = await insertSchedule(content.id, account.id, { scheduledAt: new Date(Date.now() + 3_600_000) });

    // The worker claims the post after the edit has checked its status
    hooks.duringValidation = () => db.publishingSchedule.update({ where: { id: s.id }, data: { status: "PROCESSING", attempts: 1 } });
    const edit = updateSchedule(s.id, { contentId: content.id, platformId: "youtube", accountId: account.id, title: "Edited", ...inMinutes(90) });

    await expect(edit).rejects.toThrow();
    const after = await db.publishingSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe("PROCESSING");
    expect(after.attempts).toBe(1);
  });
});
