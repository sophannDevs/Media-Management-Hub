import { connection, type NextRequest } from "next/server";
import { unauthorizedResponse } from "@/server/auth/dal";
import { getScheduleFormData } from "@/server/queries/schedule-form";

/** Data of the schedule dialog for one content item or one existing post. A GET read (ARCH-03). */
export async function GET(req: NextRequest) {
  await connection();
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const params = req.nextUrl.searchParams;
  const data = await getScheduleFormData({ contentId: params.get("contentId"), scheduleId: params.get("scheduleId") });
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
