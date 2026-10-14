// Single source of truth for every status / enumeration used in the app.
// Values are stored in the DB as the code (e.g. "NEEDS_REVISION"); the UI shows the label.

export type Tone = "neutral" | "progress" | "info" | "warn" | "danger" | "success" | "scheduled" | "solid";

type Def<T extends string> = Record<T, { label: string; tone: Tone }>;

function defs<T extends string>(d: Def<T>) {
  const codes = Object.keys(d) as T[];
  return {
    codes,
    def: d,
    label: (code: string) => (d as Record<string, { label: string }>)[code]?.label ?? code,
    tone: (code: string): Tone => (d as Record<string, { tone: Tone }>)[code]?.tone ?? "neutral",
    options: codes.map((value) => ({ value, label: d[value].label })),
    is: (v: unknown): v is T => typeof v === "string" && v in d,
  };
}

export const ScriptStatus = defs({
  NOT_STARTED: { label: "Not Started", tone: "neutral" },
  GENERATING: { label: "Generating", tone: "progress" },
  GENERATED: { label: "Generated", tone: "info" },
  NEEDS_REVISION: { label: "Needs Revision", tone: "warn" },
  APPROVED: { label: "Approved", tone: "success" },
});
export type ScriptStatusCode = (typeof ScriptStatus.codes)[number];

export const ImageStatus = defs({
  NOT_STARTED: { label: "Not Started", tone: "neutral" },
  GENERATING: { label: "Generating", tone: "progress" },
  GENERATED: { label: "Generated", tone: "info" },
  NEEDS_REVISION: { label: "Needs Revision", tone: "warn" },
  APPROVED: { label: "Approved", tone: "success" },
});
export type ImageStatusCode = (typeof ImageStatus.codes)[number];

/** Finer-grained state of the image workspace (prompt → images → approval). */
export const ImageAssetStage = defs({
  PROMPT_NOT_CREATED: { label: "Prompt Not Created", tone: "neutral" },
  PROMPT_READY: { label: "Prompt Ready", tone: "progress" },
  GENERATING: { label: "Generating", tone: "progress" },
  GENERATED: { label: "Generated", tone: "info" },
  SELECTED: { label: "Selected", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
});

export const VideoStatus = defs({
  NOT_STARTED: { label: "Not Started", tone: "neutral" },
  EDITING: { label: "Editing", tone: "progress" },
  GENERATED: { label: "Generated", tone: "info" },
  NEEDS_REVISION: { label: "Needs Revision", tone: "warn" },
  FINAL: { label: "Final", tone: "success" },
});
export type VideoStatusCode = (typeof VideoStatus.codes)[number];

export const ReviewStatus = defs({
  NOT_STARTED: { label: "Not Started", tone: "neutral" },
  IN_REVIEW: { label: "In Review", tone: "progress" },
  CHANGES_REQUESTED: { label: "Changes Requested", tone: "warn" },
  APPROVED: { label: "Approved", tone: "success" },
});
export type ReviewStatusCode = (typeof ReviewStatus.codes)[number];

export const PublishingStatus = defs({
  DRAFT: { label: "Draft", tone: "neutral" },
  NOT_READY: { label: "Not Ready", tone: "neutral" },
  READY: { label: "Ready to Post", tone: "solid" },
  SCHEDULED: { label: "Scheduled", tone: "scheduled" },
  PUBLISHING: { label: "Publishing", tone: "progress" },
  PUBLISHED: { label: "Published", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
});
export type PublishingStatusCode = (typeof PublishingStatus.codes)[number];

export const ScheduleStatus = defs({
  WAITING: { label: "Waiting", tone: "scheduled" },
  PROCESSING: { label: "Processing", tone: "progress" },
  PUBLISHED: { label: "Published", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  RETRY_SCHEDULED: { label: "Retry Scheduled", tone: "warn" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
});
export type ScheduleStatusCode = (typeof ScheduleStatus.codes)[number];
export const ACTIVE_SCHEDULE_STATUSES: ScheduleStatusCode[] = ["WAITING", "PROCESSING", "RETRY_SCHEDULED"];

/** One execution attempt of a schedule (PublishingJob.status). */
export const JobStatus = defs({
  PROCESSING: { label: "Processing", tone: "progress" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
});

export const AccountStatus = defs({
  CONNECTED: { label: "Connected", tone: "success" },
  DISCONNECTED: { label: "Disconnected", tone: "neutral" },
  TOKEN_EXPIRED: { label: "Token Expired", tone: "warn" },
  ERROR: { label: "Error", tone: "danger" },
});
export type AccountStatusCode = (typeof AccountStatus.codes)[number];

export const Priority = defs({
  HIGH: { label: "High", tone: "danger" },
  MEDIUM: { label: "Medium", tone: "warn" },
  LOW: { label: "Low", tone: "neutral" },
});
export type PriorityCode = (typeof Priority.codes)[number];
export const PRIORITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export const ContentType = defs({
  LONG_FORM: { label: "Long-form", tone: "neutral" },
  SHORT: { label: "Short", tone: "neutral" },
  REEL: { label: "Reel", tone: "neutral" },
});
export type ContentTypeCode = (typeof ContentType.codes)[number];

export const MediaType = defs({
  IMAGE: { label: "Image", tone: "neutral" },
  VIDEO: { label: "Video", tone: "neutral" },
  THUMBNAIL: { label: "Thumbnail", tone: "neutral" },
  AUDIO: { label: "Audio", tone: "neutral" },
  MUSIC: { label: "Music", tone: "neutral" },
  OTHER: { label: "Other", tone: "neutral" },
});
export type MediaTypeCode = (typeof MediaType.codes)[number];

export const PromptCategory = defs({
  VIDEO_IDEA: { label: "Video idea", tone: "neutral" },
  SCRIPT: { label: "Script", tone: "neutral" },
  IMAGE: { label: "Image", tone: "neutral" },
  THUMBNAIL: { label: "Thumbnail", tone: "neutral" },
  TITLE: { label: "Title", tone: "neutral" },
  DESCRIPTION: { label: "Description", tone: "neutral" },
  HASHTAGS: { label: "Hashtags", tone: "neutral" },
});
export type PromptCategoryCode = (typeof PromptCategory.codes)[number];

export const AiProvider = defs({
  CLAUDE: { label: "Claude", tone: "warn" },
  GOOGLE_AI_STUDIO: { label: "Google AI Studio", tone: "info" },
  GOOGLE_FLOW: { label: "Google Flow", tone: "info" },
  OTHER: { label: "Other", tone: "neutral" },
});
export type AiProviderCode = (typeof AiProvider.codes)[number];

/** Pipeline stage shown on the dashboard / content list (derived, never stored). */
export const Stage = defs({
  IDEA: { label: "Idea", tone: "neutral" },
  SCRIPT: { label: "Script Pending", tone: "progress" },
  IMAGES: { label: "Image Pending", tone: "progress" },
  VIDEO: { label: "Video Pending", tone: "progress" },
  REVIEW: { label: "In Review", tone: "progress" },
  READY: { label: "Ready to Post", tone: "solid" },
  SCHEDULED: { label: "Scheduled", tone: "scheduled" },
  PUBLISHED: { label: "Published", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
});
export type StageCode = (typeof Stage.codes)[number];
export const PIPELINE_STAGES: StageCode[] = ["IDEA", "SCRIPT", "IMAGES", "VIDEO", "REVIEW", "READY", "SCHEDULED", "PUBLISHED"];
export const PRODUCTION_STAGES: StageCode[] = ["IDEA", "SCRIPT", "IMAGES", "VIDEO", "REVIEW"];

export const ActivityType = {
  CONTENT_CREATED: "content.created",
  CONTENT_UPDATED: "content.updated",
  STATUS_CHANGED: "status.changed",
  SCRIPT_SAVED: "script.saved",
  SCRIPT_GENERATED: "script.generated",
  IMAGE_PROMPT_SAVED: "image.prompt",
  MEDIA_UPLOADED: "media.uploaded",
  MEDIA_DELETED: "media.deleted",
  VIDEO_UPLOADED: "video.uploaded",
  SCHEDULE_CREATED: "schedule.created",
  SCHEDULE_CHANGED: "schedule.changed",
  SCHEDULE_CANCELLED: "schedule.cancelled",
  PUBLISHED: "publish.succeeded",
  PUBLISH_FAILED: "publish.failed",
} as const;

export const NotificationType = {
  READY_FOR_SCHEDULING: "ready",
  SCHEDULED_TOMORROW: "scheduled_tomorrow",
  PUBLISHED: "published",
  PUBLISH_FAILED: "failed",
  TOKEN_EXPIRED: "token_expired",
  INCOMPLETE_ASSETS: "incomplete",
} as const;
export type NotificationTypeCode = (typeof NotificationType)[keyof typeof NotificationType];

export const NOTIFICATION_LABELS: Record<NotificationTypeCode, string> = {
  ready: "Video is ready for scheduling",
  scheduled_tomorrow: "Video is scheduled for tomorrow",
  published: "Video successfully published",
  failed: "Publishing failed",
  token_expired: "Social account token expired",
  incomplete: "Content has incomplete assets",
};
