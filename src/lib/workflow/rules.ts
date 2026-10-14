// Pure business rules for the content workflow. No DB / React imports here so
// the same logic runs in Server Components, Server Actions, the worker and tests.

import {
  type PublishingStatusCode,
  type StageCode,
  ACTIVE_SCHEDULE_STATUSES,
} from "./statuses";

export interface WorkflowRules {
  requireScriptApproved: boolean;
  requireImagesApproved: boolean;
  requireFinalVideo: boolean;
  requireReview: boolean;
  requireThumbnail: boolean;
}

export const DEFAULT_RULES: WorkflowRules = {
  requireScriptApproved: true,
  requireImagesApproved: true,
  requireFinalVideo: true,
  requireReview: true,
  requireThumbnail: false,
};

/** Minimal shape the rules need. Optional asset facts make the checks stricter when known. */
export interface ContentState {
  scriptStatus: string;
  imageStatus: string;
  videoStatus: string;
  reviewStatus: string;
  publishingStatus?: string;
  hashtags?: string;
  titleFinalized?: boolean;
  descriptionFinalized?: boolean;
  hasScriptText?: boolean;
  hasImagePrompt?: boolean;
  imageCount?: number;
  selectedImageCount?: number;
  hasVideo?: boolean;
  hasThumbnail?: boolean;
  schedules?: { status: string }[];
}

export type WorkspaceTab = "overview" | "script" | "images" | "video" | "publishing" | "activity";

export interface Requirement {
  key: "script" | "images" | "video" | "review" | "thumbnail";
  label: string;
  tab: WorkspaceTab;
}

/** What is still missing before the content can be marked "Ready to Post". */
export function missingRequirements(c: ContentState, rules: WorkflowRules = DEFAULT_RULES): Requirement[] {
  const missing: Requirement[] = [];
  if (rules.requireScriptApproved && c.scriptStatus !== "APPROVED") {
    missing.push({ key: "script", label: "Script is not approved", tab: "script" });
  }
  if (rules.requireImagesApproved) {
    if (c.imageStatus !== "APPROVED") missing.push({ key: "images", label: "Images are not approved", tab: "images" });
    else if (c.selectedImageCount === 0) missing.push({ key: "images", label: "No final images selected", tab: "images" });
  }
  if (rules.requireFinalVideo) {
    if (c.hasVideo === false) missing.push({ key: "video", label: "Final video is missing", tab: "video" });
    else if (c.videoStatus !== "FINAL") missing.push({ key: "video", label: "Video is not marked Final", tab: "video" });
  }
  if (rules.requireReview && c.reviewStatus !== "APPROVED") {
    missing.push({ key: "review", label: "Content has not been reviewed", tab: "overview" });
  }
  if (rules.requireThumbnail && c.hasThumbnail === false) {
    missing.push({ key: "thumbnail", label: "No thumbnail selected", tab: "video" });
  }
  return missing;
}

export function isReadyToPost(c: ContentState, rules: WorkflowRules = DEFAULT_RULES) {
  return missingRequirements(c, rules).length === 0;
}

/**
 * Publishing status is derived, never set by hand:
 * schedules win (processing > failed > waiting > published), then readiness.
 */
export function derivePublishingStatus(c: ContentState, rules: WorkflowRules = DEFAULT_RULES): PublishingStatusCode {
  const s = (c.schedules ?? []).map((x) => x.status).filter((x) => x !== "CANCELLED");
  if (s.includes("PROCESSING")) return "PUBLISHING";
  if (s.includes("FAILED")) return "FAILED";
  if (s.some((x) => x === "WAITING" || x === "RETRY_SCHEDULED")) return "SCHEDULED";
  if (s.includes("PUBLISHED")) return "PUBLISHED";
  if (isReadyToPost(c, rules)) return "READY";
  const untouched =
    c.scriptStatus === "NOT_STARTED" &&
    c.imageStatus === "NOT_STARTED" &&
    c.videoStatus === "NOT_STARTED" &&
    c.reviewStatus === "NOT_STARTED";
  return untouched ? "DRAFT" : "NOT_READY";
}

/** Current pipeline stage (Idea → … → Published). */
export function deriveStage(c: ContentState, rules: WorkflowRules = DEFAULT_RULES): StageCode {
  const p = c.publishingStatus ?? derivePublishingStatus(c, rules);
  if (p === "PUBLISHED") return "PUBLISHED";
  if (p === "FAILED") return "FAILED";
  if (p === "SCHEDULED" || p === "PUBLISHING") return "SCHEDULED";
  if (c.scriptStatus === "NOT_STARTED") return "IDEA";
  if (rules.requireScriptApproved && c.scriptStatus !== "APPROVED") return "SCRIPT";
  if (rules.requireImagesApproved && c.imageStatus !== "APPROVED") return "IMAGES";
  if (rules.requireFinalVideo && c.videoStatus !== "FINAL") return "VIDEO";
  if (rules.requireReview && c.reviewStatus !== "APPROVED") return "REVIEW";
  return isReadyToPost(c, rules) ? "READY" : "VIDEO";
}

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  /** Items the user ticks by hand (others are computed from the data). */
  manual?: boolean;
  tab: WorkspaceTab;
}

const GENERATED_OR_LATER = ["GENERATED", "NEEDS_REVISION", "APPROVED"];

export function checklist(c: ContentState): ChecklistItem[] {
  const schedules = (c.schedules ?? []).filter((s) => s.status !== "CANCELLED");
  return [
    { key: "idea", label: "Idea created", done: true, tab: "overview" },
    { key: "scriptGenerated", label: "Script generated", done: c.hasScriptText ?? GENERATED_OR_LATER.includes(c.scriptStatus), tab: "script" },
    { key: "scriptApproved", label: "Script approved", done: c.scriptStatus === "APPROVED", tab: "script" },
    { key: "imagePrompt", label: "Image prompt created", done: c.hasImagePrompt ?? c.imageStatus !== "NOT_STARTED", tab: "images" },
    { key: "imagesGenerated", label: "Images generated", done: (c.imageCount ?? 0) > 0 || GENERATED_OR_LATER.includes(c.imageStatus), tab: "images" },
    { key: "imagesSelected", label: "Final images selected", done: (c.selectedImageCount ?? 0) > 0 || c.imageStatus === "APPROVED", tab: "images" },
    { key: "videoGenerated", label: "Video generated", done: c.hasVideo ?? ["GENERATED", "NEEDS_REVISION", "FINAL"].includes(c.videoStatus), tab: "video" },
    { key: "thumbnail", label: "Thumbnail selected", done: !!c.hasThumbnail, tab: "video" },
    { key: "titleFinalized", label: "Title finalized", done: !!c.titleFinalized, manual: true, tab: "overview" },
    { key: "descriptionFinalized", label: "Description finalized", done: !!c.descriptionFinalized, manual: true, tab: "overview" },
    { key: "hashtags", label: "Hashtags added", done: !!c.hashtags?.trim(), tab: "overview" },
    { key: "reviewed", label: "Content reviewed", done: c.reviewStatus === "APPROVED", tab: "overview" },
    { key: "scheduled", label: "Publishing schedule configured", done: schedules.length > 0, tab: "publishing" },
  ];
}

export function completion(c: ContentState) {
  const items = checklist(c);
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

/** Fine-grained state of the image workspace. */
export function imageStage(c: ContentState) {
  if (c.imageStatus === "APPROVED") return "APPROVED";
  if ((c.selectedImageCount ?? 0) > 0) return "SELECTED";
  if ((c.imageCount ?? 0) > 0 || c.imageStatus === "GENERATED") return "GENERATED";
  if (c.imageStatus === "GENERATING") return "GENERATING";
  if (c.hasImagePrompt) return "PROMPT_READY";
  return "PROMPT_NOT_CREATED";
}

export interface ScheduleValidationInput {
  contentReady: boolean;
  missing?: Requirement[];
  platformId?: string | null;
  platformEnabled?: boolean;
  account?: { status: string; platformId: string; name: string } | null;
  scheduledAt?: Date | null;
  now: Date;
  title?: string;
  maxTitleLength?: number;
}

/** Rule: a post can be scheduled only with a ready video, a platform, a connected account and a future time. */
export function validateSchedule(i: ScheduleValidationInput): string[] {
  const errors: string[] = [];
  if (!i.contentReady) {
    errors.push(
      i.missing?.length
        ? `Video must be "Ready to Post" first: ${i.missing.map((m) => m.label.toLowerCase()).join(", ")}.`
        : 'Video must be "Ready to Post" before scheduling.',
    );
  }
  if (!i.platformId) errors.push("Select a social platform.");
  else if (i.platformEnabled === false) errors.push("This platform is not available yet.");
  if (!i.account) errors.push("Select a social account.");
  else {
    if (i.platformId && i.account.platformId !== i.platformId) errors.push("The account does not belong to the selected platform.");
    if (i.account.status !== "CONNECTED") errors.push(`Account "${i.account.name}" is not connected — reconnect it first.`);
  }
  if (!i.scheduledAt || Number.isNaN(i.scheduledAt.getTime())) errors.push("Pick a valid date and time.");
  else if (i.scheduledAt.getTime() <= i.now.getTime()) errors.push("Scheduled time must be in the future.");
  if (i.title !== undefined) {
    if (!i.title.trim()) errors.push("Title is required.");
    else if (i.maxTitleLength && i.title.length > i.maxTitleLength) errors.push(`Title must be ${i.maxTitleLength} characters or less.`);
  }
  return errors;
}

export function isActiveSchedule(status: string) {
  return (ACTIVE_SCHEDULE_STATUSES as string[]).includes(status);
}

export function wordCount(text: string) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Normalises "ai, #Tools  productivity" → "#ai #tools #productivity". */
export function normalizeHashtags(input: string) {
  return Array.from(
    new Set(
      input
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#+/, "").trim())
        .filter(Boolean)
        .map((t) => `#${t.replace(/[^\p{L}\p{N}_]/gu, "")}`)
        .filter((t) => t.length > 1),
    ),
  ).join(" ");
}

export function parseTags(input: string) {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((t) => t.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean),
    ),
  );
}
