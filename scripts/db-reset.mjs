// `npm run db:reset`: wipes the database and re-applies the migrations (DB-04).
// It refuses to run against anything but a local database, and takes a backup
// first (--no-backup skips that).
import { spawnSync } from "node:child_process";
import { describeUrl, requireLocalDatabase } from "./lib/pg.mjs";

try {
  process.loadEnvFile();
} catch {}

const url = process.env.DATABASE_URL;
requireLocalDatabase(url, "db:reset");

if (!process.argv.includes("--no-backup")) {
  console.log(`Backing up ${describeUrl(url)} before wiping it…`);
  const backup = spawnSync(process.execPath, ["scripts/db-backup.mjs", "--db-only"], { stdio: "inherit" });
  if (backup.status !== 0) {
    console.error("The backup failed, so nothing was wiped. Fix that, or run again with --no-backup.");
    process.exit(1);
  }
}
const reset = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "reset", "--force"], { stdio: "inherit" });
process.exit(reset.status ?? 1);
