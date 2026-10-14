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

export type PublishErrorCode = "AUTH" | "QUOTA" | "VALIDATION" | "NETWORK" | "UNKNOWN";

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
  publish(req: PublishRequest): Promise<PublishResult>;
}
