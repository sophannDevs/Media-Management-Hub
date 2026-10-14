// CSRF guard for Route Handlers that change data. Server Actions get the same
// check from Next.js (Origin compared to Host / X-Forwarded-Host); route
// handlers don't, so every non-GET handler calls this first.

/** Hosts allowed besides the request's own, from ALLOWED_ORIGINS ("app.example.com, https://admin.example.com"). */
function allowedHosts() {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => {
      try {
        return new URL(o.includes("://") ? o : `https://${o}`).host;
      } catch {
        return o;
      }
    });
}

/**
 * True for a request a browser sent from another site (the handler answers 403,
 * see rejectCrossSite in server/api.ts). Requests without an Origin header
 * (curl, cron services) are not browser CSRF and pass; they still need their
 * own authorization.
 */
export function isCrossSite(req: Request): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host; // "null" (sandboxed frames, file://) throws
  } catch {
    return true;
  }
  const own = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (own && host === own) return false;
  return !allowedHosts().includes(host);
}
