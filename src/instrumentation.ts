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
