import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/oauth", async (orig) => ({ ...(await orig<typeof import("@/lib/platforms/oauth")>()), wait: async () => {} }));

import { PlatformHttpError } from "@/lib/platforms/oauth";
import { PublishError, type PublishContext, type PublishRequest } from "@/lib/platforms/types";
import { classifyYouTube, GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, googleAuth, publishToYouTube, reconcileYouTube, YOUTUBE_API, YOUTUBE_UPLOAD } from "@/lib/platforms/youtube-api";

// PUB-07: the YouTube integration against a scripted Google. Every request the
// code makes is recorded, so the tests check the protocol, not just the result.

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };
let calls: Call[];
let script: (call: Call) => Response | Promise<Response>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

async function readBody(body: unknown): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof ReadableStream) {
    let out = "";
    const reader = body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return out;
      out += Buffer.from(value).toString("latin1");
    }
  }
  return String(body);
}

const dir = mkdtempSync(path.join(tmpdir(), "mf-yt-"));
const VIDEO = path.join(dir, "final.mp4");
writeFileSync(VIDEO, Buffer.alloc(4096, 7));
const THUMB = path.join(dir, "thumb.jpg");
writeFileSync(THUMB, Buffer.alloc(100, 1));

function request(over: Partial<PublishRequest> = {}): PublishRequest {
  return {
    scheduleId: "s1",
    account: { id: "a1", name: "Lab", status: "CONNECTED", externalId: "UC123", accessToken: "ya29.token", refreshToken: null, tokenExpiresAt: null },
    title: "Ten tools",
    caption: "A countdown.",
    hashtags: "#ai #tools",
    visibility: "UNLISTED",
    video: { fileName: "final.mp4", mimeType: "video/mp4", size: 4096, localPath: VIDEO, url: null },
    thumbnail: { fileName: "thumb.jpg", mimeType: "image/jpeg", size: 100, localPath: THUMB, url: null },
    options: {},
    ...over,
  };
}

function context(uploadState: Record<string, unknown> | null = null) {
  const saved: Record<string, unknown>[] = [];
  const progress: NonNullable<Parameters<PublishContext["progress"]>[0]>[] = [];
  const ctx: PublishContext = { uploadState, saveUploadState: async (s) => void saved.push(s), progress: (i) => void progress.push(i ?? {}) };
  return { ctx, saved, progress };
}

beforeEach(() => {
  calls = [];
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const call: Call = { url: String(url), method: init.method ?? "GET", headers, body: await readBody(init.body) };
    calls.push(call);
    return script(call);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

describe("Google sign-in", () => {
  it("builds the authorization URL with offline access, consent, state and PKCE", () => {
    const url = new URL(googleAuth.authorizationUrl({ redirectUri: "https://app.test/api/oauth/youtube/callback", state: "st-1", codeChallenge: "ch-1" }));
    expect(url.origin + url.pathname).toBe(GOOGLE_AUTH_URL);
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("client-id");
    expect(p.get("redirect_uri")).toBe("https://app.test/api/oauth/youtube/callback");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("state")).toBe("st-1");
    expect(p.get("code_challenge")).toBe("ch-1");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("scope")).toContain("youtube.upload");
  });

  it("exchanges the code server-side and keeps the refresh token", async () => {
    script = () => json(200, { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "s", token_type: "Bearer" });
    const t = await googleAuth.exchangeCode({ code: "4/code", redirectUri: "https://app.test/cb", codeVerifier: "ver" });
    expect(calls[0]).toMatchObject({ url: GOOGLE_TOKEN_URL, method: "POST" });
    const form = new URLSearchParams(calls[0].body!);
    expect(Object.fromEntries(form)).toMatchObject({ code: "4/code", client_id: "client-id", client_secret: "client-secret", redirect_uri: "https://app.test/cb", grant_type: "authorization_code", code_verifier: "ver" });
    expect(t).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_500_000);
  });

  it("refreshes, and treats invalid_grant as a sign-in to redo", async () => {
    script = () => json(200, { access_token: "at2", expires_in: 3600, token_type: "Bearer" });
    const t = await googleAuth.refresh!("rt");
    expect(Object.fromEntries(new URLSearchParams(calls[0].body!))).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt" });
    expect(t).toMatchObject({ accessToken: "at2", refreshToken: "rt" });

    script = () => json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    const err = await googleAuth.refresh!("rt").catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err).toMatchObject({ code: "AUTH", retryable: false });
    expect(err.message).toMatch(/invalid_grant.*Reconnect/);
  });

  it("lists the channel the sign-in can publish to", async () => {
    script = () => json(200, { items: [{ id: "UC1", snippet: { title: "Lab", customUrl: "@lab", thumbnails: { default: { url: "https://i/x.png" } } }, statistics: { subscriberCount: "48200" } }] });
    const accounts = await googleAuth.listAccounts({ accessToken: "at" });
    expect(calls[0].url).toBe(`${YOUTUBE_API}/channels?part=snippet,statistics&mine=true`);
    expect(calls[0].headers.authorization).toBe("Bearer at");
    expect(accounts).toEqual([{ externalId: "UC1", name: "Lab", handle: "@lab", avatarUrl: "https://i/x.png", followers: 48200 }]);
  });
});

describe("YouTube error classification", () => {
  const err = (status: number, reason?: string) => new PlatformHttpError("msg", status, reason ? { error: { errors: [{ reason }] } } : null, null);
  it.each([
    [401, undefined, "AUTH", false],
    [403, "quotaExceeded", "QUOTA", true],
    [403, "dailyLimitExceeded", "QUOTA", true],
    [403, "userRateLimitExceeded", "RATE", true],
    [403, "forbidden", "AUTH", false],
    [403, "insufficientPermissions", "AUTH", false],
    [429, undefined, "RATE", true],
    [400, "invalidTitle", "VALIDATION", false],
    [413, undefined, "VALIDATION", false],
    [503, undefined, "NETWORK", true],
    [418, undefined, "UNKNOWN", false],
  ])("%s %s → %s (retryable %s)", (status, reason, code, retryable) => {
    expect(classifyYouTube(err(status, reason))).toMatchObject({ code, retryable });
  });
});

describe("YouTube upload", () => {
  const SESSION = `${YOUTUBE_UPLOAD}/videos?upload_id=abc`;

  it("starts a resumable session, sends the file, sets the thumbnail and waits for processing", async () => {
    script = (c) => {
      if (c.url.startsWith(`${YOUTUBE_UPLOAD}/videos?uploadType=resumable`)) return json(200, {}, { location: SESSION });
      if (c.url === SESSION && c.method === "PUT") return json(201, { id: "vid1" });
      if (c.url.startsWith(`${YOUTUBE_UPLOAD}/thumbnails/set`)) return json(200, {});
      if (c.url.startsWith(`${YOUTUBE_API}/videos?part=status,processingDetails`)) return json(200, { items: [{ status: { uploadStatus: "uploaded" }, processingDetails: { processingStatus: "succeeded" } }] });
      throw new Error(`unexpected ${c.method} ${c.url}`);
    };
    const { ctx, saved, progress } = context();
    const result = await publishToYouTube(request(), ctx, "ya29.token");
    expect(result).toEqual({ externalId: "vid1", url: "https://youtu.be/vid1" });

    const start = calls[0];
    expect(start.headers).toMatchObject({ authorization: "Bearer ya29.token", "x-upload-content-length": "4096", "x-upload-content-type": "video/mp4" });
    expect(JSON.parse(start.body!)).toEqual({ snippet: { title: "Ten tools", description: "A countdown.\n\n#ai #tools" }, status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false } });
    const put = calls[1];
    expect(put).toMatchObject({ url: SESSION, method: "PUT" });
    expect(put.headers["content-length"]).toBe("4096");
    expect(put.headers["content-range"]).toBeUndefined();
    expect(put.body).toHaveLength(4096);
    expect(calls[2].url).toBe(`${YOUTUBE_UPLOAD}/thumbnails/set?videoId=vid1`);
    expect(calls[2].body).toHaveLength(100);
    expect(saved).toEqual([{ sessionUri: SESSION, size: 4096, mimeType: "video/mp4" }, { sessionUri: SESSION, size: 4096, mimeType: "video/mp4", videoId: "vid1" }]);
    expect(progress.some((p) => p.phase === "UPLOADING")).toBe(true);
  });

  it("resumes an interrupted upload from the byte the session has", async () => {
    script = (c) => {
      if (c.url === SESSION && c.method === "PUT" && c.headers["content-length"] === "0") return new Response("", { status: 308, headers: { range: "bytes=0-1023" } });
      if (c.url === SESSION && c.method === "PUT") return json(201, { id: "vid2" });
      if (c.url.startsWith(`${YOUTUBE_API}/videos?`)) return json(200, { items: [{ processingDetails: { processingStatus: "succeeded" } }] });
      throw new Error(`unexpected ${c.method} ${c.url}`);
    };
    const { ctx, saved } = context({ sessionUri: SESSION, size: 4096, mimeType: "video/mp4" });
    const result = await publishToYouTube(request({ thumbnail: null }), ctx, "t");
    expect(result.externalId).toBe("vid2");
    expect(calls[0].headers["content-range"]).toBe("bytes */4096");
    expect(calls[1].headers["content-range"]).toBe("bytes 1024-4095/4096");
    expect(calls[1].headers["content-length"]).toBe("3072");
    expect(calls[1].body).toHaveLength(3072);
    expect(calls.filter((c) => c.url.includes("uploadType=resumable"))).toHaveLength(0); // no new session
    expect(saved.at(-1)).toMatchObject({ videoId: "vid2" });
  });

  it("starts over when the saved session has expired", async () => {
    const NEW = `${YOUTUBE_UPLOAD}/videos?upload_id=new`;
    script = (c) => {
      if (c.url === SESSION) return json(404, { error: { message: "not found" } });
      if (c.url.startsWith(`${YOUTUBE_UPLOAD}/videos?uploadType=resumable`)) return json(200, {}, { location: NEW });
      if (c.url === NEW && c.method === "PUT") return json(201, { id: "vid3" });
      if (c.url.startsWith(`${YOUTUBE_API}/videos?`)) return json(200, { items: [{ processingDetails: { processingStatus: "succeeded" } }] });
      throw new Error(`unexpected ${c.method} ${c.url}`);
    };
    const { ctx, saved } = context({ sessionUri: SESSION, size: 4096, mimeType: "video/mp4" });
    expect((await publishToYouTube(request({ thumbnail: null }), ctx, "t")).externalId).toBe("vid3");
    expect(saved[0]).toEqual({ sessionUri: NEW, size: 4096, mimeType: "video/mp4" });
  });

  it("reports a video YouTube rejected as refused by the platform, with the reason", async () => {
    script = (c) => {
      if (c.url.includes("uploadType=resumable")) return json(200, {}, { location: SESSION });
      if (c.url === SESSION) return json(201, { id: "vid4" });
      if (c.url.startsWith(`${YOUTUBE_API}/videos?`)) return json(200, { items: [{ status: { uploadStatus: "rejected", rejectionReason: "duplicate" } }] });
      throw new Error(`unexpected ${c.method} ${c.url}`);
    };
    const err = await publishToYouTube(request({ thumbnail: null }), context().ctx, "t").catch((e) => e);
    expect(err).toMatchObject({ code: "VALIDATION", retryable: false });
    expect(err.message).toMatch(/rejected the video: duplicate/);
  });

  it("classifies a failure before any byte was sent as NETWORK, and a dropped upload as unknown outcome", async () => {
    script = () => {
      throw new TypeError("fetch failed");
    };
    const before = await publishToYouTube(request(), context().ctx, "t").catch((e) => e);
    expect(before).toMatchObject({ code: "NETWORK", retryable: true });

    script = (c) => {
      if (c.url.includes("uploadType=resumable")) return json(200, {}, { location: SESSION });
      throw new TypeError("socket hang up");
    };
    const during = await publishToYouTube(request(), context().ctx, "t").catch((e) => e);
    expect(during).toMatchObject({ code: "UNKNOWN_OUTCOME", retryable: false });
  });

  it("refuses a post without a local video file", async () => {
    const err = await publishToYouTube(request({ video: { fileName: "x.mp4", mimeType: "video/mp4", size: 1, localPath: null, url: "https://cdn/x.mp4" } }), context().ctx, "t").catch((e) => e);
    expect(err).toMatchObject({ code: "VALIDATION" });
    expect(calls).toHaveLength(0);
  });
});

describe("YouTube reconcile", () => {
  const SESSION = `${YOUTUBE_UPLOAD}/videos?upload_id=abc`;
  it("knows nothing was sent without a session", async () => {
    expect(await reconcileYouTube(null, "t")).toEqual({ status: "not_found" });
    expect(calls).toHaveLength(0);
  });
  it("asks for the video when its id was saved", async () => {
    script = () => json(200, { items: [{ id: "vid1" }] });
    expect(await reconcileYouTube({ sessionUri: SESSION, size: 1, mimeType: "video/mp4", videoId: "vid1" }, "t")).toEqual({ status: "published", result: { externalId: "vid1", url: "https://youtu.be/vid1" } });
    script = () => json(200, { items: [] });
    expect(await reconcileYouTube({ sessionUri: SESSION, size: 1, mimeType: "video/mp4", videoId: "vid1" }, "t")).toEqual({ status: "not_found" });
  });
  it("asks the session otherwise: finished, unfinished, or gone", async () => {
    script = () => json(200, { id: "vid9" });
    expect(await reconcileYouTube({ sessionUri: SESSION, size: 4096, mimeType: "video/mp4" }, "t")).toMatchObject({ status: "published", result: { externalId: "vid9" } });
    script = () => new Response("", { status: 308, headers: { range: "bytes=0-10" } });
    expect(await reconcileYouTube({ sessionUri: SESSION, size: 4096, mimeType: "video/mp4" }, "t")).toEqual({ status: "not_found" });
    script = () => json(404, {});
    expect(await reconcileYouTube({ sessionUri: SESSION, size: 4096, mimeType: "video/mp4" }, "t")).toMatchObject({ status: "unknown" });
  });
});
