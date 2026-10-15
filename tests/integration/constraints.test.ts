import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PUBLISH_ERROR_CODES } from "@/lib/platforms/types";
import {
  AccountStatus, AiProvider, ContentType, ImageStatus, JobStatus, MediaType, NotificationType, Priority, PromptCategory, PublishingStatus, ReviewStatus,
  ScheduleStatus, ScriptStatus, Stage, VideoStatus,
} from "@/lib/workflow/statuses";
import { connectAccount } from "@/server/services/workspace";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";
import { JOB_TRIGGERS, PLATFORM_STATUSES } from "@/lib/workflow/schedule-machine";

// DB-02: the database refuses invalid states even when the code has a bug.

/** [table, column, the codes the application defines, nullable] */
const ENUMS: [string, string, readonly string[], boolean?][] = [
  ["Content", "scriptStatus", ScriptStatus.codes],
  ["Content", "imageStatus", ImageStatus.codes],
  ["Content", "videoStatus", VideoStatus.codes],
  ["Content", "reviewStatus", ReviewStatus.codes],
  ["Content", "publishingStatus", PublishingStatus.codes],
  ["Content", "stage", Stage.codes],
  ["Content", "contentType", ContentType.codes],
  ["Content", "priority", Priority.codes],
  ["PublishingSchedule", "status", ScheduleStatus.codes],
  ["PublishingSchedule", "lastErrorCode", PUBLISH_ERROR_CODES, true],
  ["PublishingSchedule", "archivedStatus", ["WAITING", "RETRY_SCHEDULED"], true],
  ["PublishingJob", "status", JobStatus.codes],
  ["PublishingJob", "errorCode", PUBLISH_ERROR_CODES, true],
  ["PublishingJob", "trigger", JOB_TRIGGERS],
  ["PublishingSchedule", "platformStatus", PLATFORM_STATUSES, true],
  ["SocialAccount", "status", AccountStatus.codes],
  ["MediaAsset", "type", MediaType.codes],
  ["AiPrompt", "category", PromptCategory.codes],
  ["AiPrompt", "provider", AiProvider.codes],
  ["ScriptVersion", "status", ScriptStatus.codes],
  ["ScriptVersion", "source", ["MANUAL", "PASTE", "CLAUDE"]],
  ["ImagePrompt", "provider", ["GOOGLE_AI_STUDIO", "GOOGLE_FLOW", "OTHER"]],
  ["AnalyticsSnapshot", "source", ["MOCK", "API"]],
  ["WorkerHeartbeat", "mode", ["INLINE", "PROCESS", "CRON"]],
  ["User", "role", ["OWNER"]],
  ["Notification", "type", Object.values(NotificationType)],
];

beforeAll(async () => {
  await seedPlatforms();
});

describe("status and type constraints (DB-02)", () => {
  it("allow exactly the codes the application defines", async () => {
    for (const [table, column, codes, nullable] of ENUMS) {
      const [row] = await db.$queryRaw<{ def: string }[]>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${`${table}_${column}_check`}`;
      expect(row, `${table}.${column} has a CHECK constraint`).toBeDefined();
      const allowed = [...row.def.matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();
      expect(allowed, `${table}.${column}: the constraint and the code list the same codes (add a migration when you add a code)`).toEqual([...codes].sort());
      expect(row.def.includes("IS NULL"), `${table}.${column} nullability`).toBe(!!nullable);
    }
  });

  it("refuse an unknown status written directly", async () => {
    await expect(db.content.create({ data: { title: "Bad", scriptStatus: "BOGUS" } })).rejects.toThrow(/Content_scriptStatus_check/);
    const content = await createReadyContent();
    await expect(db.$executeRaw`UPDATE "Content" SET "stage" = 'NOWHERE' WHERE "id" = ${content.id}`).rejects.toThrow(/Content_stage_check/);
    const account = await createAccount("youtube");
    await expect(insertSchedule(content.id, account.id, { status: "SENT" })).rejects.toThrow(/PublishingSchedule_status_check/);
    await expect(insertSchedule(content.id, account.id, { lastErrorCode: "OOPS" })).rejects.toThrow(/PublishingSchedule_lastErrorCode_check/);
    await expect(db.mediaAsset.create({ data: { type: "PDF", fileName: "a.pdf" } })).rejects.toThrow(/MediaAsset_type_check/);
  });

  it("refuse negative sizes and counts and a completion over 100", async () => {
    await expect(db.mediaAsset.create({ data: { type: "OTHER", fileName: "a.bin", size: -1 } })).rejects.toThrow(/MediaAsset_size_check/);
    await expect(db.socialAccount.create({ data: { platformId: "youtube", name: "x", followers: -5 } })).rejects.toThrow(/SocialAccount_followers_check/);
    await expect(db.content.create({ data: { title: "Over", completion: 101 } })).rejects.toThrow(/Content_completion_check/);
  });
});

describe("one source per file (DB-02)", () => {
  it("allows an upload, a link, or a metadata-only record, never both", async () => {
    await db.mediaAsset.create({ data: { type: "IMAGE", fileName: "up.png", storageKey: "t/up.png" } });
    await db.mediaAsset.create({ data: { type: "VIDEO", fileName: "link.mp4", externalUrl: "https://cdn.example.com/a.mp4" } });
    await db.mediaAsset.create({ data: { type: "VIDEO", fileName: "placeholder.mp4" } });
    await expect(db.mediaAsset.create({ data: { type: "VIDEO", fileName: "both.mp4", storageKey: "t/both.mp4", externalUrl: "https://cdn.example.com/b.mp4" } })).rejects.toThrow(/MediaAsset_one_source_check/);
  });
});

describe("default and duplicate accounts (DB-02)", () => {
  it("allows one default account per platform, whatever the code does", async () => {
    await db.socialAccount.deleteMany({ where: { platformId: "facebook" } });
    const first = await createAccount("facebook", { isDefault: true, name: "First" });
    await expect(createAccount("facebook", { isDefault: true, name: "Second" })).rejects.toThrow(/Unique constraint failed on the fields: \(`platformId`\)/);
    // Another platform has its own default; several non-default accounts are fine
    await createAccount("youtube", { isDefault: true, name: "YT default" }).catch(() => {});
    await createAccount("facebook", { name: "Third" });
    expect((await db.socialAccount.findMany({ where: { platformId: "facebook", isDefault: true } })).map((a) => a.id)).toEqual([first.id]);
  });

  it("connecting two first accounts at once yields one default and one ordinary account", async () => {
    await db.socialAccount.deleteMany({ where: { platformId: "youtube" } });
    const [a, b] = await Promise.all([connectAccount({ platformId: "youtube", name: "Race A" }), connectAccount({ platformId: "youtube", name: "Race B" })]);
    expect([a.isDefault, b.isDefault].sort()).toEqual([false, true]);
  });

  it("allows one connection per platform account, and several that aren't identified yet", async () => {
    await db.socialAccount.deleteMany({ where: { platformId: "facebook" } });
    await createAccount("facebook", { externalId: "page-1", name: "Page 1" });
    await expect(createAccount("facebook", { externalId: "page-1", name: "Same page again" })).rejects.toThrow(/Unique constraint failed on the fields: \(`platformId`,`externalId`\)/);
    await createAccount("youtube", { externalId: "page-1", name: "Another platform, same id" });
    await createAccount("facebook", { name: "Not identified A" });
    await createAccount("facebook", { name: "Not identified B" });
  });
});
