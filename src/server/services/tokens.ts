import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, keyIdOf, rotateSecret, SecretsError } from "@/lib/secrets";
import { ServiceError } from "../errors";

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
  return { rotated, unchanged, unreadable, total: rows.length };
}

/** Which key id each stored token uses, for an operator checking a rotation. */
export async function accountKeyIds() {
  const rows = await db.socialAccount.findMany({ where: { accessToken: { not: null } }, select: { id: true, name: true, accessToken: true } });
  return rows.map((r) => ({ id: r.id, name: r.name, keyId: keyIdOf(r.accessToken) }));
}
