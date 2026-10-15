import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { PublishError, type PublishErrorCode } from "./types";

// Shared pieces of the real platform integrations (PUB-07): the OAuth
// authorization-code flow, token handling, and HTTP calls that classify
// their failures the way the publishing pipeline expects.

/** Tokens a platform issued for an account. */
export interface TokenSet {
  accessToken: string;
  /** Google: refreshes the access token. Facebook: the long-lived user token a Page token came from (upload sessions need it). */
  refreshToken?: string | null;
  /** When the access token stops working; null when the platform says it doesn't expire (Facebook Page tokens). */
  expiresAt?: Date | null;
  scope?: string | null;
}

/** A channel or Page the signed-in person can publish to. */
export interface ExternalAccount {
  externalId: string;
  name: string;
  handle?: string;
  avatarUrl?: string | null;
  followers?: number;
  /** Credentials specific to this account (a Facebook Page token); otherwise the sign-in's tokens apply */
  tokens?: TokenSet;
}

/** The sign-in and token side of a real integration; absent while a platform is simulated. */
export interface PlatformAuth {
  /** The scopes the sign-in asks for (shown to the owner before they connect). */
  scopes: string[];
  /** Where to send the browser. `state` comes back unchanged; `codeChallenge` is PKCE (S256) where the platform takes it. */
  authorizationUrl(input: { redirectUri: string; state: string; codeChallenge: string }): string;
  /** Exchanges the callback code for tokens (server side: the client secret is used here). */
  exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet>;
  /** A new access token from a refresh token (platforms that have them). */
  refresh?(refreshToken: string): Promise<TokenSet>;
  /** The accounts (channels / Pages) the signed-in person can publish to. */
  listAccounts(tokens: TokenSet): Promise<ExternalAccount[]>;
  /** Tells the platform the app no longer needs the grant. */
  revoke?(tokens: TokenSet): Promise<void>;
}

// ---------- state and PKCE ----------

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** PKCE: a verifier the browser never sees, and the S256 challenge sent with the authorization request. */
export function pkcePair() {
  const codeVerifier = randomToken(48);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

/** application/x-www-form-urlencoded from a plain object (undefined values are left out). */
export function formBody(fields: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) p.set(k, String(v));
  return p.toString();
}

// ---------- HTTP ----------

/** What a platform answered, kept for classification and for support tickets (request ids). */
export class PlatformHttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
    public requestId: string | null,
    /** The answer's headers (Retry-After lives there) */
    public headers: Headers | null = null,
  ) {
    super(message);
    this.name = "PlatformHttpError";
  }
}

/** The request never completed: DNS, connection, timeout. */
export class PlatformNetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "PlatformNetworkError";
  }
}

export interface HttpOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | null;
  /** Milliseconds before the request is abandoned (default 30 s; uploads pass more). */
  timeoutMs?: number;
  /** The platform's request-id header, kept on failures (and returned on success). */
  requestIdHeader?: string;
  /** Statuses outside 2xx that are answers, not failures (308 Resume Incomplete). */
  accept?: number[];
}

export interface HttpResult<T> {
  status: number;
  headers: Headers;
  data: T;
  requestId: string | null;
}

/**
 * fetch with a timeout, a parsed JSON body (or text when it isn't JSON), and
 * one error type for every non-2xx answer so providers classify in one place.
 * `duplex: "half"` lets a stream be the body (an upload from disk).
 */
export async function http<T = unknown>(url: string, opts: HttpOptions = {}): Promise<HttpResult<T>> {
  const { timeoutMs = 30_000, requestIdHeader, accept = [], ...init } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`No answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal, ...(init.body && typeof init.body === "object" && "getReader" in init.body ? { duplex: "half" } : {}) } as RequestInit);
  } catch (e) {
    clearTimeout(timer);
    throw new PlatformNetworkError(e instanceof Error ? e.message : "The request failed.", e);
  }
  let data: unknown = null;
  try {
    const text = await res.text();
    clearTimeout(timer);
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
  } catch (e) {
    clearTimeout(timer);
    throw new PlatformNetworkError(e instanceof Error ? e.message : "The answer could not be read.", e);
  }
  const requestId = requestIdHeader ? res.headers.get(requestIdHeader) : null;
  if (!res.ok && !accept.includes(res.status)) throw new PlatformHttpError(messageOf(data, res.status), res.status, data, requestId, res.headers);
  return { status: res.status, headers: res.headers, data: data as T, requestId };
}

/** A short, safe message from an error body ({error:{message}}, {error_description}, text) or the status. */
export function messageOf(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const err = b.error;
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      if (typeof e.message === "string") return e.message;
    }
    if (typeof err === "string") return typeof b.error_description === "string" ? `${err}: ${b.error_description}` : err;
    if (typeof b.message === "string") return b.message;
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 200);
  return `HTTP ${status}`;
}

/** Seconds to wait from a Retry-After header (seconds or an HTTP date), or null. */
export function retryAfterSeconds(headers: Headers | null | undefined): number | null {
  const raw = headers?.get("retry-after");
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - Date.now()) / 1000));
}

/** A PublishError from anything a platform call threw, using a platform-specific table for HTTP answers. */
export interface HttpClassification {
  code: PublishErrorCode;
  retryable: boolean;
  message?: string;
  /** When the platform's quota resets, for QUOTA (PUB-08) */
  quotaResetAt?: Date | null;
}

export function toPublishError(e: unknown, classifyHttp: (err: PlatformHttpError) => HttpClassification, phase: "before-upload" | "during-upload"): PublishError {
  if (e instanceof PublishError) return e;
  if (e instanceof PlatformHttpError) {
    const c = classifyHttp(e);
    const err = new PublishError(c.message ?? e.message, c.code, c.retryable);
    err.platformRequestId = e.requestId;
    // What the platform said about when to come back (PUB-08)
    err.retryAfterSeconds = retryAfterSeconds(e.headers);
    err.quotaResetAt = c.quotaResetAt ?? null;
    return err;
  }
  if (e instanceof PlatformNetworkError) {
    // Once bytes were sent, the platform may have the post: never resend blindly
    return phase === "during-upload"
      ? new PublishError(`The connection dropped while uploading (${e.message}).`, "UNKNOWN_OUTCOME", false)
      : new PublishError(`Could not reach the platform (${e.message}).`, "NETWORK", true);
  }
  return new PublishError(e instanceof Error ? e.message : "The platform call failed.", "UNKNOWN", false);
}

/** Minutes until the next day starts in Los Angeles: YouTube's quota resets at midnight Pacific time. */
export function minutesUntilPacificMidnight(now = new Date()): number {
  const pacific = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const next = new Date(pacific);
  next.setHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - pacific.getTime()) / 60_000));
}

/**
 * A file (or its tail from `start`) as a request body that reports every
 * megabyte sent: the pipeline renews the post's lease on each report, so a
 * long upload is never mistaken for a dead worker.
 */
export function fileBody(path: string, start: number, onProgress: (bytesSent: number) => void): ReadableStream<Uint8Array> {
  let sent = 0;
  let reported = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      sent += chunk.length;
      if (sent - reported >= 1_048_576) {
        reported = sent;
        onProgress(sent);
      }
      cb(null, chunk);
    },
    flush(cb) {
      if (sent !== reported) onProgress(sent);
      cb();
    },
  });
  return Readable.toWeb(createReadStream(path, start > 0 ? { start } : {}).pipe(counter)) as ReadableStream<Uint8Array>;
}

/** Waits `ms`, for polling loops; tests can stub it. */
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
