// Measures pages on a large library (PERF-01, PERF-03, PERF-09).
//   node scripts/perf-library.mjs [--items 5000] [--fresh] [--shifts] [/route ...]
// Uses its own database (mediaflow_perf on the local cluster, or
// PERF_DATABASE_URL): the demo seed plus N generated items, built on the first
// run or with --fresh. Needs a production build (`npm run build`, or the one
// `npm run test:e2e` leaves behind). Reports per route: server time (median of
// 5 full responses), HTML size (raw and gzipped, i.e. transferred), and in
// Chromium at 1440 / 820 / 390 px the DOM node count and cumulative layout
// shift (--shifts lists each shift and the elements that moved).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { chromium, devices } from "@playwright/test";
import prisma from "@prisma/client";

const args = process.argv.slice(2);
const items = Number(args[args.indexOf("--items") + 1]) || 5_000;
const routes = args.filter((a) => a.startsWith("/"));
if (!routes.length) routes.push("/content", "/");
const port = Number(process.env.PERF_PORT ?? 3240);

const dbUrl =
  process.env.PERF_DATABASE_URL ??
  (execFileSync(process.execPath, ["scripts/db-local.mjs", "start"], { stdio: "ignore" }),
  execFileSync(process.execPath, ["scripts/db-local.mjs", "url", "mediaflow_perf"], { encoding: "utf8" }).trim());
const env = { ...process.env, DATABASE_URL: dbUrl, STORAGE_DIR: "./.perf-storage", PUBLISH_WORKER_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" };

// Build the library once (the seed takes a minute or two at 5,000 items)
const adminUrl = new URL(dbUrl);
adminUrl.pathname = "/postgres";
const admin = new prisma.PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const dbName = new URL(dbUrl).pathname.slice(1);
const exists = (await admin.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`)).length > 0;
let fresh = args.includes("--fresh") || !exists;
if (!fresh) {
  const db = new prisma.PrismaClient({ datasources: { db: { url: dbUrl } } });
  fresh = (await db.content.count().catch(() => 0)) < items;
  await db.$disconnect();
}
if (fresh) {
  console.log(`Building ${dbName} with ${items} generated items…`);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  for (const step of [["node_modules/prisma/build/index.js", "migrate", "deploy"], ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"]]) {
    const r = spawnSync(process.execPath, step, { env: { ...env, SEED_BULK_ITEMS: String(items) }, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}
await admin.$disconnect();

// A session for the seeded owner
const db = new prisma.PrismaClient({ datasources: { db: { url: dbUrl } } });
const owner = await db.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
const token = randomBytes(32).toString("base64url");
await db.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId: owner.id, expiresAt: new Date(Date.now() + 3_600_000) } });
const total = await db.content.count({ where: { archivedAt: null } });
await db.$disconnect();

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env, stdio: "ignore" });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

try {
  for (let i = 0; ; i++) {
    if (await fetch(`${base}/login`).then((r) => r.ok, () => false)) break;
    if (i > 120) throw new Error("server did not start");
    await sleep(500);
  }
  const browser = await chromium.launch();
  const widths = [
    ["1440", { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }],
    ["820", { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 }, hasTouch: true }],
    ["390", devices["Pixel 7"]],
  ];
  console.log(`${total} content items\n`);
  console.log("route        server ms   HTML KB raw / gzip   DOM 1440/820/390     CLS 1440/820/390");
  for (const route of routes) {
    const headers = { cookie: `mf_session=${token}` };
    await (await fetch(base + route, { headers })).text(); // warm-up
    const times = [];
    let html = "";
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      html = await (await fetch(base + route, { headers })).text();
      times.push(performance.now() - t);
    }
    const bytes = Buffer.byteLength(html);
    const gzipped = gzipSync(html).length;
    process.stdout.write(`${route.padEnd(12)} ${median(times).toFixed(0).padStart(9)} ${`${(bytes / 1024).toFixed(0)} / ${(gzipped / 1024).toFixed(0)}`.padStart(14)}   `);
    const dom = [];
    const cls = [];
    for (const [, device] of widths) {
      const context = await browser.newContext(device);
      await context.addCookies([{ name: "mf_session", value: token, url: base }]);
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__cls = 0;
        window.__shifts = [];
        const describe = (n) => (n?.tagName ? `${n.tagName.toLowerCase()}${n.className && typeof n.className === "string" ? `.${n.className.split(/\s+/).slice(0, 4).join(".")}` : ""}` : "?");
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__cls += e.value;
            window.__shifts.push({ value: e.value, sources: e.sources.map((s) => `${describe(s.node)} y ${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)} h ${Math.round(s.previousRect.height)}→${Math.round(s.currentRect.height)}`) });
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      try {
        await page.goto(base + route, { waitUntil: "load", timeout: 180_000 });
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
        await sleep(500);
        dom.push(await page.evaluate(() => document.getElementsByTagName("*").length));
        cls.push((await page.evaluate(() => window.__cls)).toFixed(3));
        if (args.includes("--shifts")) {
          for (const s of await page.evaluate(() => window.__shifts)) console.log(`\n  [${device.viewport.width}px] shift ${s.value.toFixed(3)}\n    ${s.sources.join("\n    ")}`);
        }
      } catch {
        dom.push("timeout");
        cls.push("timeout");
      }
      await context.close();
    }
    console.log(`${dom.join(" / ").padEnd(20)} ${cls.join(" / ")}`);
  }
  await browser.close();
} finally {
  server.kill();
}
