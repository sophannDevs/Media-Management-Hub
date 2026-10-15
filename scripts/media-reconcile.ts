// Brings storage and the database back in step (MEDIA-03):
//   npm run media:reconcile              removes files no asset references (older than a day)
//   npm run media:reconcile -- --dry-run lists what would be removed, removes nothing
// The worker runs the same pass once a day; this is for running it by hand
// (after a restore, or to see what is lying around).
try {
  process.loadEnvFile();
} catch {}

const dryRun = process.argv.includes("--dry-run");

void (async () => {
  const { db } = await import("../src/lib/db");
  const { reconcileStorage } = await import("../src/server/services/storage-reconcile");
  const r = await reconcileStorage({ dryRun });
  console.log(`${r.listed} stored file(s): ${r.referenced} referenced by an asset, ${r.pending} younger than a day (left alone), ${r.orphans.length} orphaned${dryRun ? " (dry run: not removed)" : " and removed"}.`);
  for (const key of r.orphans) console.log(`  ${dryRun ? "would remove" : "removed"}  ${key}`);
  if (r.missing.length) {
    console.log(`${r.missing.length} asset(s) whose file is missing from storage (left as they are; restore the file or delete the asset):`);
    for (const m of r.missing) console.log(`  ${m.id}  ${m.fileName}  ${m.storageKey}`);
  }
  await db.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// A module of its own (plain scripts share one global scope, and two of them declaring `main` collide)
export {};
