import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, inject } from "vitest";
import { sqliteUrl } from "../helpers/sqlite-url";

// Runs before each integration test file, before the file's own imports, so
// the Prisma client in src/lib/db.ts connects to this file's private copy.
const template = inject("templateDb");
const file = path.join(path.dirname(template), `${randomUUID()}.db`);
fs.copyFileSync(template, file);
process.env.DATABASE_URL = sqliteUrl(file);

afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db.$disconnect();
  for (const f of [file, `${file}-journal`]) fs.rmSync(f, { force: true });
});
