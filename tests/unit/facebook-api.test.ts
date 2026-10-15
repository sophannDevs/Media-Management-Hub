import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/oauth", async (orig) => ({ ...(await orig<typeof import("@/lib/platforms/oauth")>()), wait: async () => {} }));

import { classifyFacebook, FACEBOOK_DIALOG, facebookAuth, GRAPH, GRAPH_VIDEO, publishToFacebook, reconcileFacebook } from "@/lib/platforms/facebook-api";
import { PlatformHttpError } from "@/lib/platforms/oauth";
import type { PublishContext, PublishRequest } from "@/lib/platforms/types";

// PUB-07: the Facebook Pages integration against a scripted Graph API.

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null };
let calls: Call[];
let script: (call: Call) => Response | Promise<Response>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

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

const dir = mkdtempSync(path.join(tmpdir(), "mf-fb-"));
const VIDEO = path.join(dir, "final.mp4");
writeFileSync(VIDEO, Buffer.alloc(2048, 3));

function request(over: Partial<PublishRequest> = {}): PublishRequest {
  return {
    scheduleId: "s1",
    account: { id: "a1", name: "Lab Page", status: "CONNECTED", externalId: "PAGE1", accessToken: "page-token", refreshToken: "user-token", tokenExpiresAt: null },
    title: "Ten tools",
    caption: "A countdown.",
    hashtags: "#ai",
    visibility: "PUBLISH",
    video: { fileName: "final.mp4", mimeType: "video/mp4", size: 2048, localPath: VIDEO, url: null },
    thumbnail: null,
    options: {},
    ...over,
  };
}
const tokens = { pageToken: "page-token", userToken: "user-token" };

function context(uploadState: Record<string, unknown> | null = null) {
  const saved: Record<string, unknown>[] = [];
  const ctx: PublishContext = { uploadState, saveUploadState: async (s) => void saved.push(s), progress: () => {} };
  return { ctx, saved };
}

beforeEach(() => {
  calls = [];
  process.env.META_APP_ID = "app-id";
  process.env.META_APP_SECRET = "app-secret";
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
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
});

describe("Facebook sign-in", () => {
  it("builds the login dialog URL with state and the Page permissions", () => {
    const url = new URL(facebookAuth.authorizationUrl({ redirectUri: "https://app.test/api/oauth/facebook/callback", state: "st-2", codeChallenge: "ignored" }));
    expect(url.origin + url.pathname).toBe(FACEBOOK_DIALOG);
    expect(params(url.toString())).toMatchObject({ client_id: "app-id", redirect_uri: "https://app.test/api/oauth/facebook/callback", state: "st-2", response_type: "code" });
    expect(url.searchParams.get("scope")!.split(",")).toEqual(expect.arrayContaining(["pages_manage_posts", "publish_video"]));
  });

  it("exchanges the code, then trades the short-lived token for a long-lived one", async () => {
    script = (c) => (params(c.url).grant_type === "fb_exchange_token" ? json(200, { access_token: "long", expires_in: 5_183_944 }) : json(200, { access_token: "short", expires_in: 5000 }));
    const t = await facebookAuth.exchangeCode({ code: "c", redirectUri: "https://app.test/cb", codeVerifier: "v" });
    expect(params(calls[0].url)).toMatchObject({ client_id: "app-id", client_secret: "app-secret", redirect_uri: "https://app.test/cb", code: "c" });
    expect(params(calls[1].url)).toMatchObject({ grant_type: "fb_exchange_token", fb_exchange_token: "short" });
    expect(t).toMatchObject({ accessToken: "long", refreshToken: null });
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 86_400_000);
  });

  it("lists the Pages with their own tokens, keeping the user token beside each", async () => {
    script = () => json(200, { data: [{ id: "P1", name: "Lab", category: "Education", access_token: "pt1", fan_count: 31400, picture: { data: { url: "https://i/p.png" } } }, { id: "P2", name: "Daily", access_token: "pt2" }] });
    const accounts = await facebookAuth.listAccounts({ accessToken: "long", expiresAt: new Date(1_900_000_000_000) });
    expect(calls[0].url).toContain(`${GRAPH}/me/accounts?`);
    expect(params(calls[0].url).fields).toContain("access_token");
    expect(accounts).toEqual([
      { externalId: "P1", name: "Lab", handle: "Page · Education", avatarUrl: "https://i/p.png", followers: 31400, tokens: { accessToken: "pt1", refreshToken: "long", expiresAt: new Date(1_900_000_000_000), scope: null } },
      { externalId: "P2", name: "Daily", handle: "Page", avatarUrl: null, followers: 0, tokens: { accessToken: "pt2", refreshToken: "long", expiresAt: new Date(1_900_000_000_000), scope: null } },
    ]);
  });
});

describe("Facebook error classification", () => {
  const err = (status: number, code?: number, type?: string) => new PlatformHttpError("msg", status, code ? { error: { code, type } } : null, "fb-trace");
  it.each([
    [400, 190, "OAuthException", "AUTH", false],
    [400, 4, undefined, "RATE", true],
    [400, 613, undefined, "RATE", true],
    [400, 80001, undefined, "RATE", true],
    [500, 2, undefined, "NETWORK", true],
    [403, 200, undefined, "AUTH", false],
    [400, 100, undefined, "VALIDATION", false],
    [400, undefined, undefined, "VALIDATION", false],
    [502, undefined, undefined, "NETWORK", true],
    [418, undefined, undefined, "UNKNOWN", false],
  ])("%s code %s → %s", (status, code, type, expected, retryable) => {
    expect(classifyFacebook(err(status, code, type))).toMatchObject({ code: expected, retryable });
  });
});

describe("Facebook upload and publish", () => {
  it("opens an upload session with the user token, sends the file, publishes with the Page token and waits for ready", async () => {
    script = (c) => {
      if (c.url.startsWith(`${GRAPH}/app-id/uploads?`)) return json(200, { id: "upload:S1" });
      if (c.url === `${GRAPH}/upload:S1` && c.method === "POST") return json(200, { h: "HANDLE" });
      if (c.url === `${GRAPH_VIDEO}/PAGE1/videos`) return json(200, { id: "V1" });
      if (c.url.startsWith(`${GRAPH}/V1?`)) return json(200, { status: { video_status: "ready" } });
      throw new Error(`unexpected ${c.method} ${c.url}`);
    };
    const { ctx, saved } = context();
    const result = await publishToFacebook(request(), ctx, tokens);
    expect(result).toEqual({ externalId: "V1", url: "https://www.facebook.com/PAGE1/videos/V1" });

    expect(params(calls[0].url)).toMatchObject({ file_name: "final.mp4", file_length: "2048", file_type: "video/mp4", access_token: "user-token" });
    expect(calls[1].headers).toMatchObject({ authorization: "OAuth user-token", file_offset: "0", "content-length": "2048" });
    expect(calls[1].body).toHaveLength(2048);
    const form = Object.fromEntries(new URLSearchParams(calls[2].body!));
    expect(form).toEqual({ access_token: "page-token", title: "Ten tools", description: "A countdown.\n\n#ai", fbuploader_video_file_chunk: "HANDLE", published: "true" });
    expect(params(calls[3].url)).toMatchObject({ fields: "status", access_token: "page-token" });
    expect(saved).toEqual([{ sessionId: "upload:S1", size: 2048 }, { sessionId: "upload:S1", size: 2048, handle: "HANDLE" }, { sessionId: "upload:S1", size: 2048, handle: "HANDLE", videoId: "V1" }]);
  });

  it("resumes a saved session from the offset Facebook reports", async () => {
    script = (c) => {
      if (c.url === `${GRAPH}/upload:S1` && c.method === "GET") return json(200, { id: "upload:S1", file_offset: 512 });
      if (c.url === `${GRAPH}/upload:S1` && c.method === "POST") return json(200, { h: "H2" });
      if (c.url === `${GRAPH_VIDEO}/PAGE1/videos`) return json(200, { id: "V2" });
      if (c.url.startsWith(`${GRAPH}/V2?`)) return json(200, { status: { video_status: "ready" } });
      throw new Error(`unexpected ${c.method} ${c.url}`);
    };
    const { ctx } = context({ sessionId: "upload:S1", size: 2048 });
    expect((await publishToFacebook(request(), ctx, tokens)).externalId).toBe("V2");
    expect(calls[0].method).toBe("GET");
    expect(calls[1].headers).toMatchObject({ file_offset: "512", "content-length": "1536" });
    expect(calls[1].body).toHaveLength(1536);
    expect(calls.some((c) => c.url.includes("/uploads?"))).toBe(false);
  });

  it("publishes a saved handle without uploading again, and only checks a saved video", async () => {
    script = (c) => {
      if (c.url === `${GRAPH_VIDEO}/PAGE1/videos`) return json(200, { id: "V3" });
      if (c.url.startsWith(`${GRAPH}/V3?`)) return json(200, { status: { video_status: "ready" } });
      throw new Error(`unexpected ${c.method} ${c.url}`);
    };
    expect((await publishToFacebook(request(), context({ sessionId: "upload:S1", size: 2048, handle: "OLD" }).ctx, tokens)).externalId).toBe("V3");
    expect(Object.fromEntries(new URLSearchParams(calls[0].body!)).fbuploader_video_file_chunk).toBe("OLD");

    calls = [];
    expect((await publishToFacebook(request(), context({ videoId: "V3" }).ctx, tokens)).externalId).toBe("V3");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("reports a video Facebook could not process as refused by the platform", async () => {
    script = (c) => {
      if (c.url.includes("/uploads?")) return json(200, { id: "upload:S9" });
      if (c.url === `${GRAPH}/upload:S9`) return json(200, { h: "H9" });
      if (c.url === `${GRAPH_VIDEO}/PAGE1/videos`) return json(200, { id: "V9" });
      return json(200, { status: { video_status: "error", processing_phase: { status: "error", errors: [{ message: "Unsupported codec" }] } } });
    };
    const err = await publishToFacebook(request(), context().ctx, tokens).catch((e) => e);
    expect(err).toMatchObject({ code: "VALIDATION", retryable: false });
    expect(err.message).toMatch(/Unsupported codec/);
  });

  it("refuses a Page added by hand, a linked video, and a non-MP4 file before calling Facebook", async () => {
    const noId = await publishToFacebook(request({ account: { ...request().account, externalId: null } }), context().ctx, tokens).catch((e) => e);
    expect(noId).toMatchObject({ code: "AUTH" });
    const linked = await publishToFacebook(request({ video: { fileName: "x.mp4", mimeType: "video/mp4", size: 1, localPath: null, url: "https://cdn/x" } }), context().ctx, tokens).catch((e) => e);
    expect(linked).toMatchObject({ code: "VALIDATION" });
    const mov = await publishToFacebook(request({ video: { ...request().video!, mimeType: "video/quicktime" } }), context().ctx, tokens).catch((e) => e);
    expect(mov.message).toMatch(/MP4/);
    expect(calls).toHaveLength(0);
  });

  it("treats a dropped publish request as an unknown outcome", async () => {
    script = (c) => {
      if (c.url.includes("/uploads?")) return json(200, { id: "upload:S5" });
      if (c.url === `${GRAPH}/upload:S5`) return json(200, { h: "H5" });
      throw new TypeError("socket hang up");
    };
    const err = await publishToFacebook(request(), context().ctx, tokens).catch((e) => e);
    expect(err).toMatchObject({ code: "UNKNOWN_OUTCOME", retryable: false });
  });
});

describe("Facebook reconcile", () => {
  it("answers from what was saved: a video id is checked, a handle is unknown, a session alone is nothing", async () => {
    script = () => json(200, { id: "V1" });
    expect(await reconcileFacebook({ videoId: "V1" }, "PAGE1", tokens)).toEqual({ status: "published", result: { externalId: "V1", url: "https://www.facebook.com/PAGE1/videos/V1" } });
    script = () => json(400, { error: { code: 100, message: "Unsupported get request" } });
    expect(await reconcileFacebook({ videoId: "V1" }, "PAGE1", tokens)).toEqual({ status: "not_found" });
    expect(await reconcileFacebook({ sessionId: "upload:S1", handle: "H" }, "PAGE1", tokens)).toMatchObject({ status: "unknown" });
    expect(await reconcileFacebook({ sessionId: "upload:S1" }, "PAGE1", tokens)).toEqual({ status: "not_found" });
    expect(await reconcileFacebook(null, null, tokens)).toMatchObject({ status: "unknown" });
  });
});
