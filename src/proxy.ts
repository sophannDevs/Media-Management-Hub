import { type NextRequest, NextResponse } from "next/server";

// First, cheap gate (SEC-01): a request without a session cookie never reaches
// a page or an API route. It only checks that the cookie exists; the session
// itself is verified in the Data Access Layer (src/server/auth/dal.ts) by every
// page loader, Server Action and Route Handler.

const SESSION_COOKIE = "mf_session";

/** Reachable without signing in. The cron trigger has its own bearer secret. */
const PUBLIC_PATHS = new Set(["/login", "/setup", "/api/cron/publish", "/api/health"]);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || req.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next.js build assets and the favicon
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
