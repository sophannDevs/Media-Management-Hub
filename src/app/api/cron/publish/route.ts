import { rejectCrossSite } from "@/lib/security/origin";
import { checkBearer } from "@/lib/security/secret";
import { tick } from "@/server/worker";

// Trigger for an external scheduler (Vercel Cron, GitHub Actions, crontab…).
// Send `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET the endpoint
// is disabled: it never runs the worker for an unauthenticated caller.
export async function POST(req: Request) {
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;

  const auth = checkBearer(req, process.env.CRON_SECRET);
  if (auth === "unset") {
    return Response.json({ ok: false, error: "This endpoint is disabled. Set CRON_SECRET to enable it." }, { status: 503 });
  }
  if (auth === "denied") return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const summary = await tick();
  return Response.json({ ok: true, summary });
}
