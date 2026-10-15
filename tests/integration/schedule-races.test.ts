import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { ServiceError } from "@/server/errors";
import { cancelSchedule, reschedule, retrySchedule, updateSchedule } from "@/server/services/schedule";
import { createAccount, createReadyContent, inMinutes, insertSchedule, seedPlatforms } from "../helpers/factories";

const claimByWorker = (id: string) => db.publishingSchedule.update({ where: { id }, data: { status: "PROCESSING", attempts: 1, lockedBy: "worker", lockedUntil: new Date(Date.now() + 60_000) } });

/** Makes the next read of `id` return the row as it was, then lets the worker claim it before the write. */
function claimAfterNextRead(id: string) {
  const original = db.publishingSchedule.findUnique.bind(db.publishingSchedule);
  const spy = vi.spyOn(db.publishingSchedule, "findUnique").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
    const stale = await original(args);
    await claimByWorker(id);
    return stale;
  }) as unknown as typeof original);
  return spy;
}

async function post(status: string) {
  await seedPlatforms();
  const account = await createAccount("youtube");
  const content = await createReadyContent();
  const s = await insertSchedule(content.id, account.id, {
    status,
    scheduledAt: new Date(Date.now() + 3_600_000),
    activeKey: status === "WAITING" ? `${content.id}:${account.id}` : null,
  });
  return { account, content, s };
}

async function expectStillClaimed(id: string) {
  const after = await db.publishingSchedule.findUniqueOrThrow({ where: { id } });
  expect(after.status).toBe("PROCESSING");
  expect(after.attempts).toBe(1);
}

beforeEach(() => {
  hooks.duringValidation = null;
  vi.restoreAllMocks();
});

describe("user edits racing the worker (PUB-04)", () => {
  it("an edit is refused when the worker claims the post mid-edit", async () => {
    const { account, content, s } = await post("WAITING");
    hooks.duringValidation = () => claimByWorker(s.id);

    const edit = updateSchedule(s.id, { contentId: content.id, platformId: "youtube", accountId: account.id, title: "Edited", ...inMinutes(90) });

    await expect(edit).rejects.toMatchObject({ code: "CONFLICT" });
    await expectStillClaimed(s.id);
  });

  it("a reschedule is refused when the worker claims the post first", async () => {
    const { s } = await post("WAITING");
    claimAfterNextRead(s.id);

    await expect(reschedule(s.id, new Date(Date.now() + 7_200_000))).rejects.toBeInstanceOf(ServiceError);
    await expectStillClaimed(s.id);
  });

  it("a cancel is refused when the worker claims the post first", async () => {
    const { s } = await post("WAITING");
    claimAfterNextRead(s.id);

    await expect(cancelSchedule(s.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expectStillClaimed(s.id);
  });

  it("a retry is refused when the worker claims the post first", async () => {
    // A post waiting for its automatic retry: the worker can claim it, and a person can retry it right away
    const { s } = await post("RETRY_SCHEDULED");
    claimAfterNextRead(s.id);

    await expect(retrySchedule(s.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expectStillClaimed(s.id);
  });
});
