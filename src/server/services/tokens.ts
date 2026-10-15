import { db } from "@/lib/db";
import { getProvider } from "@/lib/platforms/registry";
import { PublishError } from "@/lib/platforms/types";
import { decryptSecret, encryptSecret, keyIdOf, rotateSecret, SecretsError } from "@/lib/secrets";
import { ActivityType } from "@/lib/workflow/statuses";
import { ServiceError } from "../errors";
import { logActivity } from "./activity";

// The token vault (SEC-04): the only code that reads or writes the
// accessToken / refreshToken columns. Everything stored there is ciphertext
// from src/lib/secrets.ts; the plain token exists only in memory, on its way
// to a platform API.

export interface PlainTokens {
  accessToken?: string | null;
  refreshToken?: string | null;
}

/** Ciphertext for the columns, or nulls. A missing key is a configuration error the owner has to fix. */
export function sealTokens(tokens: PlainTokens): { accessToken: string | null; refreshToken: string | null } {
  try {
    return {
      accessToken: tokens.accessToken ? encryptSecret(tokens.accessToken) : null,
      refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
    };
  } catch (e) {
    if (e instanceof SecretsError) throw new ServiceError(e.message);
    throw e;
  }
}

/**
 * The token behind a stored column value. Throws SecretsError when the value
 * is there but can't be read (unknown or wrong key, changed value, or a
 * plain-text value from before encryption): the caller treats that as
 * "credentials missing", never as a usable token.
 */
export function openToken(stored: string | null | undefined): string | null {
  return stored ? decryptSecret(stored) : null;
}

/** Saves (encrypted) tokens for an account; `tokenExpiresAt` is when the access token stops working. */
export async function storeAccountTokens(accountId: string, tokens: PlainTokens & { tokenExpiresAt?: Date | null }) {
  const sealed = sealTokens(tokens);
  await db.socialAccount.update({ where: { id: accountId }, data: { ...sealed, ...(tokens.tokenExpiresAt !== undefined ? { tokenExpiresAt: tokens.tokenExpiresAt } : {}) } });
}

export async function clearAccountTokens(accountId: string) {
  await db.socialAccount.update({ where: { id: accountId }, data: { accessToken: null, refreshToken: null } });
}

/**
 * Re-encrypts every stored token with the current (first) key. Run after a
 * new key is added, before the old one is dropped. Values the ring can't read
 * are left alone and counted, so a bad key can't wipe credentials.
 */
export async function rotateAllAccountTokens() {
  const rows = await db.socialAccount.findMany({
    where: { OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }] },
    select: { id: true, accessToken: true, refreshToken: true },
  });
  let rotated = 0;
  let unchanged = 0;
  let unreadable = 0;
  for (const row of rows) {
    const data: { accessToken?: string; refreshToken?: string } = {};
    let failed = false;
    for (const column of ["accessToken", "refreshToken"] as const) {
      const value = row[column];
      if (!value) continue;
      try {
        const next = rotateSecret(value);
        if (next !== value) data[column] = next;
      } catch {
        failed = true;
      }
    }
    if (failed) unreadable++;
    else if (Object.keys(data).length) {
      await db.socialAccount.update({ where: { id: row.id }, data });
      rotated++;
    } else unchanged++;
  }
  if (rotated) {
    await logActivity({
      type: ActivityType.TOKENS_ROTATED,
      message: `${rotated} account token${rotated === 1 ? "" : "s"} re-encrypted under the current key${unreadable ? ` (${unreadable} unreadable, left as is)` : ""}`,
      entity: { type: "ACCOUNT" },
      actor: { userId: null, source: "SYSTEM" },
      meta: { rotated, unchanged, unreadable },
    });
  }
  return { rotated, unchanged, unreadable, total: rows.length };
}

/** Access tokens this close to expiring are renewed before use. */
const REFRESH_AHEAD_MS = 5 * 60_000;

type TokenRow = { id: string; platformId: string; name: string; accessToken: string | null; refreshToken: string | null; tokenExpiresAt: Date | null };

/**
 * The account's access token, renewed first when it is about to expire and
 * the platform can refresh it (PUB-07). Throws SecretsError when the stored
 * value can't be read and PublishError (AUTH) when the platform no longer
 * accepts the sign-in; null when the account has no token.
 */
export async function accessTokenFor(account: TokenRow, opts: { force?: boolean } = {}): Promise<string | null> {
  const token = openToken(account.accessToken);
  if (!token) return null;
  const provider = getProvider(account.platformId);
  const expiring = !!account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < REFRESH_AHEAD_MS;
  if ((!expiring && !opts.force) || !provider?.auth?.refresh || provider.isMock) return token;
  const refreshToken = openToken(account.refreshToken);
  if (!refreshToken) return token; // nothing to renew with: the platform answers 401 if it is dead
  const fresh = await provider.auth.refresh(refreshToken);
  await storeAccountTokens(account.id, { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken ?? refreshToken, tokenExpiresAt: fresh.expiresAt ?? null });
  return fresh.accessToken;
}

/**
 * Renews every connected account's access token that expires within `within`
 * ms (the worker's maintenance pass). Returns the accounts whose sign-in the
 * platform no longer accepts, for the caller to mark and announce.
 */
export async function refreshExpiringTokens(within = 24 * 3_600_000) {
  const rows = await db.socialAccount.findMany({
    where: { status: "CONNECTED", refreshToken: { not: null }, tokenExpiresAt: { lt: new Date(Date.now() + within) } },
    select: { id: true, platformId: true, name: true, accessToken: true, refreshToken: true, tokenExpiresAt: true },
  });
  let refreshed = 0;
  const failed: { id: string; name: string; message: string }[] = [];
  for (const row of rows) {
    try {
      await accessTokenFor(row, { force: true });
      refreshed++;
    } catch (e) {
      if (e instanceof PublishError && e.code === "AUTH") failed.push({ id: row.id, name: row.name, message: e.message });
      // Anything else (network, a damaged value) is left for the next pass
    }
  }
  return { refreshed, failed };
}

/** Which key id each stored token uses, for an operator checking a rotation. */
export async function accountKeyIds() {
  const rows = await db.socialAccount.findMany({ where: { accessToken: { not: null } }, select: { id: true, name: true, accessToken: true } });
  return rows.map((r) => ({ id: r.id, name: r.name, keyId: keyIdOf(r.accessToken) }));
}
