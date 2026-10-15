import { stat } from "node:fs/promises";
import { type ExternalAccount, fileBody, http, messageOf, type PlatformAuth, PlatformHttpError, toPublishError, wait } from "./oauth";
import { PublishError, type PublishContext, type PublishErrorCode, type PublishRequest, type PublishResult, type ReconcileResult } from "./types";

// Facebook Pages: Facebook Login, the Resumable Upload API and the Video API
// (PUB-07). Built from the official pages read on 15 Oct 2026
// (docs/integrations/platforms.md); nothing here has run against a real Page.

export const GRAPH_VERSION = "v25.0";
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const GRAPH_VIDEO = `https://graph-video.facebook.com/${GRAPH_VERSION}`;
export const FACEBOOK_DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
/** Listed on the Pages and Video API pages for publishing a video to a Page. */
export const FACEBOOK_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "publish_video"];

/** The Meta app, or null while the platform stays simulated. */
export function metaConfig(): { appId: string; appSecret: string } | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  return appId && appSecret ? { appId, appSecret } : null;
}
function requireConfig() {
  const c = metaConfig();
  if (!c) throw new PublishError("Facebook is not configured: set META_APP_ID and META_APP_SECRET.", "AUTH", false);
  return c;
}

const q = (fields: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
};

/** Facebook has no PKCE on its page; `state` is the CSRF defence. The Page tokens are what gets stored per account. */
export const facebookAuth: PlatformAuth = {
  scopes: FACEBOOK_SCOPES,
  authorizationUrl({ redirectUri, state }) {
    const { appId } = requireConfig();
    return `${FACEBOOK_DIALOG}?${q({ client_id: appId, redirect_uri: redirectUri, state, response_type: "code", scope: FACEBOOK_SCOPES.join(",") })}`;
  },
  async exchangeCode({ code, redirectUri }) {
    const { appId, appSecret } = requireConfig();
    const short = await http<{ access_token: string; expires_in?: number }>(`${GRAPH}/oauth/access_token?${q({ client_id: appId, redirect_uri: redirectUri, client_secret: appSecret, code })}`);
    // A long-lived user token (about 60 days) is what the Page tokens are minted from
    const long = await http<{ access_token: string; expires_in?: number }>(`${GRAPH}/oauth/access_token?${q({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: short.data.access_token })}`);
    const seconds = long.data.expires_in ?? 60 * 86_400;
    return { accessToken: long.data.access_token, refreshToken: null, expiresAt: new Date(Date.now() + seconds * 1000), scope: FACEBOOK_SCOPES.join(",") };
  },
  async listAccounts(tokens) {
    const r = await http<{ data?: { id: string; name: string; category?: string; access_token: string; fan_count?: number; picture?: { data?: { url?: string } } }[] }>(
      `${GRAPH}/me/accounts?${q({ fields: "id,name,category,access_token,fan_count,picture{url}", limit: 100, access_token: tokens.accessToken })}`,
    );
    return (r.data.data ?? []).map(
      (p): ExternalAccount => ({
        externalId: p.id,
        name: p.name,
        handle: p.category ? `Page · ${p.category}` : "Page",
        avatarUrl: p.picture?.data?.url ?? null,
        followers: p.fan_count ?? 0,
        // The Page token publishes; the user token it came from starts upload sessions and is kept with it.
        // A Page token from a long-lived user token has no expiry (Facebook's page), so the user token's date is kept as the horizon.
        tokens: { accessToken: p.access_token, refreshToken: tokens.accessToken, expiresAt: tokens.expiresAt ?? null, scope: tokens.scope ?? null },
      }),
    );
  },
  async revoke(tokens) {
    await http(`${GRAPH}/me/permissions?${q({ access_token: tokens.refreshToken ?? tokens.accessToken })}`, { method: "DELETE" });
  },
};

// ---------- errors ----------

const fbCode = (body: unknown): { code: number; subcode: number; type: string } => {
  const e = (body as { error?: { code?: number; error_subcode?: number; type?: string } } | null)?.error;
  return { code: Number(e?.code ?? 0), subcode: Number(e?.error_subcode ?? 0), type: e?.type ?? "" };
};

/** What a Graph API answer means for the post (error codes from Meta's error reference). */
export function classifyFacebook(e: PlatformHttpError): { code: PublishErrorCode; retryable: boolean; message?: string } {
  const { code, subcode, type } = fbCode(e.body);
  const text = `${e.message}${code ? ` (code ${code}${subcode ? `/${subcode}` : ""})` : ""}`;
  if (code === 190 || code === 102 || code === 463 || code === 467 || code === 459 || type === "OAuthException") return { code: "AUTH", retryable: false, message: `Facebook rejected the sign-in: ${text}. Reconnect the Page.` };
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code >= 80000 && code < 80010)) return { code: "RATE", retryable: true, message: `Facebook is rate limiting the app: ${text}` };
  if (code === 1 || code === 2) return { code: "NETWORK", retryable: true, message: `Facebook had a temporary problem: ${text}` };
  if (code >= 200 && code <= 299) return { code: "AUTH", retryable: false, message: `Facebook refused for lack of permission: ${text}. Check the Page role and the app's permissions.` };
  if (code === 100 || code === 368 || e.status === 400) return { code: "VALIDATION", retryable: false, message: `Facebook rejected the request: ${text}` };
  if (e.status === 401 || e.status === 403) return { code: "AUTH", retryable: false, message: `Facebook refused: ${text}` };
  if (e.status === 429) return { code: "RATE", retryable: true, message: `Facebook is rate limiting the app: ${text}` };
  if (e.status >= 500) return { code: "NETWORK", retryable: true, message: `Facebook answered ${e.status}: ${text}` };
  return { code: "UNKNOWN", retryable: false, message: `Facebook answered ${e.status}: ${text}` };
}

// ---------- upload and publish ----------

interface UploadState {
  sessionId?: string;
  size?: number;
  handle?: string;
  videoId?: string;
}

/** The two tokens an account holds: the Page token publishes, the user token starts upload sessions. */
export interface FacebookTokens {
  pageToken: string;
  userToken: string | null;
}

const uploadTimeout = (size: number) => Math.min(6 * 3_600_000, Math.max(600_000, Math.round(size / 50)));
const videoUrl = (pageId: string, videoId: string) => `https://www.facebook.com/${pageId}/videos/${videoId}`;

async function uploadFile(req: PublishRequest, ctx: PublishContext, tokens: FacebookTokens, state: UploadState): Promise<{ handle: string; sessionId: string; size: number }> {
  const { appId } = requireConfig();
  const path = req.video!.localPath!;
  const size = req.video!.size || (await stat(path)).size;
  const userToken = tokens.userToken ?? tokens.pageToken;
  let sessionId = state.sessionId && state.size === size ? state.sessionId : null;
  if (!sessionId) {
    const r = await http<{ id: string }>(`${GRAPH}/${appId}/uploads?${q({ file_name: req.video!.fileName, file_length: size, file_type: req.video!.mimeType, access_token: userToken })}`, { method: "POST" });
    sessionId = r.data.id; // "upload:<id>"
    await ctx.saveUploadState({ ...state, sessionId, size } satisfies UploadState);
  }
  const auth = { Authorization: `OAuth ${userToken}` };
  let offset = 0;
  for (let attempt = 1; ; attempt++) {
    if (attempt > 1 || state.sessionId === sessionId) {
      // Resuming: ask the session where it is
      const r = await http<{ id: string; file_offset: number }>(`${GRAPH}/${sessionId}`, { headers: auth });
      offset = Number(r.data.file_offset) || 0;
    }
    ctx.progress({ phase: "UPLOADING", bytesSent: offset, totalBytes: size });
    try {
      const r = await http<{ h: string }>(`${GRAPH}/${sessionId}`, {
        method: "POST",
        headers: { ...auth, file_offset: String(offset), "Content-Type": "application/octet-stream", "Content-Length": String(size - offset) },
        body: fileBody(path, offset, (sent) => ctx.progress({ phase: "UPLOADING", bytesSent: offset + sent, totalBytes: size })),
        timeoutMs: uploadTimeout(size - offset),
      });
      return { handle: r.data.h, sessionId, size };
    } catch (e) {
      if (!(e instanceof PlatformHttpError && e.status >= 500) && !(e instanceof Error && e.name === "PlatformNetworkError")) throw e;
      if (attempt >= 4) throw e;
      await wait(1000 * attempt);
    }
  }
}

/** Waits (up to `maxMs`) for Facebook to finish processing; throws when it reports an error. */
async function awaitProcessing(videoId: string, pageToken: string, ctx: PublishContext, maxMs = 120_000) {
  const until = Date.now() + maxMs;
  for (;;) {
    const r = await http<{ status?: { video_status?: string; processing_phase?: { status?: string; errors?: { message?: string }[] }; publishing_phase?: { status?: string; errors?: { message?: string }[] } } }>(
      `${GRAPH}/${videoId}?${q({ fields: "status", access_token: pageToken })}`,
    );
    const s = r.data.status;
    const v = s?.video_status;
    if (v === "ready") return "ready" as const;
    if (v === "error" || v === "upload_failed" || v === "expired") {
      const why = s?.processing_phase?.errors?.[0]?.message ?? s?.publishing_phase?.errors?.[0]?.message ?? v;
      throw new PublishError(`Facebook could not publish the video: ${why}.`, "VALIDATION", false);
    }
    ctx.progress({ phase: "PROCESSING" });
    if (Date.now() >= until) return "processing" as const; // the video exists on the Page and finishes on its own
    await wait(5000);
  }
}

/**
 * Uploads the final video through an upload session (resumed when the
 * pipeline saved one), publishes it on the Page, then waits briefly for
 * processing. Throws PublishError with the pipeline's codes.
 */
export async function publishToFacebook(req: PublishRequest, ctx: PublishContext, tokens: FacebookTokens): Promise<PublishResult> {
  const pageId = req.account.externalId;
  if (!pageId) throw new PublishError("This Page was added by hand and has no Facebook id: reconnect it with Facebook.", "AUTH", false);
  if (!req.video?.localPath) throw new PublishError("No final video file to upload (linked videos can't be sent to Facebook).", "VALIDATION", false);
  if (req.video.mimeType !== "video/mp4") throw new PublishError(`Facebook's upload API takes MP4 files; this video is ${req.video.mimeType}.`, "VALIDATION", false);

  let state = (ctx.uploadState as UploadState | null) ?? {};
  let videoId = state.videoId ?? null;
  try {
    if (!videoId) {
      let handle = state.handle ?? null;
      if (!handle) {
        try {
          const uploaded = await uploadFile(req, ctx, tokens, state);
          handle = uploaded.handle;
          state = { ...state, sessionId: uploaded.sessionId, size: uploaded.size, handle };
        } catch (e) {
          throw toPublishError(e, classifyFacebook, state.sessionId ? "during-upload" : "before-upload");
        }
        await ctx.saveUploadState({ ...state });
      }
      const description = [req.caption, req.hashtags].map((s) => s.trim()).filter(Boolean).join("\n\n");
      let r: { data: { id: string } };
      try {
        r = await http<{ id: string }>(`${GRAPH_VIDEO}/${pageId}/videos`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: q({ access_token: tokens.pageToken, title: req.title.trim().slice(0, 255), description: description.slice(0, 63206), fbuploader_video_file_chunk: handle, published: req.visibility === "DRAFT" ? "false" : "true" }),
          timeoutMs: 120_000,
        });
      } catch (e) {
        // Once the publish call is out, Facebook may have created the post: never resend blindly
        throw toPublishError(e, classifyFacebook, "during-upload");
      }
      videoId = r.data.id;
      state = { ...state, videoId };
      await ctx.saveUploadState({ ...state });
    }
  } catch (e) {
    throw toPublishError(e, classifyFacebook, "during-upload");
  }
  try {
    await awaitProcessing(videoId, tokens.pageToken, ctx);
  } catch (e) {
    throw toPublishError(e, classifyFacebook, "during-upload");
  }
  return { externalId: videoId, url: videoUrl(pageId, videoId) };
}

/** After an interrupted attempt: does the Page have the video? */
export async function reconcileFacebook(uploadState: Record<string, unknown> | null, pageId: string | null, tokens: FacebookTokens): Promise<ReconcileResult> {
  const state = (uploadState as UploadState | null) ?? {};
  if (!pageId) return { status: "unknown", reason: "the Page has no Facebook id" };
  if (state.videoId) {
    try {
      await http(`${GRAPH}/${state.videoId}?${q({ fields: "id", access_token: tokens.pageToken })}`);
      return { status: "published", result: { externalId: state.videoId, url: videoUrl(pageId, state.videoId) } };
    } catch (e) {
      if (e instanceof PlatformHttpError && (e.status === 404 || fbCode(e.body).code === 100)) return { status: "not_found" };
      return { status: "unknown", reason: messageOf(e instanceof PlatformHttpError ? e.body : null, e instanceof PlatformHttpError ? e.status : 0) };
    }
  }
  // The file was handed over but the publish call's answer was lost: the post may exist
  if (state.handle) return { status: "unknown", reason: "the publish request may have reached Facebook before the connection dropped; look for the video on the Page" };
  return { status: "not_found" }; // at most an upload session: nothing was published
}
