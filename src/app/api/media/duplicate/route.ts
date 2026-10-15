import { connection } from "next/server";
import { apiError, route } from "@/server/api";
import { unauthorizedResponse } from "@/server/auth/dal";
import { findDuplicate } from "@/server/services/media";

/**
 * Early warning before an upload (MEDIA-02): the browser hashes the file and
 * asks whether the same bytes are already in the library. The server checks
 * again when the upload lands (the browser's hash is only a hint).
 */
export const GET = route(async (req) => {
  await connection();
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const sha256 = (new URL(req.url).searchParams.get("sha256") ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) return apiError(400, "VALIDATION", "Send a SHA-256 hex digest.");
  const duplicateOf = await findDuplicate(sha256);
  return Response.json({ ok: true, duplicateOf }, { headers: { "Cache-Control": "no-store" } });
});
