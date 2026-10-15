import { db } from "@/lib/db";
import { ActivityType } from "@/lib/workflow/statuses";
import { logActivity } from "../services/activity";
import { ServiceError } from "../errors";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./password";

// The single workspace owner: first-run setup and sign-in with lockout.

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/** True until an owner has a password: /setup is open only then. */
export async function ownerNeedsSetup() {
  return (await db.user.count({ where: { passwordHash: { not: null } } })) === 0;
}

export function passwordProblem(password: string, confirm?: string) {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (confirm !== undefined && confirm !== password) return "The passwords don't match.";
  return null;
}

export async function setupOwner(input: { name: string; email: string; password: string; confirm: string }) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new ServiceError("Enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError("Enter a valid email address.");
  const problem = passwordProblem(input.password, input.confirm);
  if (problem) throw new ServiceError(problem);
  if (!(await ownerNeedsSetup())) throw new ServiceError("The owner account is already set up. Sign in instead.");

  const passwordHash = await hashPassword(input.password);
  // Reuse the existing owner row (seeded or imported) so its history stays linked
  const existing = await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  let id: string;
  if (existing) {
    const claimed = await db.user.updateMany({ where: { id: existing.id, passwordHash: null }, data: { name, email, passwordHash } });
    if (claimed.count === 0) throw new ServiceError("The owner account is already set up. Sign in instead.");
    id = existing.id;
  } else id = (await db.user.create({ data: { name, email, passwordHash }, select: { id: true } })).id;
  await logActivity({ type: ActivityType.USER_CREATED, message: `Owner account set up: ${name}`, entity: { type: "USER", id }, actor: { userId: id, source: "USER" } });
  return { id };
}

let dummyHash: Promise<string> | null = null;

/** Checks the credentials; repeated failures lock the account for 15 minutes. */
export async function authenticate(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  const wrong = new ServiceError("Email or password is incorrect.");
  if (!user?.passwordHash) {
    // Same work as a real check, so response time doesn't reveal which emails exist
    await verifyPassword(password, await (dummyHash ??= hashPassword("not-a-real-password")));
    throw wrong;
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new ServiceError("Too many failed attempts. Try again in a few minutes.");
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    const locked = failed >= MAX_FAILED;
    await db.user.update({
      where: { id: user.id },
      data: locked ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed },
    });
    // Recorded for the owner's own account only: an unknown email leaves no trace (DB-05)
    await logActivity({
      type: ActivityType.USER_SIGNIN_FAILED,
      message: locked ? `Sign-in failed for ${user.email}: locked for ${LOCK_MINUTES} minutes after ${MAX_FAILED} wrong passwords` : `Sign-in failed for ${user.email}: wrong password`,
      entity: { type: "USER", id: user.id },
      actor: { userId: null, source: "SYSTEM" },
      meta: { locked },
    });
    throw wrong;
  }
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await logActivity({ type: ActivityType.USER_SIGNED_IN, message: `${user.name} signed in`, entity: { type: "USER", id: user.id }, actor: { userId: user.id, source: "USER" } });
  return { id: user.id, name: user.name };
}
