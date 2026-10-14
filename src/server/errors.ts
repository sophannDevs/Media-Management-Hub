/** Machine-readable reasons the UI reacts to (beyond showing the message). */
export type ServiceErrorCode =
  /** Another active schedule exists for this content and account. info.scheduleId */
  | "ALREADY_SCHEDULED"
  /** The content already went out to this account; resubmit with repost to post again. */
  | "ALREADY_PUBLISHED"
  /** The post changed (e.g. the worker started publishing it) since it was loaded. */
  | "CONFLICT"
  /** The last attempt may have gone live; resubmit with confirmation after checking the platform. */
  | "CONFIRM_UNKNOWN_OUTCOME";

/** An error whose message is safe to show to the user. */
export class ServiceError extends Error {
  constructor(
    message: string,
    public details?: string[],
    public code?: ServiceErrorCode,
    public info?: Record<string, string>,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export type ActionFailure = { ok: false; error: string; details?: string[]; code?: ServiceErrorCode; info?: Record<string, string> };

export type ActionResult<T = undefined> = { ok: true; data: T; message?: string } | ActionFailure;
