// Restores a backup made by db-backup.mjs (DB-04):
//   npm run db:restore [-- <backup> | latest] [-- --into <database>] [-- --replace] [-- --files]
//   npm run db:backup:verify                       the restore drill (below)
//
// By default the backup is restored into a NEW database next to the real one
// (<name>_restore_<time>) and nothing is overwritten: look at it, copy what you
// need, or point DATABASE_URL at it. --replace rebuilds the database in
// DATABASE_URL itself and only runs against a local database. --files also
// copies back any uploaded file the storage folder is missing.
//
// --verify is the drill: restore into a scratch database, check it against the
// backup's manifest (every table's row count, the applied migrations, and that
// every uploaded file the database refers to is in the storage folder or the
// mirror), drop the scratch database, and exit 1 on any mismatch.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import prisma from "@prisma/client";
import { describeUrl, parseDatabaseUrl, requireLocalDatabase, runPg, stamp, withDatabase } from "./lib/pg.mjs";

try {
  process.loadEnvFile();
} catch {}

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const verify = args.includes("--verify");
const replace = args.includes("--replace");
const restoreFiles = args.includes("--files");
const root = path.resolve(flag("--dir") ?? "backups");
const storageDir = path.resolve(process.env.STORAGE_DIR ?? "./storage");
const url = process.env.DATABASE_URL;
const conn = parseDatabaseUrl(url);

const dumps = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d{8}-\d{6}$/.test(e.name)).map((e) => e.name).sort() : [];
const pick = args.find((a) => !a.startsWith("--") && a !== flag("--into") && a !== flag("--dir")) ?? "latest";
const name = pick === "latest" ? dumps.at(-1) : pick;
if (!name || !existsSync(path.join(root, name, "database.dump"))) {
  console.error(`No backup found${pick === "latest" ? ` in ${root}. Run npm run db:backup first.` : `: ${path.join(root, pick)}`}`);
  process.exit(1);
}
const dir = path.join(root, name);
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));

const target = replace ? conn.database : (flag("--into") ?? `${conn.database}_${verify ? "drill" : "restore"}_${stamp()}`);
if (replace) requireLocalDatabase(url, "--replace");
if (replace && verify) {
  console.error("--replace and --verify don't go together: the drill never touches a real database.");
  process.exit(1);
}
const targetUrl = withDatabase(url, target);

const admin = new prisma.PrismaClient({ datasources: { db: { url: withDatabase(url, "postgres") } } });
let failed = false;
try {
  if (replace || (await admin.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${target.replace(/'/g, "''")}'`)).length) {
    if (!replace) throw new Error(`The database "${target}" already exists. Pick another name with --into.`);
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`);
  }
  await admin.$executeRawUnsafe(`CREATE DATABASE "${target}"`);

  const r = runPg("pg_restore", ["--no-owner", "--no-privileges", "-d", target, path.join(dir, "database.dump")], url);
  if (r.status !== 0) throw new Error(`pg_restore failed:\n${r.stderr}`);

  // What came back, against what the backup says it holds
  const db = new prisma.PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    const problems = [];
    for (const [table, expected] of Object.entries(manifest.tables)) {
      const got = Number((await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${table}"`))[0].n);
      if (got !== expected) problems.push(`${table}: ${got} rows restored, the backup recorded ${expected}`);
    }
    const migrations = (await db.$queryRawUnsafe(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`)).map((m) => m.migration_name);
    if (JSON.stringify(migrations) !== JSON.stringify(manifest.migrations)) problems.push("the applied migrations differ from the backup's");

    const mirror = path.join(root, "files");
    const keys = (await db.$queryRawUnsafe(`SELECT "storageKey" FROM "MediaAsset" WHERE "storageKey" IS NOT NULL`)).map((m) => m.storageKey);
    const missing = keys.filter((k) => !existsSync(path.join(storageDir, k)) && !existsSync(path.join(mirror, k)));
    if (manifest.files.included && missing.length) problems.push(`${missing.length} uploaded file${missing.length === 1 ? " is" : "s are"} in neither the storage folder nor the backup (first: ${missing[0]})`);
    if (!manifest.files.included) console.log("Note: this backup was made with --db-only, so it doesn't cover the uploaded files.");

    if (restoreFiles) {
      let copied = 0;
      for (const k of keys) {
        const from = path.join(mirror, k);
        const to = path.join(storageDir, k);
        if (existsSync(from) && !existsSync(to)) {
          mkdirSync(path.dirname(to), { recursive: true });
          cpSync(from, to);
          copied++;
        }
      }
      console.log(`Copied ${copied} file${copied === 1 ? "" : "s"} back into ${storageDir}.`);
    }

    const rows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
    console.log(`Restored the backup of ${manifest.createdAt} (${name}): ${Object.keys(manifest.tables).length} tables, ${rows} rows, ${manifest.migrations.length} migrations.`);
    if (problems.length) {
      failed = true;
      console.error(`Problems:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    } else {
      console.log(verify ? "The drill passed: every table, the migrations and the files match the backup." : `Everything matches the backup. Restored into ${describeUrl(targetUrl)}.`);
    }
    if (!verify && !replace) console.log(`To use it: DATABASE_URL=${targetUrl.replace(/:[^:@/]+@/, ":<password>@")}`);
  } finally {
    await db.$disconnect();
  }
} catch (e) {
  failed = true;
  console.error(e instanceof Error ? e.message : e);
} finally {
  if (verify) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`).catch(() => {});
  await admin.$disconnect();
}
process.exit(failed ? 1 : 0);
