import { checkBearer } from "@/lib/security/secret";
import { apiError, rejectCrossSite, route } from "@/server/api";
import { tick } from "@/server/worker";

// Trigger for an external scheduler (Vercel Cron, GitHub Actions, crontab…).
// Send `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET the endpoint
// is disabled: it never runs the worker for an unauthenticated caller.
export const POST = route(async (req) => {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  const auth = checkBearer(req, process.env.CRON_SECRET);
  if (auth === "unset") return apiError(503, "SERVICE_UNAVAILABLE", "This endpoint is disabled. Set CRON_SECRET to enable it.");
  if (auth === "denied") return apiError(401, "UNAUTHENTICATED", "Unauthorized");

  const summary = await tick();
  return Response.json({ ok: true, summary });
});
