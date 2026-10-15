import { connection } from "next/server";
import { z } from "zod";
import { apiError, rejectCrossSite, route } from "@/server/api";
import { unauthorizedResponse } from "@/server/auth/dal";
import { discardScriptDraft, MAX_SCRIPT_CHARS, saveScriptDraft } from "@/server/services/script";

// The script editor autosaves what is being typed here (UX-03). This is a
// Route Handler, not a Server Action, because a Server Action refreshes the
// page after it runs and this is called every few seconds while someone types.

const schema = z.object({ body: z.string().max(MAX_SCRIPT_CHARS), baseVersion: z.number().int().min(0) });

/** Keeps the text being written: PUT { body, baseVersion } */
export const PUT = route(async (req: Request, ctx: RouteContext<"/api/content/[id]/script-draft">) => {
  await connection();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.code === "too_big");
    return apiError(tooLong ? 413 : 400, tooLong ? "TOO_LARGE" : "VALIDATION", tooLong ? "The script is too long." : "Send { body, baseVersion }.");
  }
  const { id } = await ctx.params;
  const saved = await saveScriptDraft(id, parsed.data.body, parsed.data.baseVersion);
  if (!saved) return apiError(404, "NOT_FOUND", "That content no longer exists.");
  return Response.json({ ok: true, savedAt: saved.savedAt.toISOString() });
});

/** Throws the draft away (the person chose to discard it). */
export const DELETE = route(async (req: Request, ctx: RouteContext<"/api/content/[id]/script-draft">) => {
  await connection();
  const crossSite = rejectCrossSite(req);
  if (crossSite) return crossSite;
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  await discardScriptDraft(id);
  return Response.json({ ok: true });
});
