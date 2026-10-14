import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { sqliteUrl } from "../helpers/sqlite-url";

declare module "vitest" {
  export interface ProvidedContext {
    templateDb: string;
  }
}

/**
 * Runs the real migrations once into a template database. Every integration
 * test file then gets its own copy (tests/setup/test-db.ts), so files can run
 * in parallel and never touch prisma/dev.db.
 */
export default function setup(project: TestProject) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mediaflow-tests-"));
  const template = path.join(dir, "template.db");
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: sqliteUrl(template), PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
  project.provide("templateDb", template);
  return () => fs.rmSync(dir, { recursive: true, force: true });
}
