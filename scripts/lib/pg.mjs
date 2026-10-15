// Shared by the database scripts: where the PostgreSQL command-line tools are,
// and what a connection string says (DB-04).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Folder of the PostgreSQL tools: PG_BIN, an installed PostgreSQL on Windows, or null (rely on PATH). */
export function pgBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  if (process.platform === "win32") {
    for (const v of ["18", "17", "16", "15"]) {
      const dir = `C:\\Program Files\\PostgreSQL\\${v}\\bin`;
      if (existsSync(dir)) return dir;
    }
  }
  return null;
}

export const pgTool = (name) => {
  const dir = pgBin();
  return dir ? path.join(dir, process.platform === "win32" ? `${name}.exe` : name) : name;
};

/** True when the PostgreSQL tools can be run. */
export const hasPgTools = () => !spawnSync(pgTool("pg_dump"), ["--version"], { encoding: "utf8" }).error;

/** Runs a PostgreSQL tool against a database URL. The password goes in the environment, never on the command line. */
export function runPg(name, args, url, opts = {}) {
  const c = parseDatabaseUrl(url);
  const r = spawnSync(pgTool(name), ["-h", c.host, "-p", String(c.port), "-U", c.user, ...args], {
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: c.password },
    ...opts,
  });
  if (r.error) throw new Error(`${name} could not run (${r.error.message}). Set PG_BIN to your PostgreSQL bin folder.`);
  return r;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function parseDatabaseUrl(url) {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    local: LOCAL_HOSTS.has(u.hostname),
  };
}

/** The same server, another database. */
export function withDatabase(url, database) {
  const u = new URL(url);
  u.pathname = `/${database}`;
  u.search = "";
  return u.toString();
}

/** A URL for messages: the password hidden. */
export function describeUrl(url) {
  const c = parseDatabaseUrl(url);
  return `${c.user}@${c.host}:${c.port}/${c.database}`;
}

/** Exits with a message unless DATABASE_URL points at this machine. For anything that destroys data. */
export function requireLocalDatabase(url, what) {
  const c = parseDatabaseUrl(url);
  if (!c.local) {
    console.error(`${what} refused: DATABASE_URL points at ${c.host}, not at this machine.\nThis command destroys data, so it only runs against a local database.`);
    process.exit(1);
  }
}

export const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
