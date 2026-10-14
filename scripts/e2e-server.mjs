// Starts the app for Playwright on its own database and storage folder:
// fresh migrated database -> demo seed -> production build -> `next start`.
// Your prisma/dev.db and ./storage are never touched.
//
//   E2E_PORT=3210        port to listen on
//   E2E_SKIP_BUILD=1     reuse the existing .next build
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const port = process.env.E2E_PORT ?? "3210";
const env = {
  ...process.env,
  DATABASE_URL: "file:./e2e.db",
  STORAGE_DIR: "./.e2e-storage",
  PUBLISH_WORKER_ENABLED: "false",
  NEXT_TELEMETRY_DISABLED: "1",
};

function run(args) {
  const r = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

for (const f of ["prisma/e2e.db", "prisma/e2e.db-journal"]) rmSync(f, { force: true });
rmSync(".e2e-storage", { recursive: true, force: true });
run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
run(["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"]);
if (!process.env.E2E_SKIP_BUILD) run(["node_modules/next/dist/bin/next", "build"]);

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
