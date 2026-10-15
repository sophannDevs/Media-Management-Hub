import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { expect, type Page, type Response, test } from "@playwright/test";
import { ROUTES } from "./routes";

// PERF-10: how much JavaScript each page loads. Measured in a real browser
// against the production build, so it counts what a visitor downloads,
// uncompressed ("raw") and gzipped. Two numbers per page:
//   initial  the scripts the page's own HTML asks for: what a first visit has to
//            download and run before the page is interactive (this is budgeted)
//   idle     everything fetched by the time the network goes quiet, which adds
//            the code of other pages that the browser prefetches in the background

/**
 * Largest allowed raw (uncompressed) KB per page: what was measured when PERF-10
 * was done, plus 5% room. A page that grows past its budget fails this test;
 * raise a budget only on purpose, when the page really needs more code.
 * Most of every page is the framework itself (React and the Next.js client
 * runtime are about 560 KB of the 660 KB the lightest page loads), so the
 * budgets are set against what was achieved, not a round number.
 */
const BUDGET_KB: Record<string, { initial: number; idle: number }> = {
  "/": { initial: 700, idle: 1140 },
  "/content": { initial: 840, idle: 1140 },
  "/calendar": { initial: 820, idle: 1180 },
  "/schedule": { initial: 740, idle: 1140 },
  "/media": { initial: 840, idle: 1140 },
  "/prompts": { initial: 760, idle: 1030 },
  "/accounts": { initial: 750, idle: 1030 },
  "/analytics": { initial: 1130, idle: 1530 },
  "/settings": { initial: 800, idle: 1030 },
  "/content/[id]": { initial: 890, idle: 1140 },
};

type Size = { scripts: number; rawKB: number; gzipKB: number };
type Measure = { route: string; initial: Size; idle: Size; files?: { file: string; rawKB: number; gzipKB: number }[] };

const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;

async function measure(page: Page, route: string, open: () => Promise<Response | null>): Promise<Measure> {
  const sizes = new Map<string, { raw: number; gzip: number }>();
  page.on("response", async (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith("/_next/static/") || !url.pathname.endsWith(".js")) return;
    try {
      const body = await res.body();
      sizes.set(url.pathname, { raw: body.length, gzip: gzipSync(body, { level: 6 }).length });
    } catch {
      // a response that went away mid-navigation is not part of the page
    }
  });
  const html = await (await open())!.text();
  await page.waitForLoadState("networkidle");
  const sizeOf = (paths: string[]): Size & { files: { file: string; raw: number; gzip: number }[] } => {
    const files = [...new Set(paths)].flatMap((file) => {
      const s = sizes.get(file);
      return s ? [{ file: file.replace("/_next/static/", ""), raw: s.raw, gzip: s.gzip }] : [];
    });
    return { scripts: files.length, rawKB: kb(files.reduce((n, f) => n + f.raw, 0)), gzipKB: kb(files.reduce((n, f) => n + f.gzip, 0)), files };
  };
  const initialPaths = [...html.matchAll(/src="(\/_next\/static\/[^"?]+\.js)/g)].map((m) => m[1]);
  const initial = sizeOf(initialPaths);
  const idle = sizeOf([...sizes.keys()]);
  return {
    route,
    initial: { scripts: initial.scripts, rawKB: initial.rawKB, gzipKB: initial.gzipKB },
    idle: { scripts: idle.scripts, rawKB: idle.rawKB, gzipKB: idle.gzipKB },
    files: initial.files.sort((a, b) => b.raw - a.raw).map((f) => ({ file: f.file, rawKB: kb(f.raw), gzipKB: kb(f.gzip) })),
  };
}

test("JavaScript per page", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "the same files load at every width");
  test.setTimeout(180_000);
  const baseURL = info.project.use.baseURL;
  const storageState = "playwright/.auth/owner.json";
  const results: Measure[] = [];

  // A fresh browser per page: nothing cached from the page before
  async function cold(route: string, open: (page: Page) => Promise<Response | null>) {
    const context = await browser.newContext({ storageState, baseURL });
    const page = await context.newPage();
    results.push(await measure(page, route, () => open(page)));
    await context.close();
  }
  for (const route of ROUTES) await cold(route, (page) => page.goto(route));

  // One content item's workspace; its address comes from a throwaway browser
  const probe = await browser.newContext({ storageState, baseURL });
  const probePage = await probe.newPage();
  await probePage.goto("/content");
  const href = (await probePage.locator('a[href^="/content/c"]').first().getAttribute("href"))!;
  await probe.close();
  await cold("/content/[id]", (page) => page.goto(href));

  console.table(results.map((r) => ({ route: r.route, initialScripts: r.initial.scripts, initialRawKB: r.initial.rawKB, initialGzipKB: r.initial.gzipKB, idleRawKB: r.idle.rawKB, idleGzipKB: r.idle.gzipKB })));
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/js-per-route.json", JSON.stringify(results, null, 2));
  expect(results.every((r) => r.initial.scripts > 0)).toBe(true);

  const over = results.flatMap((r) => {
    const budget = BUDGET_KB[r.route];
    if (!budget) return [`${r.route}: no budget set`];
    return [
      ...(r.initial.rawKB > budget.initial ? [`${r.route}: ${r.initial.rawKB} KB of scripts in the page, budget ${budget.initial} KB`] : []),
      ...(r.idle.rawKB > budget.idle ? [`${r.route}: ${r.idle.rawKB} KB fetched once idle, budget ${budget.idle} KB`] : []),
    ];
  });
  expect(over, "pages over their JavaScript budget").toEqual([]);
});
