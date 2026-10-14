import { io } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { apiError } from "../api";
import { ServiceError } from "../errors";
import { SESSION_COOKIE, sessionUser } from "./session";

// Data Access Layer (SEC-01). proxy.ts turns away requests without a session
// cookie as an early, cheap check; these functions verify the session for real
// in every page loader, Server Action and Route Handler, as the Next.js docs
// recommend. Call them inside <Suspense> (they read the request).

/** The signed-in owner, or null. Read once per request (per rendered segment). */
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // The expiry check reads the clock: keep it out of prerendering (prefetches included)
  await io();
  return sessionUser(token);
});

/** Pages and page loaders: the signed-in owner, or a redirect to /login. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Server Actions: the signed-in owner, or a ServiceError the client turns into a redirect. */
export async function requireActionUser() {
  const user = await getCurrentUser();
  if (!user) throw new ServiceError("Your session has ended. Sign in again.", undefined, "UNAUTHENTICATED");
  return user;
}

/** Route Handlers: a 401 response to return when nobody is signed in, else null. */
export async function unauthorizedResponse() {
  return (await getCurrentUser()) ? null : apiError(401, "UNAUTHENTICATED", "Sign in required.");
}

/** Cookie settings for the session: never readable by scripts, sent on same-site navigations only. */
export async function sessionCookieOptions(expires: Date) {
  const forwardedProto = (await headers()).get("x-forwarded-proto");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.HTTPS_ONLY === "true" || forwardedProto === "https",
    path: "/",
    expires,
  };
}

/** Only same-site relative paths are accepted as a post-login destination. */
export function safeNext(value: unknown) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
