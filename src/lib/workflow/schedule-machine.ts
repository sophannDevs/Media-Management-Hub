// The publishing schedule's state machine (ARCH-02). A schedule row is the
// plan (what, where, when) plus the queue state below; every execution is an
// append-only PublishingJob row (PUB-09). The same table is enforced by the
// database (trigger PublishingSchedule_status_transition, migration
// attempt_log), so no code path can move a post along an arrow that isn't
// here. Updating a row without changing its status is always allowed.

export const SCHEDULE_STATUSES = ["WAITING", "PROCESSING", "PUBLISHED", "FAILED", "RETRY_SCHEDULED", "CANCELLED"] as const;
export type ScheduleStatusCode = (typeof SCHEDULE_STATUSES)[number];

/** Where each status can go, and what moves it there. */
export const SCHEDULE_TRANSITIONS: Record<ScheduleStatusCode, Partial<Record<ScheduleStatusCode, string>>> = {
  WAITING: {
    PROCESSING: "the worker claims the post when it is due",
    CANCELLED: "cancelled, or its content archived",
  },
  PROCESSING: {
    PUBLISHED: "the platform accepted the post",
    RETRY_SCHEDULED: "the attempt failed and may be retried, or the worker lost the post mid-attempt",
    FAILED: "the attempt failed for good",
  },
  RETRY_SCHEDULED: {
    PROCESSING: "the worker claims the post when the retry is due",
    WAITING: "edited or moved to another time",
    CANCELLED: "cancelled, or its content archived",
  },
  FAILED: {
    RETRY_SCHEDULED: "retried by a person",
    WAITING: "edited or moved to another time",
    CANCELLED: "cancelled",
  },
  CANCELLED: {
    WAITING: "edited or moved to another time, or restored with its archived content",
    RETRY_SCHEDULED: "retried by a person, or restored with its archived content",
  },
  // A published post stays published; a change is a new post
  PUBLISHED: {},
};

/** Whether a schedule in `from` may become `to`. */
export function canTransition(from: ScheduleStatusCode, to: ScheduleStatusCode): boolean {
  return from === to || to in SCHEDULE_TRANSITIONS[from];
}

/** The platform's own view of a post, separate from the queue state (ARCH-02). */
export const PLATFORM_STATUSES = ["UPLOADING", "PROCESSING", "LIVE", "REJECTED"] as const;
export type PlatformStatusCode = (typeof PLATFORM_STATUSES)[number];

/** What put an attempt in the queue (PublishingJob.trigger). */
export const JOB_TRIGGERS = ["SCHEDULED", "RETRY", "MANUAL"] as const;
export type JobTriggerCode = (typeof JOB_TRIGGERS)[number];
