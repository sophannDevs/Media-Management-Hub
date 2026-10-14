import { connection } from "next/server";
import { db } from "@/lib/db";
import { route } from "@/server/api";
import { workerStatus } from "@/server/worker";

/**
 * Health for uptime monitors (public; no hostnames or versions): the database
 * answers, and a publishing worker checked in recently (PUB-11). 200 "ok";
 * 200 "degraded" when no worker is running (the app works, posts won't go
 * out); 503 "down" when the database doesn't answer.
 */
export const GET = route(async () => {
  await connection();
  let database = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = false;
  }
  const worker = database ? await workerStatus().catch(() => null) : null;
  const status = !database ? "down" : worker?.live ? "ok" : "degraded";
  return Response.json(
    {
      status,
      database: database ? "ok" : "down",
      worker: worker && {
        running: worker.live > 0,
        lastSeenSecondsAgo: worker.lastBeatAt ? Math.round((Date.now() - worker.lastBeatAt.getTime()) / 1000) : null,
      },
    },
    { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
});
