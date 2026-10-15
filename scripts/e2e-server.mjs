// Starts the app for Playwright on its own database and storage folder:
// fresh database -> migrations -> demo seed -> production build -> `next start`.
// Your development database and ./storage are never touched.
//
//   E2E_DATABASE_URL     PostgreSQL URL of the e2e database (CI); default: mediaflow_e2e
//                        on the local cluster (scripts/db-local.mjs)
//   E2E_PORT=3210        port to listen on
//   E2E_SKIP_BUILD=1     reuse the existing .next build
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import prisma from "@prisma/client";

const port = process.env.E2E_PORT ?? "3210";

function localUrl(db) {
  execFileSync(process.execPath, ["scripts/db-local.mjs", "start"], { stdio: "ignore" });
  return execFileSync(process.execPath, ["scripts/db-local.mjs", "url", db], { encoding: "utf8" }).trim();
}
const dbUrl = process.env.E2E_DATABASE_URL ?? localUrl("mediaflow_e2e");
const dbName = new URL(dbUrl).pathname.slice(1);

// Recreate the e2e database from scratch
const adminUrl = new URL(dbUrl);
adminUrl.pathname = "/postgres";
const admin = new prisma.PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
await admin.$disconnect();

const env = {
  ...process.env,
  DATABASE_URL: dbUrl,
  STORAGE_DIR: "./.e2e-storage",
  PUBLISH_WORKER_ENABLED: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  // Stored tokens are encrypted (SEC-04); the e2e database gets a key of its own
  TOKEN_ENCRYPTION_KEYS: process.env.TOKEN_ENCRYPTION_KEYS ?? `e2e:${randomBytes(32).toString("base64url")}`,
  // The seeded owner signs in with this (tests/e2e/auth.setup.ts)
  SEED_OWNER_PASSWORD: process.env.E2E_OWNER_PASSWORD ?? "e2e-owner-password",
};

function run(args) {
  const r = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

rmSync(".e2e-storage", { recursive: true, force: true });
run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
run(["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"]);
if (!process.env.E2E_SKIP_BUILD) run(["node_modules/next/dist/bin/next", "build"]);

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
