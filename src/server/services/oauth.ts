import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { type ExternalAccount, pkcePair, randomToken, type TokenSet } from "@/lib/platforms/oauth";
import { getProvider } from "@/lib/platforms/registry";
import { PublishError } from "@/lib/platforms/types";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { ActivityType } from "@/lib/workflow/statuses";
import { ServiceError } from "../errors";
import { logActivity } from "./activity";
import { sealTokens } from "./tokens";

// Connecting a real channel or Page (PUB-07): the authorization-code flow.
// `beginConnect` builds the platform's sign-in URL and a sealed cookie that
// remembers the state and PKCE verifier; `completeConnect` checks the
// callback against that cookie, exchanges the code, lists the accounts the
// person can publish to and stores each with sealed tokens (SEC-04).

export const OAUTH_COOKIE = "mf_oauth";
/** How long a sign-in may take between leaving for the platform and coming back. */
export const PENDING_TTL_MS = 10 * 60_000;

interface Pending {
  platformId: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  exp: number;
}

/**
 * The app's own origin for redirect URIs. APP_URL when set (the platforms
 * demand an exact match, so production should set it); otherwise what the
 * request says it was addressed to.
 */
export function appOrigin(req: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const redirectUriFor = (origin: string, platformId: string) => `${origin}/api/oauth/${platformId}/callback`;

function realProvider(platformId: string) {
  const provider = getProvider(platformId);
  if (!provider) throw new ServiceError("Unknown platform.");
  if (!provider.auth || provider.isMock) throw new ServiceError(`${provider.name} sign-in is not configured on this server (see .env.example).`);
  return provider as typeof provider & { auth: NonNullable<typeof provider.auth> };
}

/** The platform's sign-in URL and the sealed cookie value the callback is checked against. */
export function beginConnect(platformId: string, origin: string): { url: string; cookie: string } {
  const provider = realProvider(platformId);
  const state = randomToken(24);
  const { codeVerifier, codeChallenge } = pkcePair();
  const redirectUri = redirectUriFor(origin, platformId);
  const url = provider.auth.authorizationUrl({ redirectUri, state, codeChallenge });
  const pending: Pending = { platformId, state, codeVerifier, redirectUri, exp: Date.now() + PENDING_TTL_MS };
  return { url, cookie: encryptSecret(JSON.stringify(pending)) };
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface CallbackParams {
  code?: string | null;
  state?: string | null;
  error?: string | null;
  errorDescription?: string | null;
}

/**
 * Finishes the sign-in: verifies the state against the cookie, exchanges the
 * code and connects every account the person can publish to. Throws
 * ServiceError with a message safe to show.
 */
export async function completeConnect(platformId: string, params: CallbackParams, cookie: string | undefined) {
  const provider = realProvider(platformId);
  if (params.error) throw new ServiceError(`${provider.name} did not grant access: ${params.error}${params.errorDescription ? ` — ${params.errorDescription}` : ""}.`);

  let pending: Pending | null = null;
  try {
    if (cookie) pending = JSON.parse(decryptSecret(cookie)) as Pending;
  } catch {
    pending = null;
  }
  if (!pending || pending.platformId !== platformId) throw new ServiceError("This sign-in was not started here, or its session expired. Try connecting again.");
  if (pending.exp < Date.now()) throw new ServiceError("The sign-in took too long and expired. Try connecting again.");
  if (!params.state || !same(params.state, pending.state)) throw new ServiceError("The sign-in's state did not match (a cross-site request, or two sign-ins at once). Try connecting again.");
  if (!params.code) throw new ServiceError(`${provider.name} sent no authorization code.`);

  let tokens: TokenSet;
  let accounts: ExternalAccount[];
  try {
    tokens = await provider.auth.exchangeCode({ code: params.code, redirectUri: pending.redirectUri, codeVerifier: pending.codeVerifier });
    accounts = await provider.auth.listAccounts(tokens);
  } catch (e) {
    if (e instanceof PublishError) throw new ServiceError(e.message);
    throw new ServiceError(`${provider.name} sign-in failed: ${e instanceof Error ? e.message : "unknown error"}.`);
  }
  if (!accounts.length) throw new ServiceError(`${provider.name} returned no ${provider.accountNoun.toLowerCase()} you can publish to. Check the Page roles / channel of the account you signed in with.`);

  const saved = [];
  for (const a of accounts) {
    const { account, reconnected } = await upsertAccount(platformId, a, a.tokens ?? tokens);
    saved.push(account);
    await logActivity({
      type: reconnected ? ActivityType.ACCOUNT_RECONNECTED : ActivityType.ACCOUNT_CONNECTED,
      message: `${provider.name} ${provider.accountNoun.toLowerCase()} ${reconnected ? "reconnected" : "connected"}: ${account.name}`,
      entity: { type: "ACCOUNT", id: account.id },
    });
  }
  return { platform: provider.name, accounts: saved.map((a) => ({ id: a.id, name: a.name })) };
}

/** One row per platform account (platformId + externalId): a reconnect updates it, a new one is created. */
async function upsertAccount(platformId: string, a: ExternalAccount, tokens: TokenSet) {
  const data = {
    name: a.name,
    handle: a.handle ?? "",
    avatarUrl: a.avatarUrl ?? null,
    followers: a.followers ?? 0,
    status: "CONNECTED",
    lastError: null,
    lastSyncAt: new Date(),
    tokenExpiresAt: tokens.expiresAt ?? null,
    ...sealTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? null }),
  };
  const existing = await db.socialAccount.findFirst({ where: { platformId, externalId: a.externalId }, select: { id: true } });
  if (existing) return { account: await db.socialAccount.update({ where: { id: existing.id }, data }), reconnected: true };
  const isFirst = (await db.socialAccount.count({ where: { platformId } })) === 0;
  try {
    return { account: await db.socialAccount.create({ data: { platformId, externalId: a.externalId, isDefault: isFirst, ...data } }), reconnected: false };
  } catch (e) {
    // Two accounts connected at once both saw "none yet": only one can be the default
    if (isFirst && (e as { code?: string }).code === "P2002") return { account: await db.socialAccount.create({ data: { platformId, externalId: a.externalId, isDefault: false, ...data } }), reconnected: false };
    throw e;
  }
}
