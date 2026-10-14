import { processDueSchedules, runMaintenance } from "./services/publishing";

// In-process scheduler for the publishing queue. Started from instrumentation.ts
// when the Node.js server boots. In production you can disable it
// (PUBLISH_WORKER_ENABLED=false) and call POST /api/cron/publish from an
// external cron instead.

const g = globalThis as unknown as { __mediaflowWorker?: NodeJS.Timeout; __mediaflowTickRunning?: boolean };

export async function tick() {
  if (g.__mediaflowTickRunning) return null;
  g.__mediaflowTickRunning = true;
  try {
    const summary = await processDueSchedules();
    await runMaintenance();
    if (summary.processed) console.log(`[publisher] processed ${summary.processed}:`, summary);
    return summary;
  } catch (e) {
    console.error("[publisher] tick failed", e);
    return null;
  } finally {
    g.__mediaflowTickRunning = false;
  }
}

export function startWorker() {
  if (g.__mediaflowWorker) return;
  const seconds = Math.max(15, Number(process.env.PUBLISH_WORKER_INTERVAL_SECONDS ?? 60));
  g.__mediaflowWorker = setInterval(tick, seconds * 1000);
  // First run shortly after boot
  setTimeout(tick, 5000);
  console.log(`[publisher] worker started — checking the queue every ${seconds}s`);
}
