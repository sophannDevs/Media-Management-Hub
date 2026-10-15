// Backs up the database and the uploaded files (DB-04):
//   npm run db:backup [-- --db-only] [-- --keep 14] [-- --dir backups]
//
// backups/<yyyymmdd-hhmmss>/database.dump   pg_dump custom format (restore with npm run db:restore)
// backups/<yyyymmdd-hhmmss>/manifest.json   what the backup should contain: row counts, migrations, files
// backups/files/                            an additive mirror of the uploaded files
//
// Uploaded files are never rewritten (their storage keys are unique), so the
// mirror only ever gains files: each run copies the ones it hasn't seen and
// deletes nothing, which keeps every older dump restorable with its files.
// Run it from a scheduler (cron / Task Scheduler) for regular backups, and
// `npm run db:backup:verify` to prove the latest one restores.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import prisma from "@prisma/client";
import { describeUrl, parseDatabaseUrl, runPg, stamp } from "./lib/pg.mjs";

try {
  process.loadEnvFile();
} catch {}

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const root = path.resolve(flag("--dir", "backups"));
const keep = Number(flag("--keep", 14));
const dbOnly = args.includes("--db-only");
const storageDir = path.resolve(process.env.STORAGE_DIR ?? "./storage");

const url = process.env.DATABASE_URL;
const conn = parseDatabaseUrl(url);

/** Every file under `dir` as a path relative to it, with its size. */
function* walk(dir, base = dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, base);
    else yield { rel: path.relative(base, full), size: statSync(full).size };
  }
}

const db = new prisma.PrismaClient({ datasources: { db: { url } } });
try {
  // Folder names have one-second resolution: a second backup in the same second waits for the next one
  while (existsSync(path.join(root, stamp()))) await new Promise((r) => setTimeout(r, 250));
  const dir = path.join(root, stamp());
  mkdirSync(dir, { recursive: true });

  // 1. The database. The dump and the row counts come from ONE snapshot (an exported
  // REPEATABLE READ snapshot that pg_dump joins), so the manifest describes exactly what
  // the dump holds even while the app keeps writing.
  const { tables, counts, migrations } = await db.$transaction(
    async (tx) => {
      const [{ snap }] = await tx.$queryRawUnsafe(`SELECT pg_export_snapshot() AS snap`);
      const dump = runPg("pg_dump", ["-Fc", "--no-owner", "--no-privileges", `--snapshot=${snap}`, "-f", path.join(dir, "database.dump"), conn.database], url);
      if (dump.status !== 0) throw new Error(`pg_dump failed:\n${dump.stderr}`);

      const names = (await tx.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).map((r) => r.table_name);
      const rows = {};
      for (const t of names) rows[t] = Number((await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`))[0].n);
      const applied = (await tx.$queryRawUnsafe(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`)).map((r) => r.migration_name);
      return { tables: names, counts: rows, migrations: applied };
    },
    { isolationLevel: prisma.Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 900_000, maxWait: 15_000 },
  );

  // 2. The files: copy what the mirror doesn't have yet
  let files = { included: !dbOnly, total: 0, bytes: 0, copied: 0 };
  if (!dbOnly) {
    const mirror = path.join(root, "files");
    for (const f of walk(storageDir)) {
      files.total++;
      files.bytes += f.size;
      const target = path.join(mirror, f.rel);
      if (existsSync(target) && statSync(target).size === f.size) continue;
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(storageDir, f.rel), target);
      files.copied++;
    }
  }

  const serverVersion = (await db.$queryRawUnsafe(`SHOW server_version`))[0].server_version;
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), database: conn.database, serverVersion, tables: counts, migrations, files }, null, 2));

  // 3. Retention: keep the newest `keep` dumps (the file mirror is kept whole)
  const dumps = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d{8}-\d{6}$/.test(e.name)).map((e) => e.name).sort();
  for (const old of dumps.slice(0, Math.max(0, dumps.length - keep))) rmSync(path.join(root, old), { recursive: true, force: true });

  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Backed up ${describeUrl(url)} to ${dir}`);
  console.log(`  database: ${(statSync(path.join(dir, "database.dump")).size / 1024).toFixed(0)} KB, ${tables.length} tables, ${rows} rows, ${migrations.length} migrations`);
  console.log(files.included ? `  files:    ${files.total} (${(files.bytes / 1048576).toFixed(1)} MB), ${files.copied} new in the mirror` : "  files:    skipped (--db-only)");
  console.log(`  kept:     the newest ${Math.min(dumps.length, keep)} dumps`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
