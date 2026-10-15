import { db } from "@/lib/db";
import { logger } from "@/lib/log";
import { syncMockAnalytics } from "./services/analytics-sync";
import { processDueSchedules, runMaintenance, WORKER_ID } from "./services/publishing";
import { reconcileStorage } from "./services/storage-reconcile";

const log = logger.child({ component: "worker", workerId: WORKER_ID });

// The publishing worker (PUB-11, PUB-10). It runs as its own process in
// production (`npm run worker`, scripts/worker.ts) so web deploys don't stop
// uploads; in development it runs inside the web server (instrumentation.ts).
// Any number of workers can run: posts are claimed with FOR UPDATE SKIP LOCKED,
// and the periodic jobs below run once per period across all of them.
//   queue        every PUBLISH_WORKER_INTERVAL_SECONDS (default 10)
//   maintenance  hourly (token expiry, reminders, cleanup)
//   analytics    daily (generated numbers for simulated posts)
//   storage      daily (files no asset references are removed after a day, MEDIA-03)

/** INLINE: inside the web server · PROCESS: npm run worker · CRON: passes triggered by POST /api/cron/publish */
export type WorkerMode = "INLINE" | "PROCESS" | "CRON";

const g = globalThis as unknown as {
  __mediaflowWorker?: { timer: NodeJS.Timeout; mode: WorkerMode; stopping: boolean };
  __mediaflowTick?: Promise<unknown> | null;
};

export const queueIntervalSeconds = () => Math.min(300, Math.max(5, Number(process.env.PUBLISH_WORKER_INTERVAL_SECONDS) || 10));
const PERIODIC = { maintenance: 3_600_000, analytics: 86_400_000, "storage-reconcile": 86_400_000 } as const;

/**
 * Runs `fn` if no worker has started this job within `everyMs`. The claim is
 * one conditional write, so with several workers exactly one runs it.
 */
export async function runPeriodic(name: keyof typeof PERIODIC, fn: () => Promise<unknown>, now = new Date()) {
  await db.scheduledTask.createMany({ data: [{ name }], skipDuplicates: true });
  const { count } = await db.scheduledTask.updateMany({
    where: { name, OR: [{ lastStartedAt: null }, { lastStartedAt: { lt: new Date(now.getTime() - PERIODIC[name]) } }] },
    data: { lastStartedAt: now },
  });
  if (!count) return false;
  const started = Date.now();
  let error: string | null = null;
  try {
    await fn();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log.error("periodic job failed", { job: name, err: e });
  }
  await db.scheduledTask.update({ where: { name }, data: { lastFinishedAt: new Date(), lastDurationMs: Date.now() - started, lastError: error } });
  return true;
}

async function beat(mode: WorkerMode, tick?: { ms: number; processed: number }) {
  const now = new Date();
  await db.workerHeartbeat.upsert({
    where: { id: WORKER_ID },
    create: { id: WORKER_ID, mode, lastBeatAt: now, ...(tick ? { lastTickAt: now, lastTickMs: tick.ms, processed: tick.processed } : {}) },
    update: { mode, lastBeatAt: now, ...(tick ? { lastTickAt: now, lastTickMs: tick.ms, processed: { increment: tick.processed } } : {}) },
  });
}

/** One pass: due posts, then any periodic job whose time has come. Overlapping calls share the running pass. */
export function tick(): Promise<{ processed: number; published: number; failed: number; retry: number } | null> {
  if (g.__mediaflowTick) return g.__mediaflowTick as Promise<null>;
  const run = (async () => {
    const started = Date.now();
    try {
      const summary = await processDueSchedules();
      await runPeriodic("maintenance", () => runMaintenance());
      await runPeriodic("analytics", () => syncMockAnalytics());
      await runPeriodic("storage-reconcile", () => reconcileStorage());
      await beat(g.__mediaflowWorker?.mode ?? "CRON", { ms: Date.now() - started, processed: summary.processed });
      if (summary.processed) log.info("queue pass", { ...summary, ms: Date.now() - started });
      return summary;
    } catch (e) {
      log.error("queue pass failed", { err: e });
      return null;
    } finally {
      g.__mediaflowTick = null;
    }
  })();
  g.__mediaflowTick = run;
  return run;
}

/** Starts the queue loop in this process (once). */
export function startWorker(mode: WorkerMode) {
  if (g.__mediaflowWorker) return;
  const seconds = queueIntervalSeconds();
  g.__mediaflowWorker = { timer: setInterval(() => void tick(), seconds * 1000), mode, stopping: false };
  setTimeout(() => void tick(), mode === "INLINE" ? 5000 : 0);
  log.info("worker started", { mode, intervalSeconds: seconds });
}

/** Stops taking new work and waits (up to `graceMs`) for the attempt in progress. An unfinished upload is recovered by its lease. */
export async function stopWorker(graceMs = 30_000) {
  const w = g.__mediaflowWorker;
  if (!w || w.stopping) return;
  w.stopping = true;
  clearInterval(w.timer);
  if (g.__mediaflowTick) await Promise.race([g.__mediaflowTick, new Promise((r) => setTimeout(r, graceMs))]);
  await db.workerHeartbeat.deleteMany({ where: { id: WORKER_ID } }).catch(() => {});
}

/** True when this process runs a worker (then a nudge can start a pass right away). */
export const workerRunsHere = () => !!g.__mediaflowWorker && !g.__mediaflowWorker.stopping;

/**
 * A request to look at the queue now (retry, "Run queue now"). Never waits for
 * an upload (PUB-06): in this process it starts a pass in the background;
 * a separate worker picks the post up on its next check.
 */
export function nudgeWorker() {
  if (workerRunsHere()) void tick();
  return { inProcess: workerRunsHere(), withinSeconds: queueIntervalSeconds() };
}

/** Live workers, newest beat first; a worker is live if it beat within three queue intervals. */
export async function workerStatus(now = new Date()) {
  const liveAfter = new Date(now.getTime() - queueIntervalSeconds() * 3_000);
  const [latest] = await db.workerHeartbeat.findMany({ orderBy: { lastBeatAt: "desc" }, take: 1 });
  const live = await db.workerHeartbeat.count({ where: { lastBeatAt: { gte: liveAfter } } });
  return {
    live,
    mode: latest?.mode ?? null,
    lastBeatAt: latest?.lastBeatAt ?? null,
    lastTickMs: latest?.lastTickMs ?? null,
    intervalSeconds: queueIntervalSeconds(),
  };
}
