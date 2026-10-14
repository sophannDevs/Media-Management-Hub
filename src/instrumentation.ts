import type { Instrumentation } from "next";

// Runs once per server instance. The publishing worker runs inside the web
// server only in development (or with PUBLISH_WORKER_ENABLED=true); in
// production it is its own process, `npm run worker`, so deploys and restarts
// of the web server don't interrupt uploads (PUB-11).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const setting = process.env.PUBLISH_WORKER_ENABLED;
  const inline = setting === "true" || (setting === undefined && process.env.NODE_ENV !== "production");
  if (!inline) return;
  const { startWorker } = await import("./server/worker");
  startWorker("INLINE");
}

/**
 * A page made of several streamed sections reports one underlying failure once
 * per section (a database outage showed up 11 times for one request). The
 * same error (same digest) in the same request is logged once.
 */
const reported = new Map<string, number>();
function firstReport(key: string) {
  const now = Date.now();
  for (const [k, at] of reported) {
    if (now - at < 60_000) break; // oldest first: the rest are newer
    reported.delete(k);
  }
  if (reported.has(key)) return false;
  reported.set(key, now);
  if (reported.size > 500) reported.delete(reported.keys().next().value as string);
  return true;
}

/**
 * One structured line for every server error Next.js catches that the app
 * didn't answer itself: a page that failed to render, an uncaught error in a
 * Server Action, a failure in the proxy (ARCH-04). `digest` is what the error
 * page shows as its reference, so a person's report finds this line. Route
 * Handlers and Server Actions that handle their own errors log through
 * route() and runAction instead. This is also the hook for an external error
 * tracker, if one is added.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { logger } = await import("./lib/log");
  const id = request.headers["x-request-id"];
  const requestId = Array.isArray(id) ? id[0] : id;
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  const path = request.path.split("?")[0];
  if (!firstReport(`${requestId ?? path}:${digest ?? (err instanceof Error ? err.message : String(err))}`)) return;
  logger.error("request failed", {
    requestId,
    method: request.method,
    path,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    digest,
    err,
  });
};
