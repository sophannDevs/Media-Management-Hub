// Makes the smaller copies (PERF-08) for every upload that still lacks them:
//   npm run media:derive
// Run it once after upgrading, or after installing ffmpeg so videos get their
// posters. The worker does the same a few files at a time; this does them all now.
try {
  process.loadEnvFile();
} catch {}

void (async () => {
  const { db } = await import("../src/lib/db");
  const { processPendingDerivatives } = await import("../src/server/services/derivatives");
  let attempted = 0;
  let done = 0;
  for (;;) {
    const r = await processPendingDerivatives(25, 0);
    attempted += r.attempted;
    done += r.done;
    if (r.attempted === 0) break;
    console.log(`  ${attempted} looked at, ${done} made`);
  }
  console.log(`${attempted} file(s) without copies: ${done} made, ${attempted - done} failed or skipped (see the log).`);
  await db.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// A module of its own (plain scripts share one global scope)
export {};
