import { tick } from "@/server/worker";

// Trigger for an external scheduler (Vercel Cron, GitHub Actions, crontab…).
// Protected with CRON_SECRET when set: send `Authorization: Bearer <secret>`.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const summary = await tick();
  return Response.json({ ok: true, summary });
}
