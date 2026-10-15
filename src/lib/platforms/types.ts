import type { PlatformAuth } from "./oauth";

export type { ExternalAccount, PlatformAuth, TokenSet } from "./oauth";

// Contract every social platform integration implements. Adding TikTok or
// Instagram means adding one provider file and registering it — nothing else
// in the app needs to know platform specifics.

export interface PublishMedia {
  fileName: string;
  mimeType: string;
  size: number;
  /** Absolute path on disk when the file is stored locally */
  localPath?: string | null;
  /** Public URL (externally linked files) */
  url?: string | null;
  /** The stored bytes from `start` on, wherever the file lives (local disk or a bucket, MEDIA-01) */
  read?: (start?: number) => ReadableStream<Uint8Array>;
}

export interface PublishRequest {
  scheduleId: string;
  account: {
    id: string;
    name: string;
    status: string;
    externalId: string | null;
    accessToken: string | null;
    /** Google: unused here. Facebook: the long-lived user token the Page token came from (upload sessions need it). */
    refreshToken: string | null;
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
  /**
   * Signals progress; keeps the lease alive during long uploads. `phase` is the
   * platform's view of the post (ARCH-02) and `platformRequestId` the platform's
   * request / trace id, kept on the attempt row (PUB-09).
   */
  progress(info?: { bytesSent?: number; totalBytes?: number; phase?: "UPLOADING" | "PROCESSING"; platformRequestId?: string }): void;
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

  /** The platform's request / trace id for this failure, when it sent one (kept on the attempt row). */
  platformRequestId: string | null = null;
  /** Seconds the platform asked us to wait before trying again (a Retry-After header), when it said (PUB-08). */
  retryAfterSeconds: number | null = null;
  /** When the platform's quota resets, when the provider knows (YouTube: midnight Pacific time) (PUB-08). */
  quotaResetAt: Date | null = null;
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
  /** True while the platform is simulated (its credentials are not configured): nothing reaches the real platform. */
  isMock: boolean;
  /** Sign-in and tokens for the real platform; present even while simulated, used only once configured. */
  auth?: PlatformAuth;
  publish(req: PublishRequest, ctx: PublishContext): Promise<PublishResult>;
  /**
   * Looks up the outcome of an interrupted attempt. Providers that can't
   * answer leave this out, and the post is flagged for a person to check.
   */
  reconcile?(req: PublishRequest, uploadState: Record<string, unknown> | null): Promise<ReconcileResult>;
}
