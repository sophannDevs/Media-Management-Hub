import { connection, NextResponse } from "next/server";
import { logger } from "@/lib/log";
import { route } from "@/server/api";
import { unauthorizedResponse } from "@/server/auth/dal";
import { ServiceError } from "@/server/errors";
import { appOrigin, completeConnect, OAUTH_COOKIE } from "@/server/services/oauth";

/** One cookie's value from a Cookie header. */
function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * Where the platform sends the browser back (PUB-07). Verifies the state
 * against the cookie set by /start, exchanges the code, connects the accounts
 * and returns the owner to Social Accounts with the outcome in the URL.
 */
export const GET = route(async (req: Request, ctx: RouteContext<"/api/oauth/[platform]/callback">) => {
  await connection();
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const { platform } = await ctx.params;
  const url = new URL(req.url);
  const cookie = cookieValue(req.headers.get("cookie"), OAUTH_COOKIE);

  let target: string;
  try {
    const r = await completeConnect(
      platform,
      { code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error"), errorDescription: url.searchParams.get("error_description") },
      cookie,
    );
    logger.info("accounts connected", { platform, accounts: r.accounts.map((a) => a.name) });
    target = `/accounts?connected=${r.accounts.length}&platform=${encodeURIComponent(platform)}`;
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
    logger.warn("account connection refused", { platform, message: e.message });
    target = `/accounts?error=${encodeURIComponent(e.message)}`;
  }
  const res = NextResponse.redirect(new URL(target, appOrigin(req)), 302);
  res.cookies.set(OAUTH_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/oauth", maxAge: 0 });
  return res;
});
