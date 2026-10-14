import { type NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/log";
import { acceptRequestId, newRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";

// First, cheap gate (SEC-01): a request without a session cookie never reaches
// a page or an API route. It only checks that the cookie exists; the session
// itself is verified in the Data Access Layer (src/server/auth/dal.ts) by every
// page loader, Server Action and Route Handler.
//
// It also gives every request an id (ARCH-04): the caller's x-request-id if it
// is acceptable (a reverse proxy may set one), else a new one. The app reads it
// from the request headers, and every response carries it back.

const SESSION_COOKIE = "mf_session";

/** Reachable without signing in. The cron trigger has its own bearer secret. */
const PUBLIC_PATHS = new Set(["/login", "/setup", "/api/cron/publish", "/api/health"]);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const requestId = acceptRequestId(req.headers.get(REQUEST_ID_HEADER)) ?? newRequestId();
  const withId = (res: NextResponse) => {
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  };

  if (PUBLIC_PATHS.has(pathname) || req.cookies.has(SESSION_COOKIE)) {
    const headers = new Headers(req.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return withId(NextResponse.next({ request: { headers } }));
  }

  if (pathname.startsWith("/api/")) {
    logger.warn("request refused", { requestId, method: req.method, path: pathname, status: 401, code: "UNAUTHENTICATED" });
    return withId(NextResponse.json({ ok: false, error: "Sign in required.", code: "UNAUTHENTICATED", requestId }, { status: 401 }));
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return withId(NextResponse.redirect(login));
}

export const config = {
  // Everything except Next.js build assets and the favicon
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
