import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * PostgreSQL server for test databases: TEST_DATABASE_URL (CI), or the local
 * development cluster from scripts/db-local.mjs, started if needed.
 */
export function testServerUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  execFileSync(process.execPath, ["scripts/db-local.mjs", "start"], { stdio: "ignore" });
  return execFileSync(process.execPath, ["scripts/db-local.mjs", "url", "postgres"], { encoding: "utf8" }).trim();
}

/** The same server URL pointing at another database, with optional query parameters. */
export function withDatabase(url: string, database: string, params: Record<string, string> = {}) {
  const u = new URL(url);
  u.pathname = `/${database}`;
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** Runs one statement (CREATE / DROP DATABASE) on the server's maintenance database. */
export async function adminExec(url: string, sql: string) {
  const admin = new PrismaClient({ datasources: { db: { url: withDatabase(url, "postgres", { connection_limit: "1" }) } } });
  try {
    await admin.$executeRawUnsafe(sql);
  } finally {
    await admin.$disconnect();
  }
}
