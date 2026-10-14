import { connection, type NextRequest } from "next/server";
import { unauthorizedResponse } from "@/server/auth/dal";
import { searchContentOptions } from "@/server/queries/content";

/**
 * Content pickers (PERF-11): the 20 best matches for a title search, ready to
 * post first (`?order=recent`: most recently updated only). A GET, so lookups
 * don't queue behind Server Actions and stay cheap at any library size.
 */
export async function GET(req: NextRequest) {
  await connection();
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const params = req.nextUrl.searchParams;
  const items = await searchContentOptions(params.get("q") ?? "", { readyFirst: params.get("order") !== "recent" });
  return Response.json(items, { headers: { "Cache-Control": "private, no-store" } });
}
