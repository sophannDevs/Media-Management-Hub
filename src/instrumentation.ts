export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.PUBLISH_WORKER_ENABLED === "false") return;
  const { startWorker } = await import("./server/worker");
  startWorker();
}
