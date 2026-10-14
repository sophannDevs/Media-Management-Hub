/** Machine-readable reasons the UI reacts to (beyond showing the message). */
export type ServiceErrorCode =
  /** Another active schedule exists for this content and account. info.scheduleId */
  | "ALREADY_SCHEDULED"
  /** The content already went out to this account; resubmit with repost to post again. */
  | "ALREADY_PUBLISHED"
  /** The post changed (e.g. the worker started publishing it) since it was loaded. */
  | "CONFLICT"
  /** The last attempt may have gone live; resubmit with confirmation after checking the platform. */
  | "CONFIRM_UNKNOWN_OUTCOME"
  /** No valid session: the client sends the user to /login. */
  | "UNAUTHENTICATED";

/** Every code a failure can carry: the service reasons above plus the generic HTTP-like ones (ARCH-04). */
export type ErrorCode = ServiceErrorCode | "VALIDATION" | "NOT_FOUND" | "FORBIDDEN" | "SERVICE_UNAVAILABLE" | "INTERNAL";

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

/** The failure shape of Server Actions and Route Handlers alike (see server/api.ts). */
export type ActionFailure = { ok: false; error: string; details?: string[]; code?: ErrorCode; info?: Record<string, string>; requestId?: string };

export type ActionResult<T = undefined> = { ok: true; data: T; message?: string } | ActionFailure;
