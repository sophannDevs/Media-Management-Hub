import { describe, expect, it } from "vitest";
import {
  blockingRequirements,
  type ContentState,
  DEFAULT_RULES,
  derivePublishingStatus,
  deriveStage,
  isReadyToPost,
  missingRequirements,
  normalizeHashtags,
  parseTags,
  validateSchedule,
  wordCount,
} from "@/lib/workflow/rules";

const ready: ContentState = {
  scriptStatus: "APPROVED",
  imageStatus: "APPROVED",
  videoStatus: "FINAL",
  reviewStatus: "APPROVED",
  selectedImageCount: 1,
  hasVideo: true,
};

describe("missingRequirements", () => {
  it("is empty for content that passed every check", () => {
    expect(missingRequirements(ready)).toEqual([]);
    expect(isReadyToPost(ready)).toBe(true);
  });

  it("names each missing approval with the tab that fixes it", () => {
    const missing = missingRequirements({ ...ready, scriptStatus: "GENERATED", reviewStatus: "IN_REVIEW" });
    expect(missing.map((m) => [m.key, m.tab])).toEqual([
      ["script", "script"],
      ["review", "overview"],
    ]);
  });

  it("reports a missing video before a video that is not final", () => {
    expect(missingRequirements({ ...ready, hasVideo: false })[0].label).toBe("Final video is missing");
    expect(missingRequirements({ ...ready, videoStatus: "EDITING" })[0].label).toBe("Video is not marked Final");
  });

  it("requires selected images once images are approved", () => {
    expect(missingRequirements({ ...ready, selectedImageCount: 0 })[0].label).toBe("No final images selected");
  });

  it("only asks for a thumbnail when that rule is on", () => {
    expect(missingRequirements({ ...ready, hasThumbnail: false })).toEqual([]);
    expect(missingRequirements({ ...ready, hasThumbnail: false }, { ...DEFAULT_RULES, requireThumbnail: true })[0].key).toBe("thumbnail");
  });
});

describe("hard and soft requirements (WF-01)", () => {
  const allOff = { requireScriptApproved: false, requireImagesApproved: false, requireFinalVideo: false, requireReview: false, requireThumbnail: false };

  it("still requires a video file with every rule switched off", () => {
    const missing = missingRequirements({ ...ready, hasVideo: false }, allOff);
    expect(missing).toEqual([{ key: "videoFile", label: "Final video is missing", tab: "video", hard: true }]);
    expect(isReadyToPost({ ...ready, hasVideo: false }, allOff)).toBe(false);
  });

  it("lets an override waive soft requirements but never hard ones", () => {
    const missing = missingRequirements({ ...ready, hasVideo: false, reviewStatus: "IN_REVIEW", scriptStatus: "GENERATED" });
    const blocking = blockingRequirements(missing, ["review", "script", "videoFile"]);
    expect(blocking.map((m) => m.key)).toEqual(["videoFile"]);
  });

  it("accepts a soft-only gap with an override and a reason, and nothing else", () => {
    const now = new Date("2026-10-14T10:00:00Z");
    const base = { platformId: "youtube", platformEnabled: true, account: { status: "CONNECTED", platformId: "youtube", name: "Main" }, scheduledAt: new Date("2026-10-15T10:00:00Z"), now };
    const soft = missingRequirements({ ...ready, reviewStatus: "IN_REVIEW" });
    const hard = missingRequirements({ ...ready, hasVideo: false });

    expect(validateSchedule({ ...base, contentReady: false, missing: soft })).toEqual(['Video must be "Ready to Post" first: content has not been reviewed.']);
    expect(validateSchedule({ ...base, contentReady: false, missing: soft, override: { reason: "  " } })).toEqual(["Give a reason for scheduling before the content is ready."]);
    expect(validateSchedule({ ...base, contentReady: false, missing: soft, override: { reason: "Client approved by phone" } })).toEqual([]);
    expect(validateSchedule({ ...base, contentReady: false, missing: hard, override: { reason: "Please" } })).toEqual([
      "Can't schedule without this, and it can't be overridden: final video is missing.",
    ]);
  });
});

describe("derivePublishingStatus", () => {
  it("lets schedules win over readiness, in the documented order", () => {
    const withSchedules = (...statuses: string[]) => derivePublishingStatus({ ...ready, schedules: statuses.map((status) => ({ status })) });
    expect(withSchedules("PUBLISHED", "PROCESSING")).toBe("PUBLISHING");
    expect(withSchedules("PUBLISHED", "FAILED")).toBe("FAILED");
    expect(withSchedules("PUBLISHED", "WAITING")).toBe("SCHEDULED");
    expect(withSchedules("PUBLISHED", "CANCELLED")).toBe("PUBLISHED");
    expect(withSchedules("CANCELLED")).toBe("READY");
  });

  it("separates untouched drafts from work in progress", () => {
    const blank = { scriptStatus: "NOT_STARTED", imageStatus: "NOT_STARTED", videoStatus: "NOT_STARTED", reviewStatus: "NOT_STARTED" };
    expect(derivePublishingStatus(blank)).toBe("DRAFT");
    expect(derivePublishingStatus({ ...blank, scriptStatus: "GENERATED" })).toBe("NOT_READY");
  });
});

describe("deriveStage", () => {
  it("walks the pipeline in order", () => {
    expect(deriveStage({ ...ready, scriptStatus: "NOT_STARTED" })).toBe("IDEA");
    expect(deriveStage({ ...ready, scriptStatus: "GENERATED" })).toBe("SCRIPT");
    expect(deriveStage({ ...ready, imageStatus: "GENERATED" })).toBe("IMAGES");
    expect(deriveStage({ ...ready, videoStatus: "EDITING" })).toBe("VIDEO");
    expect(deriveStage({ ...ready, reviewStatus: "IN_REVIEW" })).toBe("REVIEW");
    expect(deriveStage(ready)).toBe("READY");
  });
});

describe("validateSchedule", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  const base = {
    contentReady: true,
    platformId: "youtube",
    platformEnabled: true,
    account: { status: "CONNECTED", platformId: "youtube", name: "Main" },
    scheduledAt: new Date("2026-10-15T10:00:00Z"),
    now,
    title: "Hello",
    maxTitleLength: 100,
  };

  it("accepts a complete, future post", () => {
    expect(validateSchedule(base)).toEqual([]);
  });

  it("explains every problem at once", () => {
    const errors = validateSchedule({
      ...base,
      contentReady: false,
      account: { status: "TOKEN_EXPIRED", platformId: "facebook", name: "Old" },
      scheduledAt: new Date("2026-10-14T09:00:00Z"),
      title: "x".repeat(101),
    });
    expect(errors).toEqual([
      'Video must be "Ready to Post" before scheduling.',
      "The account does not belong to the selected platform.",
      'Account "Old" is not connected — reconnect it first.',
      "Scheduled time must be in the future.",
      "Title must be 100 characters or less.",
    ]);
  });
});

describe("text helpers", () => {
  it("normalizes hashtags", () => {
    expect(normalizeHashtags("ai, #Tools  ##productivity ai #!")).toBe("#ai #Tools #productivity");
  });

  it("parses comma-separated tags", () => {
    expect(parseTags(" AI, #tools,ai ,, ")).toEqual(["ai", "tools"]);
  });

  it("counts words", () => {
    expect(wordCount("  one two\nthree ")).toBe(3);
    expect(wordCount("   ")).toBe(0);
  });
});
