import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { unauthorizedResponse } from "@/server/auth/dal";

// Streams uploaded media. Supports HTTP Range requests so videos can seek.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/files/[...key]">) {
  const unauthorized = await unauthorizedResponse();
  if (unauthorized) return unauthorized;
  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");

  const asset = await db.mediaAsset.findUnique({ where: { storageKey: key }, select: { mimeType: true, fileName: true } });
  const info = asset ? await storage.stat(key) : null;
  if (!asset || !info) return new Response("Not found", { status: 404 });

  const download = req.nextUrl.searchParams.has("download");
  const headers = new Headers({
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(asset.fileName)}"`,
    // Uploaded files are untrusted: never let them run scripts when opened directly (e.g. SVG)
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  });

  const range = req.headers.get("range");
  const match = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start >= info.size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(storage.readStream(key, { start, end }), { status: 206, headers });
  }

  headers.set("Content-Length", String(info.size));
  return new Response(storage.readStream(key), { headers });
}
