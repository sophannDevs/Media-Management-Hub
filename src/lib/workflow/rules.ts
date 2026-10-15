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

/**
 * Every check that can keep content from being Ready to Post. `bit` is its
 * place in Content.missingMask (stored, WF-03): append new codes with new bits,
 * never reuse one.
 */
export const REQUIREMENTS = {
  videoFile: { bit: 1, key: "videoFile", label: "Final video is missing", tab: "video", hard: true },
  scriptNotApproved: { bit: 2, key: "script", label: "Script is not approved", tab: "script" },
  imagesNotApproved: { bit: 4, key: "images", label: "Images are not approved", tab: "images" },
  noFinalImages: { bit: 8, key: "images", label: "No final images selected", tab: "images" },
  videoNotFinal: { bit: 16, key: "video", label: "Video is not marked Final", tab: "video" },
  notReviewed: { bit: 32, key: "review", label: "Content has not been reviewed", tab: "overview" },
  noThumbnail: { bit: 64, key: "thumbnail", label: "No thumbnail selected", tab: "video" },
} as const satisfies Record<string, { bit: number; key: string; label: string; tab: WorkspaceTab; hard?: boolean }>;

export type RequirementCode = keyof typeof REQUIREMENTS;

export interface Requirement {
  /** The rule it belongs to (what an override waives) */
  key: "videoFile" | "script" | "images" | "video" | "review" | "thumbnail";
  /** The exact check that failed */
  code: RequirementCode;
  label: string;
  tab: WorkspaceTab;
  /** Hard requirements can't be switched off in Settings or overridden per post: publishing would fail without them. */
  hard?: boolean;
}

const requirement = (code: RequirementCode): Requirement => {
  const r = REQUIREMENTS[code];
  return { key: r.key, code, label: r.label, tab: r.tab, ...("hard" in r ? { hard: r.hard } : {}) };
};

/** Never optional: every platform publishes a video file, so a post without one can only fail. */
export function hardRequirements(c: ContentState): Requirement[] {
  return c.hasVideo === false ? [requirement("videoFile")] : [];
}

/** What is still missing before the content can be marked "Ready to Post": hard requirements first, then the enabled rules. */
export function missingRequirements(c: ContentState, rules: WorkflowRules = DEFAULT_RULES): Requirement[] {
  const missing: Requirement[] = hardRequirements(c);
  if (rules.requireScriptApproved && c.scriptStatus !== "APPROVED") missing.push(requirement("scriptNotApproved"));
  if (rules.requireImagesApproved) {
    if (c.imageStatus !== "APPROVED") missing.push(requirement("imagesNotApproved"));
    else if (c.selectedImageCount === 0) missing.push(requirement("noFinalImages"));
  }
  // The file itself is a hard requirement above; this rule is about its status
  if (rules.requireFinalVideo && c.hasVideo !== false && c.videoStatus !== "FINAL") missing.push(requirement("videoNotFinal"));
  if (rules.requireReview && c.reviewStatus !== "APPROVED") missing.push(requirement("notReviewed"));
  if (rules.requireThumbnail && c.hasThumbnail === false) missing.push(requirement("noThumbnail"));
  return missing;
}

/** Content.missingMask for a list of missing requirements. */
export function missingMask(missing: Requirement[]) {
  return missing.reduce((mask, r) => mask | REQUIREMENTS[r.code].bit, 0);
}

/** The missing requirements stored in Content.missingMask, in display order. */
export function requirementsFromMask(mask: number): Requirement[] {
  return (Object.keys(REQUIREMENTS) as RequirementCode[]).filter((code) => mask & REQUIREMENTS[code].bit).map(requirement);
}

export function isReadyToPost(c: ContentState, rules: WorkflowRules = DEFAULT_RULES) {
  return missingRequirements(c, rules).length === 0;
}

/**
 * What still stops a post: every hard requirement, plus the soft ones its
 * override doesn't waive. An override is recorded per post with a reason.
 */
export function blockingRequirements(missing: Requirement[], overridden: readonly string[] = []) {
  return missing.filter((m) => m.hard || !overridden.includes(m.key));
}

/**
 * Publishing status is derived, never set by hand:
 * schedules win (processing > failed > waiting > published), then readiness.
 */
export function derivePublishingStatus(c: ContentState, rules: WorkflowRules = DEFAULT_RULES): PublishingStatusCode {
  const s = (c.schedules ?? []).map((x) => x.status).filter((x) => x !== "CANCELLED");
  if (s.includes("PROCESSING")) return "PUBLISHING";
  // Live somewhere and failed elsewhere (WF-02): say so, instead of only "Failed"
  if (s.includes("PUBLISHED") && s.includes("FAILED")) return "PARTIAL";
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

export interface DerivedContentState {
  publishingStatus: PublishingStatusCode;
  stage: StageCode;
  missingMask: number;
  completion: number;
}

/**
 * Everything syncPublishingStatus stores on Content (WF-03). The migration
 * that added these columns backfills them with the same rules in SQL; a test
 * keeps the two in step.
 */
export function deriveContentState(c: ContentState, rules: WorkflowRules = DEFAULT_RULES): DerivedContentState {
  const publishingStatus = derivePublishingStatus(c, rules);
  return {
    publishingStatus,
    stage: deriveStage({ ...c, publishingStatus }, rules),
    missingMask: missingMask(missingRequirements(c, rules)),
    completion: completion(c),
  };
}

/** Current pipeline stage (Idea → … → Published). */
export function deriveStage(c: ContentState, rules: WorkflowRules = DEFAULT_RULES): StageCode {
  const p = c.publishingStatus ?? derivePublishingStatus(c, rules);
  if (p === "PUBLISHED") return "PUBLISHED";
  if (p === "PARTIAL") return "PARTIAL";
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
  /** Schedule before Ready to Post, waiving the missing soft requirements. Needs a reason. */
  override?: { reason?: string } | null;
  platformId?: string | null;
  platformEnabled?: boolean;
  account?: { status: string; platformId: string; name: string } | null;
  scheduledAt?: Date | null;
  now: Date;
  title?: string;
  maxTitleLength?: number;
}

/**
 * Rule: a post can be scheduled only with a ready video (or an override with a
 * reason for the soft requirements), a platform, a connected account and a
 * future time. Hard requirements can never be overridden.
 */
export function validateSchedule(i: ScheduleValidationInput): string[] {
  const errors: string[] = [];
  if (!i.contentReady) {
    const missing = i.missing ?? [];
    const hard = missing.filter((m) => m.hard);
    const soft = missing.filter((m) => !m.hard);
    const list = (r: Requirement[]) => r.map((m) => m.label.toLowerCase()).join(", ");
    if (!missing.length) errors.push('Video must be "Ready to Post" before scheduling.');
    if (hard.length) errors.push(`Can't schedule without this, and it can't be overridden: ${list(hard)}.`);
    if (soft.length && !i.override) errors.push(`Video must be "Ready to Post" first: ${list(soft)}.`);
    if (soft.length && i.override && !i.override.reason?.trim()) errors.push("Give a reason for scheduling before the content is ready.");
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

/**
 * Value of PublishingSchedule.activeKey: set while the post is active, null
 * otherwise. Its unique index allows one active schedule per content and
 * account (a repost of the same content to the same account is never queued
 * twice by accident).
 */
export function scheduleActiveKey(status: string, contentId: string, accountId: string) {
  return isActiveSchedule(status) ? `${contentId}:${accountId}` : null;
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
