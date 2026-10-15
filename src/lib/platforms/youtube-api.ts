import { stat } from "node:fs/promises";
import { logger } from "@/lib/log";
import { type ExternalAccount, fileBody, formBody, http, messageOf, minutesUntilPacificMidnight, type PlatformAuth, PlatformHttpError, type TokenSet, toPublishError, wait } from "./oauth";
import { PublishError, type PublishContext, type PublishErrorCode, type PublishRequest, type PublishResult, type ReconcileResult } from "./types";

// YouTube Data API v3 (PUB-07). Built from the official pages read on
// 15 Oct 2026 (docs/integrations/platforms.md records what was verified and
// what wasn't); nothing here has run against a real channel yet.

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_UPLOAD = "https://www.googleapis.com/upload/youtube/v3";
/** youtube.upload: videos.insert and thumbnails.set. youtube.readonly: the channel's name and the video's processing state. */
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

const log = logger.child({ component: "youtube" });

/** The Google OAuth client, or null while the platform stays simulated. */
export function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
function requireConfig() {
  const c = googleConfig();
  if (!c) throw new PublishError("YouTube is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.", "AUTH", false);
  return c;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

function tokenSet(d: GoogleTokenResponse, keepRefresh?: string | null): TokenSet {
  return { accessToken: d.access_token, refreshToken: d.refresh_token ?? keepRefresh ?? null, expiresAt: new Date(Date.now() + (d.expires_in ?? 3600) * 1000), scope: d.scope ?? null };
}

const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export const googleAuth: PlatformAuth = {
  scopes: YOUTUBE_SCOPES,
  authorizationUrl({ redirectUri, state, codeChallenge }) {
    const { clientId } = requireConfig();
    // access_type=offline + prompt=consent: a refresh token every time (Google returns one only on the first consent otherwise)
    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: YOUTUBE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `${GOOGLE_AUTH_URL}?${p}`;
  },
  async exchangeCode({ code, redirectUri, codeVerifier }) {
    const { clientId, clientSecret } = requireConfig();
    const r = await http<GoogleTokenResponse>(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: FORM,
      body: formBody({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: codeVerifier }),
    });
    if (!r.data.refresh_token) log.warn("Google returned no refresh token; the sign-in will stop working when the access token expires");
    return tokenSet(r.data);
  },
  async refresh(refreshToken) {
    const { clientId, clientSecret } = requireConfig();
    try {
      const r = await http<GoogleTokenResponse>(GOOGLE_TOKEN_URL, { method: "POST", headers: FORM, body: formBody({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
      return tokenSet(r.data, refreshToken);
    } catch (e) {
      // invalid_grant: revoked, expired (7 days while the consent screen is in Testing), or the password changed
      if (e instanceof PlatformHttpError && e.status === 400) throw new PublishError(`Google no longer accepts the saved sign-in (${messageOf(e.body, e.status)}). Reconnect the channel.`, "AUTH", false);
      throw toPublishError(e, classifyYouTube, "before-upload");
    }
  },
  async listAccounts(tokens) {
    const r = await http<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } }; statistics?: { subscriberCount?: string } }[] }>(
      `${YOUTUBE_API}/channels?part=snippet,statistics&mine=true`,
      { headers: bearer(tokens.accessToken) },
    );
    return (r.data.items ?? []).map(
      (c): ExternalAccount => ({
        externalId: c.id,
        name: c.snippet.title,
        handle: c.snippet.customUrl ?? "",
        avatarUrl: c.snippet.thumbnails?.default?.url ?? null,
        followers: Number(c.statistics?.subscriberCount ?? 0) || 0,
      }),
    );
  },
  async revoke(tokens) {
    await http(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(tokens.refreshToken ?? tokens.accessToken)}`, { method: "POST", headers: FORM });
  },
};

// ---------- errors ----------

const reasonOf = (body: unknown): string => {
  const b = body as { error?: { errors?: { reason?: string }[]; status?: string } } | null;
  return b?.error?.errors?.[0]?.reason ?? b?.error?.status ?? "";
};

/** What a YouTube / Google answer means for the post. */
export function classifyYouTube(e: PlatformHttpError): { code: PublishErrorCode; retryable: boolean; message?: string } {
  const reason = reasonOf(e.body);
  const text = `${e.message}${reason ? ` (${reason})` : ""}`;
  if (e.status === 401) return { code: "AUTH", retryable: false, message: `YouTube rejected the sign-in: ${text}. Reconnect the channel.` };
  if (e.status === 403) {
    if (/quota|dailyLimit/i.test(reason)) return { code: "QUOTA", retryable: true, message: `YouTube API quota exceeded (${reason}); it resets at midnight Pacific time, in about ${Math.ceil(minutesUntilPacificMidnight() / 60)} h.` };
    if (/rateLimit/i.test(reason)) return { code: "RATE", retryable: true, message: `YouTube is rate limiting the app (${reason}).` };
    return { code: "AUTH", retryable: false, message: `YouTube refused (${text}). Check the channel's permissions and the API project.` };
  }
  if (e.status === 429) return { code: "RATE", retryable: true, message: `YouTube is rate limiting the app: ${text}` };
  if (e.status === 400 || e.status === 404 || e.status === 413 || e.status === 422) return { code: "VALIDATION", retryable: false, message: `YouTube rejected the request: ${text}` };
  if (e.status >= 500) return { code: "NETWORK", retryable: true, message: `YouTube answered ${e.status}: ${text}` };
  return { code: "UNKNOWN", retryable: false, message: `YouTube answered ${e.status}: ${text}` };
}

// ---------- upload ----------

interface UploadState {
  sessionUri: string;
  size: number;
  mimeType: string;
  videoId?: string;
}

const privacyOf = (visibility: string) => (visibility === "UNLISTED" ? "unlisted" : visibility === "PRIVATE" ? "private" : "public");
const uploadTimeout = (size: number) => Math.min(6 * 3_600_000, Math.max(600_000, Math.round(size / 50)));
/** videos.insert needs the resource's snippet and status; tags live in the description (hashtags there are searchable). */
function videoResource(req: PublishRequest) {
  const description = [req.caption, req.hashtags].map((s) => s.trim()).filter(Boolean).join("\n\n");
  return { snippet: { title: req.title.trim().slice(0, 100), description: description.slice(0, 5000) }, status: { privacyStatus: privacyOf(req.visibility), selfDeclaredMadeForKids: false } };
}

async function startSession(req: PublishRequest, token: string, size: number, mimeType: string): Promise<string> {
  const r = await http(`${YOUTUBE_UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": mimeType },
    body: JSON.stringify(videoResource(req)),
  });
  const sessionUri = r.headers.get("location");
  if (!sessionUri) throw new PublishError("YouTube did not return an upload session.", "UNKNOWN", false);
  return sessionUri;
}

type SessionStatus = { kind: "done"; videoId: string } | { kind: "incomplete"; nextByte: number } | { kind: "expired" };

/** Asks a resumable session how much it has: 308 + Range, or the finished video. */
async function sessionStatus(sessionUri: string, size: number, token: string): Promise<SessionStatus> {
  try {
    const r = await http<{ id?: string }>(sessionUri, { method: "PUT", headers: { ...bearer(token), "Content-Length": "0", "Content-Range": `bytes */${size}` }, accept: [308] });
    if (r.status === 308) {
      const range = r.headers.get("range"); // "bytes=0-999999": the last byte received; absent: nothing received
      const last = range ? Number(range.split("-")[1]) : -1;
      return { kind: "incomplete", nextByte: Number.isFinite(last) ? last + 1 : 0 };
    }
    if (r.data?.id) return { kind: "done", videoId: r.data.id };
    throw new PublishError("YouTube answered the upload status without a video id.", "UNKNOWN_OUTCOME", false);
  } catch (e) {
    if (e instanceof PlatformHttpError && e.status === 404) return { kind: "expired" };
    throw e;
  }
}

/** Sends the file from `start`, resuming on a cut connection up to a few times. Returns the video id. */
async function sendFile(sessionUri: string, path: string, size: number, mimeType: string, start: number, token: string, ctx: PublishContext): Promise<string> {
  let offset = start;
  for (let attempt = 1; ; attempt++) {
    const headers: Record<string, string> = { ...bearer(token), "Content-Length": String(size - offset), "Content-Type": mimeType };
    if (offset > 0) headers["Content-Range"] = `bytes ${offset}-${size - 1}/${size}`;
    ctx.progress({ phase: "UPLOADING", bytesSent: offset, totalBytes: size });
    try {
      const r = await http<{ id?: string }>(sessionUri, {
        method: "PUT",
        headers,
        body: fileBody(path, offset, (sent) => ctx.progress({ phase: "UPLOADING", bytesSent: offset + sent, totalBytes: size })),
        timeoutMs: uploadTimeout(size - offset),
        accept: [308],
      });
      if (r.status !== 308 && r.data?.id) return r.data.id;
      // 308 after a full send: the server has less than we sent; ask where it is
    } catch (e) {
      // Resumable per Google: 5xx and dropped connections. Anything else is final.
      if (!(e instanceof PlatformHttpError && e.status >= 500) && !(e instanceof Error && e.name === "PlatformNetworkError")) throw e;
      if (attempt >= 4) throw e;
    }
    const status = await sessionStatus(sessionUri, size, token);
    if (status.kind === "done") return status.videoId;
    if (status.kind === "expired") throw new PlatformHttpError("The upload session expired.", 404, null, null);
    offset = status.nextByte;
    await wait(1000 * attempt);
  }
}

/** Waits (up to `maxMs`) for YouTube to finish processing; throws when it rejected the video. */
async function awaitProcessing(videoId: string, token: string, ctx: PublishContext, maxMs = 120_000) {
  const until = Date.now() + maxMs;
  for (;;) {
    const r = await http<{ items?: { status?: { uploadStatus?: string; rejectionReason?: string; failureReason?: string }; processingDetails?: { processingStatus?: string; processingFailureReason?: string } }[] }>(
      `${YOUTUBE_API}/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`,
      { headers: bearer(token) },
    );
    const v = r.data.items?.[0];
    if (!v) throw new PublishError("YouTube no longer lists the uploaded video.", "UNKNOWN_OUTCOME", false);
    const upload = v.status?.uploadStatus;
    const processing = v.processingDetails?.processingStatus;
    if (upload === "rejected") throw new PublishError(`YouTube rejected the video: ${v.status?.rejectionReason ?? "no reason given"}.`, "VALIDATION", false);
    if (upload === "failed" || processing === "failed") throw new PublishError(`YouTube could not process the video: ${v.status?.failureReason ?? v.processingDetails?.processingFailureReason ?? "no reason given"}.`, "VALIDATION", false);
    if (processing === "succeeded" || upload === "processed") return "succeeded" as const;
    ctx.progress({ phase: "PROCESSING" });
    if (Date.now() >= until) return "processing" as const; // YouTube finishes on its own; the video exists
    await wait(5000);
  }
}

async function setThumbnail(videoId: string, thumbnail: NonNullable<PublishRequest["thumbnail"]>, token: string) {
  if (!thumbnail.localPath) return;
  try {
    const size = thumbnail.size || (await stat(thumbnail.localPath)).size;
    await http(`${YOUTUBE_UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": thumbnail.mimeType, "Content-Length": String(size) },
      body: fileBody(thumbnail.localPath, 0, () => {}),
      timeoutMs: 120_000,
    });
  } catch (e) {
    // The video is live; a thumbnail that didn't take is not a failed publish (channels without a verified phone can't set custom thumbnails)
    log.warn("thumbnail not set", { videoId, err: e });
  }
}

/**
 * Uploads the final video with the resumable protocol, resuming an attempt
 * the pipeline saved earlier, then sets the thumbnail and waits briefly for
 * processing. Throws PublishError with the pipeline's codes.
 */
export async function publishToYouTube(req: PublishRequest, ctx: PublishContext, token: string): Promise<PublishResult> {
  const path = req.video?.localPath;
  if (!req.video || !path) throw new PublishError("No final video file to upload (linked videos can't be sent to YouTube).", "VALIDATION", false);
  const mimeType = req.video.mimeType || "application/octet-stream";
  const size = req.video.size || (await stat(path)).size;
  let state = ctx.uploadState as UploadState | null;
  if (state && (state.size !== size || state.mimeType !== mimeType)) state = null; // a different file: the old session is useless

  let videoId = state?.videoId ?? null;
  try {
    if (!videoId) {
      let start = 0;
      let sessionUri = state?.sessionUri ?? null;
      if (sessionUri) {
        const status = await sessionStatus(sessionUri, size, token);
        if (status.kind === "done") videoId = status.videoId;
        else if (status.kind === "incomplete") start = status.nextByte;
        else sessionUri = null; // expired: start over
      }
      if (!videoId) {
        if (!sessionUri) {
          sessionUri = await startSession(req, token, size, mimeType);
          await ctx.saveUploadState({ sessionUri, size, mimeType } satisfies UploadState);
        }
        try {
          videoId = await sendFile(sessionUri, path, size, mimeType, start, token, ctx);
        } catch (e) {
          if (e instanceof PlatformHttpError && e.status === 404) {
            // The session expired mid-way: one fresh session, from the start
            sessionUri = await startSession(req, token, size, mimeType);
            await ctx.saveUploadState({ sessionUri, size, mimeType } satisfies UploadState);
            videoId = await sendFile(sessionUri, path, size, mimeType, 0, token, ctx);
          } else throw toPublishError(e, classifyYouTube, "during-upload");
        }
      }
      await ctx.saveUploadState({ sessionUri: sessionUri!, size, mimeType, videoId } satisfies UploadState);
    }
  } catch (e) {
    throw toPublishError(e, classifyYouTube, state?.sessionUri || videoId ? "during-upload" : "before-upload");
  }

  if (req.thumbnail) await setThumbnail(videoId, req.thumbnail, token);
  try {
    await awaitProcessing(videoId, token, ctx);
  } catch (e) {
    throw toPublishError(e, classifyYouTube, "during-upload");
  }
  return { externalId: videoId, url: `https://youtu.be/${videoId}` };
}

/** After an interrupted attempt: does YouTube have the video? */
export async function reconcileYouTube(uploadState: Record<string, unknown> | null, token: string): Promise<ReconcileResult> {
  const state = uploadState as UploadState | null;
  if (!state?.sessionUri) return { status: "not_found" }; // nothing was ever sent
  try {
    if (state.videoId) {
      const r = await http<{ items?: { id: string }[] }>(`${YOUTUBE_API}/videos?part=id&id=${encodeURIComponent(state.videoId)}`, { headers: bearer(token) });
      return r.data.items?.length ? { status: "published", result: { externalId: state.videoId, url: `https://youtu.be/${state.videoId}` } } : { status: "not_found" };
    }
    const status = await sessionStatus(state.sessionUri, state.size, token);
    if (status.kind === "done") return { status: "published", result: { externalId: status.videoId, url: `https://youtu.be/${status.videoId}` } };
    if (status.kind === "incomplete") return { status: "not_found" }; // the next attempt resumes the same session
    return { status: "unknown", reason: "the upload session expired before YouTube reported an outcome" };
  } catch (e) {
    return { status: "unknown", reason: e instanceof Error ? e.message : "YouTube could not be asked" };
  }
}
