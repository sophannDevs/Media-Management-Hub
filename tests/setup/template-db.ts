import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { adminExec, testServerUrl, withDatabase } from "../helpers/pg";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabase: { server: string; template: string };
  }
}

/**
 * Runs the real migrations once into a template database. Every integration
 * test file then gets its own clone (tests/setup/test-db.ts), so files can run
 * in parallel and never touch the development database.
 */
export default async function setup(project: TestProject) {
  const server = testServerUrl();
  const template = `mediaflow_tt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await adminExec(server, `CREATE DATABASE "${template}"`);
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: withDatabase(server, template), PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
  project.provide("testDatabase", { server, template });
  return () => adminExec(server, `DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`);
}
