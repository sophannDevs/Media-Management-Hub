// A PostgreSQL server for MediaFlow development, kept in .pgdata/ and
// listening on 127.0.0.1:5433. It uses the PostgreSQL binaries installed on
// this machine (PG_BIN, or C:\Program Files\PostgreSQL\<version>\bin, or PATH)
// and never touches any other PostgreSQL server.
//
//   node scripts/db-local.mjs start    create the cluster on first run, then start it
//   node scripts/db-local.mjs stop
//   node scripts/db-local.mjs status
//   node scripts/db-local.mjs url [db] print the connection string (default db: mediaflow)
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".pgdata");
const passwordFile = path.join(dataDir, "mediaflow.password");
const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const user = "mediaflow";

function pgBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  if (process.platform === "win32") {
    for (const v of ["18", "17", "16", "15"]) {
      const dir = `C:\\Program Files\\PostgreSQL\\${v}\\bin`;
      if (existsSync(dir)) return dir;
    }
  }
  return null; // rely on PATH
}
const tool = (name) => {
  const dir = pgBin();
  return dir ? path.join(dir, process.platform === "win32" ? `${name}.exe` : name) : name;
};

function run(name, args, opts = {}) {
  const r = spawnSync(tool(name), args, { encoding: "utf8", ...opts });
  if (r.error) throw new Error(`${name} could not run (${r.error.message}). Set PG_BIN to your PostgreSQL bin folder.`);
  return r;
}

const password = () => readFileSync(passwordFile, "utf8").trim();
export const url = (db = "mediaflow") => `postgresql://${user}:${encodeURIComponent(password())}@127.0.0.1:${port}/${db}`;

function isRunning() {
  return existsSync(dataDir) && run("pg_ctl", ["status", "-D", dataDir]).status === 0;
}

function init() {
  const pw = randomBytes(18).toString("base64url");
  const pwTmp = path.resolve(".pgdata.pw.tmp");
  writeFileSync(pwTmp, pw);
  try {
    const r = run("initdb", ["-D", dataDir, "-U", user, "--pwfile", pwTmp, "--auth=scram-sha-256", "-E", "UTF8", "--no-locale"]);
    if (r.status !== 0) throw new Error(`initdb failed:\n${r.stderr || r.stdout}`);
  } finally {
    rmSync(pwTmp, { force: true });
  }
  writeFileSync(passwordFile, pw);
  console.log(`Created a PostgreSQL cluster in ${dataDir} (user "${user}").`);
}

function start() {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) init();
  if (!isRunning()) {
    // No pipes: the server inherits them on Windows and would keep this call waiting forever
    const r = run("pg_ctl", ["start", "-D", dataDir, "-w", "-l", path.join(dataDir, "server.log"), "-o", `-p ${port} -c listen_addresses=127.0.0.1`], { stdio: "ignore" });
    if (r.status !== 0 || !isRunning()) throw new Error(`pg_ctl start failed. See ${path.join(dataDir, "server.log")}.`);
  }
  // The app database
  const env = { ...process.env, PGPASSWORD: password() };
  const exists = run("psql", ["-h", "127.0.0.1", "-p", String(port), "-U", user, "-d", "postgres", "-tAc", "SELECT 1 FROM pg_database WHERE datname = 'mediaflow'"], { env });
  if (exists.stdout.trim() !== "1") run("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", user, "mediaflow"], { env });
  console.log(`PostgreSQL is running on 127.0.0.1:${port}.`);
}

/** True when DATABASE_URL (environment or .env) points at this local cluster. */
function usesLocalCluster() {
  let value = process.env.DATABASE_URL;
  if (!value && existsSync(".env")) {
    const line = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
    value = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  }
  return !!value && new RegExp(`@(127\\.0\\.0\\.1|localhost):${port}/`).test(value);
}

const command = process.argv[2] ?? "status";
if (command === "start") start();
// Used by `npm run dev`: starts the cluster only when the app is configured to use it
else if (command === "ensure") {
  if (usesLocalCluster()) start();
}
else if (command === "stop") {
  if (isRunning()) run("pg_ctl", ["stop", "-D", dataDir, "-m", "fast", "-w"]);
  console.log("PostgreSQL stopped.");
} else if (command === "status") console.log(isRunning() ? `running on 127.0.0.1:${port}` : "not running");
else if (command === "url") console.log(url(process.argv[3]));
else {
  console.error(`Unknown command "${command}". Use start, stop, status or url.`);
  process.exit(1);
}
