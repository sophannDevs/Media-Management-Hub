import { connection, type NextRequest } from "next/server";
import { apiError, route } from "@/server/api";
import { unauthorizedResponse } from "@/server/auth/dal";
import { getActivityPage } from "@/server/queries/content";

/** The next page of a content item's activity history (PERF-05): `?after=<id of the last row you have>`. */
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/content/[id]/activity">) => {
  await connection();
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  const after = req.nextUrl.searchParams.get("after");
  try {
    return Response.json(await getActivityPage(id, after), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // A cursor that no longer exists (the row was deleted)
    return apiError(400, "VALIDATION", "That page of the history isn't available. Reload the page.");
  }
});
