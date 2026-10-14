// Counts database queries for one request per page (PERF-04 budget: shell ≤ 8).
//   node scripts/measure-queries.mjs [/route ...]
// Needs a production build (`npm run build`, or the one `npm run test:e2e`
// leaves behind) and the seeded prisma/e2e.db from an e2e run.
import { spawn } from "node:child_process";

const port = Number(process.env.MEASURE_PORT ?? 3230);
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ["/", "/content", "/calendar", "/schedule", "/media", "/prompts", "/accounts", "/analytics", "/settings"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (route) => `http://127.0.0.1:${port}${route}`;

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
  env: {
    ...process.env,
    DATABASE_URL: "file:./e2e.db",
    STORAGE_DIR: "./.e2e-storage",
    PUBLISH_WORKER_ENABLED: "false",
    PRISMA_LOG_QUERIES: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
let queries = 0;
server.stdout.on("data", (chunk) => (queries += (String(chunk).match(/prisma:query/g) ?? []).length));

try {
  for (let i = 0; ; i++) {
    if (await fetch(url("/")).then((r) => r.ok, () => false)) break;
    if (i > 120) throw new Error("server did not start");
    await sleep(500);
  }
  console.log("route        queries");
  for (const route of routes) {
    await (await fetch(url(route))).text(); // warm up (compile caches, first-request work)
    await sleep(300);
    queries = 0;
    await (await fetch(url(route))).text();
    await sleep(500);
    console.log(`${route.padEnd(12)} ${queries}`);
  }
} finally {
  server.kill();
}
