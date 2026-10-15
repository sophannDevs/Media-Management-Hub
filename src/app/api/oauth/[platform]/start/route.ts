import { connection, NextResponse } from "next/server";
import { apiError, route } from "@/server/api";
import { unauthorizedResponse } from "@/server/auth/dal";
import { ServiceError } from "@/server/errors";
import { appOrigin, beginConnect, OAUTH_COOKIE, PENDING_TTL_MS } from "@/server/services/oauth";

/**
 * Starts connecting a real channel or Page (PUB-07): sends the signed-in owner
 * to the platform's sign-in page and keeps the state and PKCE verifier in a
 * sealed cookie the callback is checked against.
 */
export const GET = route(async (req: Request, ctx: RouteContext<"/api/oauth/[platform]/start">) => {
  await connection();
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const { platform } = await ctx.params;
  try {
    const { url, cookie } = beginConnect(platform, appOrigin(req));
    const res = NextResponse.redirect(url, 302);
    res.cookies.set(OAUTH_COOKIE, cookie, {
      httpOnly: true,
      // Lax: the platform's redirect back is a top-level navigation, which still carries the cookie
      sameSite: "lax",
      secure: process.env.HTTPS_ONLY === "true" || req.headers.get("x-forwarded-proto") === "https",
      path: "/api/oauth",
      maxAge: Math.round(PENDING_TTL_MS / 1000),
    });
    return res;
  } catch (e) {
    if (e instanceof ServiceError) return apiError(400, "VALIDATION", e.message);
    throw e;
  }
});
