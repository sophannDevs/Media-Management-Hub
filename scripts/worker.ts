// The publishing worker as its own process (PUB-11):
//   npm run worker
// Uses the same services and database as the web app. Run one or more next to
// `npm start`; posts are claimed with FOR UPDATE SKIP LOCKED, so two workers
// never handle the same post. On Ctrl+C / SIGTERM it finishes the attempt in
// progress (up to 30 s); an upload cut off later is recovered by its lease,
// which checks the platform before anything is sent again.

try {
  process.loadEnvFile();
} catch {}

async function main() {
  // After .env: the client reads DATABASE_URL
  const { startWorker, stopWorker } = await import("../src/server/worker");
  startWorker("PROCESS");
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      console.log(`[worker] ${signal}: finishing the current attempt…`);
      await stopWorker(30_000);
      process.exit(0);
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
