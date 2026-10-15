import { connection } from "next/server";
import { apiError, route } from "@/server/api";
import { unauthorizedResponse } from "@/server/auth/dal";
import { getScriptVersionBody } from "@/server/queries/content";

/** The text of one saved script version, fetched when it is opened instead of with every visit to the workspace (PERF-05). */
export const GET = route(async (_req: Request, ctx: RouteContext<"/api/script-versions/[id]">) => {
  await connection();
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const version = await getScriptVersionBody(id);
  if (!version) return apiError(404, "NOT_FOUND", "That version no longer exists.");
  return Response.json(version, { headers: { "Cache-Control": "private, max-age=3600, immutable" } });
});
