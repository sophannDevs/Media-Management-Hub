"use server";

import { cookies, headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/log";
import { shortRequestId } from "@/lib/request-id";
import { safeNext, sessionCookieOptions } from "../auth/dal";
import { authenticate, ownerNeedsSetup, setupOwner } from "../auth/owner";
import { createSession, deleteSession, SESSION_COOKIE } from "../auth/session";
import { ServiceError } from "../errors";
import { actionPath, currentRequestId } from "../request-context";

export type AuthFormState = { error?: string; email?: string; name?: string };

/** An unexpected failure of a form action: one log line, and a reference the person can quote. */
async function unexpected(what: string, e: unknown) {
  const requestId = await currentRequestId();
  logger.error(what, { requestId, method: "ACTION", path: await actionPath(), err: e });
  return `Something went wrong. Please try again. (Reference ${shortRequestId(requestId)})`;
}

async function signIn(userId: string) {
  const { token, expiresAt } = await createSession(userId, (await headers()).get("user-agent") ?? "");
  (await cookies()).set(SESSION_COOKIE, token, await sessionCookieOptions(expiresAt));
}

export async function loginAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = String(form.get("email") ?? "");
  try {
    if (await ownerNeedsSetup()) redirect("/setup");
    const user = await authenticate(email, String(form.get("password") ?? ""));
    await signIn(user.id);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ServiceError) return { error: e.message, email };
    return { error: await unexpected("sign-in failed", e), email };
  }
  redirect(safeNext(form.get("next")));
}

export async function setupOwnerAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const name = String(form.get("name") ?? "");
  const email = String(form.get("email") ?? "");
  try {
    const user = await setupOwner({ name, email, password: String(form.get("password") ?? ""), confirm: String(form.get("confirm") ?? "") });
    await signIn(user.id);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ServiceError) return { error: e.message, email, name };
    return { error: await unexpected("owner setup failed", e), email, name };
  }
  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  await deleteSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
