import { randomUUID } from "node:crypto";
import { afterAll, inject } from "vitest";
import { adminExec, withDatabase } from "../helpers/pg";

// Runs before each integration test file, before the file's own imports, so
// the Prisma client in src/lib/db.ts connects to this file's private database.
const { server, template } = inject("testDatabase");
const name = `mediaflow_t_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

// Two clones can't start from the same template at the same instant: retry briefly
for (let attempt = 1; ; attempt++) {
  try {
    // FILE_COPY: ~3 s per clone on Windows, against ~17 s for the default WAL_LOG strategy
    await adminExec(server, `CREATE DATABASE "${name}" TEMPLATE "${template}" STRATEGY FILE_COPY`);
    break;
  } catch (e) {
    if (attempt >= 10 || !String(e).includes("being accessed by other users")) throw e;
    await new Promise((r) => setTimeout(r, 200 * attempt));
  }
}
// A small pool per file keeps parallel test files under PostgreSQL's connection limit
process.env.DATABASE_URL = withDatabase(server, name, { connection_limit: "4" });

afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db.$disconnect();
  await adminExec(server, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
});
