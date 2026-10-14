import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

import { db } from "@/lib/db";
import { ServiceError } from "@/server/errors";
import { cancelSchedule, createSchedule, retrySchedule } from "@/server/services/schedule";
import { createAccount, createReadyContent, inMinutes, insertSchedule, seedPlatforms } from "../helpers/factories";

beforeEach(async () => {
  await seedPlatforms();
  await db.workspaceSettings.update({ where: { id: 1 }, data: { requireFinalVideo: true } });
});

async function readyPost() {
  const account = await createAccount("youtube");
  const content = await createReadyContent();
  const input = { contentId: content.id, platformId: "youtube", accountId: account.id, title: "Launch", ...inMinutes(60) };
  return { account, content, input };
}

const codeOf = (p: Promise<unknown>) => p.then(() => "resolved", (e: unknown) => (e instanceof ServiceError ? e.code ?? e.message : String(e)));

describe("schedule guards", () => {
  it("creates a schedule for ready content", async () => {
    const { input } = await readyPost();
    const s = await createSchedule(input);
    expect(s.status).toBe("WAITING");
    expect(s.activeKey).toBe(`${input.contentId}:${input.accountId}`);
  });

  it("PUB-03: scheduling the same post twice at once leaves one active schedule", async () => {
    const { content, input } = await readyPost();

    const results = await Promise.allSettled([createSchedule(input), createSchedule(input)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ServiceError);
    expect((rejected.reason as ServiceError).code).toBe("ALREADY_SCHEDULED");
    expect(await db.publishingSchedule.count({ where: { contentId: content.id } })).toBe(1);
  });

  it("PUB-03: a resubmitted form returns the post it already created", async () => {
    const { content, input } = await readyPost();
    const withToken = { ...input, idempotencyKey: "form-token-0001" };

    const [a, b] = await Promise.all([createSchedule(withToken), createSchedule(withToken)]);

    expect(a.id).toBe(b.id);
    expect(await db.publishingSchedule.count({ where: { contentId: content.id } })).toBe(1);
  });

  it("allows a new schedule once the earlier one is cancelled", async () => {
    const { input } = await readyPost();
    const first = await createSchedule(input);
    await cancelSchedule(first.id);

    const second = await createSchedule(input);
    expect(second.id).not.toBe(first.id);
    expect((await db.publishingSchedule.findUniqueOrThrow({ where: { id: first.id } })).activeKey).toBeNull();
  });

  it("asks before posting content again to an account that already has it", async () => {
    const { account, content, input } = await readyPost();
    await insertSchedule(content.id, account.id, { status: "PUBLISHED", publishedAt: new Date(), externalId: "yt_1" });

    expect(await codeOf(createSchedule(input))).toBe("ALREADY_PUBLISHED");
    const repost = await createSchedule({ ...input, repost: true });
    expect(repost.status).toBe("WAITING");
  });

  it("re-activating a failed post is refused while another post is active for the same account", async () => {
    const { account, content, input } = await readyPost();
    const failed = await insertSchedule(content.id, account.id, { status: "FAILED", lastErrorCode: "NETWORK" });
    await createSchedule(input);

    expect(await codeOf(retrySchedule(failed.id))).toBe("ALREADY_SCHEDULED");
  });

  it("retrying a post whose last attempt may have gone live needs confirmation", async () => {
    const { account, content } = await readyPost();
    const s = await insertSchedule(content.id, account.id, { status: "FAILED", lastErrorCode: "UNKNOWN_OUTCOME" });

    expect(await codeOf(retrySchedule(s.id))).toBe("CONFIRM_UNKNOWN_OUTCOME");
    await retrySchedule(s.id, { confirmUnknownOutcome: true });

    const after = await db.publishingSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe("RETRY_SCHEDULED");
    expect(after.lastErrorCode).toBeNull();
    expect(after.activeKey).toBe(`${content.id}:${account.id}`);
  });

  it.fails("WF-01: content without a video cannot be scheduled even with the video rule off", async () => {
    await db.workspaceSettings.update({ where: { id: 1 }, data: { requireFinalVideo: false } });
    const { content, input } = await readyPost();
    await db.content.update({ where: { id: content.id }, data: { videoAssetId: null, videoStatus: "NOT_STARTED" } });

    await expect(createSchedule({ ...input, title: "No video" })).rejects.toThrow(/video/i);
  });
});
