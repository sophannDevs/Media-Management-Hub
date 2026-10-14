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

const refuse = () => Response.json({ ok: false, error: "Cross-site request refused." }, { status: 403 });

/**
 * Returns a 403 response for a request a browser sent from another site, or
 * null to continue. Requests without an Origin header (curl, cron services)
 * are not browser CSRF and pass; they still need their own authorization.
 */
export function rejectCrossSite(req: Request): Response | null {
  if (req.headers.get("sec-fetch-site") === "cross-site") return refuse();
  const origin = req.headers.get("origin");
  if (!origin) return null;
  let host: string;
  try {
    host = new URL(origin).host; // "null" (sandboxed frames, file://) throws
  } catch {
    return refuse();
  }
  const own = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (own && host === own) return null;
  return allowedHosts().includes(host) ? null : refuse();
}
