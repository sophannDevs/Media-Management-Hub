// Counts database queries for one request per page (PERF-04: shell ≤ 8, any page ≤ 12).
//   node scripts/measure-queries.mjs [--list] [/route ...]
//   --list prints each query (what a page runs and how often) under its count.
// Needs a production build (`npm run build`, or the one `npm run test:e2e`
// leaves behind) and the seeded e2e database from an e2e run
// (E2E_DATABASE_URL, or mediaflow_e2e on the local cluster).
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import prisma from "@prisma/client";

const databaseUrl =
  process.env.E2E_DATABASE_URL ?? execFileSync(process.execPath, ["scripts/db-local.mjs", "url", "mediaflow_e2e"], { encoding: "utf8" }).trim();

// Pages need a session: create one for the seeded owner directly in the e2e database
const db = new prisma.PrismaClient({ datasources: { db: { url: databaseUrl } } });
const owner = await db.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
const token = randomBytes(32).toString("base64url");
await db.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId: owner.id, expiresAt: new Date(Date.now() + 3_600_000) } });
await db.$disconnect();
const cookie = `mf_session=${token}`;

const port = Number(process.env.MEASURE_PORT ?? 3230);
const list = process.argv.includes("--list");
const given = process.argv.slice(2).filter((a) => a.startsWith("/"));
const routes = given.length ? given : ["/", "/content", "/calendar", "/schedule", "/media", "/prompts", "/accounts", "/analytics", "/settings"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (route) => `http://127.0.0.1:${port}${route}`;

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    STORAGE_DIR: "./.e2e-storage",
    PUBLISH_WORKER_ENABLED: "false",
    PRISMA_LOG_QUERIES: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
let queries = 0;
let seen = [];
server.stdout.on("data", (chunk) => {
  const lines = String(chunk).split(String.fromCharCode(10)).filter((l) => l.includes("prisma:query"));
  queries += lines.length;
  seen.push(...lines);
});

try {
  for (let i = 0; ; i++) {
    if (await fetch(url("/login")).then((r) => r.ok, () => false)) break;
    if (i > 120) throw new Error("server did not start");
    await sleep(500);
  }
  console.log("route        queries");
  for (const route of routes) {
    await (await fetch(url(route), { headers: { cookie } })).text(); // warm up (compile caches, first-request work)
    await sleep(300);
    // The smallest of three counted requests: a straggler from the request before can land in the window
    let best = Infinity;
    let bestSeen = [];
    for (let n = 0; n < 3; n++) {
      queries = 0;
      seen = [];
      await (await fetch(url(route), { headers: { cookie } })).text();
      await sleep(500);
      if (queries < best) [best, bestSeen] = [queries, seen];
    }
    console.log(`${route.padEnd(12)} ${best}`);
    if (list) for (const q of bestSeen) console.log(`    ${q.replace(/^.*prisma:query\s*/, "").replace(/\s+/g, " ").slice(0, 170)}`);
  }
} finally {
  server.kill();
}
