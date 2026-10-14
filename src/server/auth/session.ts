import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

// Database sessions: the cookie holds a random token and only its SHA-256 is
// stored, so a copy of the database can't be used to sign in. Sessions last 30
// days from sign-in and can be revoked by deleting the row.

export const SESSION_COOKIE = "mf_session";
export const SESSION_DAYS = 30;

const tokenId = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string, userAgent = "") {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { id: tokenId(token), userId, expiresAt, userAgent: userAgent.slice(0, 300) } });
  return { token, expiresAt };
}

export type SessionUser = { id: string; name: string; email: string; role: string };

/**
 * The user behind a session token, or null when it is missing, unknown or
 * expired. One query: it runs on every request (once per rendered segment).
 */
export async function sessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  return db.user.findFirst({
    where: { sessions: { some: { id: tokenId(token), expiresAt: { gt: new Date() } } } },
    select: { id: true, name: true, email: true, role: true },
  });
}

export async function deleteSession(token: string | undefined) {
  if (token) await db.session.deleteMany({ where: { id: tokenId(token) } });
}

/** Removes expired sessions (called from maintenance). */
export async function purgeExpiredSessions() {
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
