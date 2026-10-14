import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fileEtag, isNotModified, parseRange, rangeApplies } from "@/lib/http-cache";
import { storage } from "@/lib/storage";
import { apiError, route } from "@/server/api";
import { unauthorizedResponse } from "@/server/auth/dal";

// Serves uploaded media (PERF-06).
//   - Auth first: a 304 is only ever sent to a signed-in browser.
//   - ETag + Last-Modified, so a repeat request is answered 304 without reading the file.
//   - Storage keys are unique per upload and never rewritten, so the answer is
//     cached for a day and marked immutable. It stays private: the URL needs a session.
//   - HTTP Range for seeking: start-end, start- and the suffix form (-N = the last N bytes).
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/files/[...key]">) => {
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");

  const asset = await db.mediaAsset.findUnique({ where: { storageKey: key }, select: { mimeType: true, fileName: true } });
  const info = asset ? await storage.stat(key) : null;
  if (!asset || !info) return apiError(404, "NOT_FOUND", "File not found.");

  const etag = fileEtag(info.size, info.modifiedAt);
  const validators = { ETag: etag, "Last-Modified": info.modifiedAt.toUTCString(), "Cache-Control": "private, max-age=86400, immutable" };
  if (isNotModified(req.headers, etag, info.modifiedAt)) return new Response(null, { status: 304, headers: validators });

  const download = req.nextUrl.searchParams.has("download");
  const headers = new Headers({
    ...validators,
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(asset.fileName)}"`,
    // Uploaded files are untrusted: never let them run scripts when opened directly (e.g. SVG)
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  });

  const range = rangeApplies(req.headers.get("if-range"), etag, info.modifiedAt) ? parseRange(req.headers.get("range"), info.size) : null;
  if (range === "unsatisfiable") {
    return apiError(416, "VALIDATION", "That byte range isn't available.", { headers: { "Content-Range": `bytes */${info.size}` } });
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(storage.readStream(key, range), { status: 206, headers });
  }

  headers.set("Content-Length", String(info.size));
  return new Response(storage.readStream(key), { headers });
});
