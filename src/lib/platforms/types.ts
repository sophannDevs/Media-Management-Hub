// Contract every social platform integration implements. Adding TikTok or
// Instagram means adding one provider file and registering it — nothing else
// in the app needs to know platform specifics.

export interface PublishMedia {
  fileName: string;
  mimeType: string;
  size: number;
  /** Absolute path on disk (uploaded files) */
  localPath?: string | null;
  /** Public URL (externally linked files) */
  url?: string | null;
}

export interface PublishRequest {
  scheduleId: string;
  account: {
    id: string;
    name: string;
    status: string;
    externalId: string | null;
    accessToken: string | null;
    tokenExpiresAt: Date | null;
  };
  title: string;
  caption: string;
  hashtags: string;
  visibility: string;
  video: PublishMedia | null;
  thumbnail: PublishMedia | null;
  options: Record<string, unknown>;
}

export interface PublishResult {
  externalId: string;
  url: string;
}

/** Hooks the publishing pipeline gives a provider while it uploads. */
export interface PublishContext {
  /** Provider state saved before the attempt (e.g. a resumable upload session), or null. */
  uploadState: Record<string, unknown> | null;
  /**
   * Persists provider state (e.g. a resumable upload session URL) so an
   * interrupted attempt can be resumed or reconciled instead of re-sent.
   */
  saveUploadState(state: Record<string, unknown>): Promise<void>;
  /** Signals progress; keeps the lease alive during long uploads. */
  progress(info?: { bytesSent?: number; totalBytes?: number }): void;
}

/**
 * Result of asking the platform what happened to an attempt whose outcome is
 * unknown (the process died mid-upload, or the connection dropped after the
 * request was sent).
 */
export type ReconcileResult =
  | { status: "published"; result: PublishResult }
  /** The platform has no such post: safe to publish again. */
  | { status: "not_found" }
  /** Can't tell: a person has to check the platform before retrying. */
  | { status: "unknown"; reason: string };

/**
 * AUTH, QUOTA, RATE and VALIDATION mean the platform refused the post.
 * NETWORK means the request never reached the platform.
 * UNKNOWN_OUTCOME means the post may or may not exist on the platform; it is
 * never retried blindly (see processSchedule).
 */
export const PUBLISH_ERROR_CODES = ["AUTH", "QUOTA", "RATE", "VALIDATION", "NETWORK", "UNKNOWN", "UNKNOWN_OUTCOME"] as const;
export type PublishErrorCode = (typeof PUBLISH_ERROR_CODES)[number];

export class PublishError extends Error {
  constructor(
    message: string,
    public code: PublishErrorCode,
    /** Whether an automatic retry can succeed without user action */
    public retryable: boolean,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

export interface PlatformProvider {
  id: string;
  name: string;
  /** What the account is called on this platform */
  accountNoun: string;
  captionLabel: string;
  visibilityOptions: { value: string; label: string; description?: string }[];
  defaultVisibility: string;
  maxTitleLength: number;
  maxCaptionLength: number;
  supportsThumbnail: boolean;
  /** Real integrations set this once OAuth is implemented. */
  isMock: boolean;
  publish(req: PublishRequest, ctx: PublishContext): Promise<PublishResult>;
  /**
   * Looks up the outcome of an interrupted attempt. Providers that can't
   * answer leave this out, and the post is flagged for a person to check.
   */
  reconcile?(req: PublishRequest, uploadState: Record<string, unknown> | null): Promise<ReconcileResult>;
}
