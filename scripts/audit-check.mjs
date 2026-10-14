// Fails when a high or critical advisory affects a production dependency,
// unless it is listed below with a reason. Dev-only tooling is not checked
// (`npm audit` reports those separately; none of them handle requests).
import { spawnSync } from "node:child_process";

const ALLOWED = {
  "GHSA-ggr8-5vv4-36mx":
    "deepmerge-ts via prisma -> @prisma/config. Used only to merge the static Prisma CLI config, never request data. Remove when Prisma is upgraded (DB-03).",
};

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const out = spawnSync(npm, ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32" });
let report;
try {
  report = JSON.parse(out.stdout);
} catch {
  console.error("Could not read `npm audit` output:\n", out.stderr || out.stdout);
  process.exit(2);
}

const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== "object") continue;
    const id = via.url?.split("/").pop() ?? String(via.source);
    const entry = advisories.get(id) ?? { ...via, id, packages: new Set() };
    entry.packages.add(vuln.name);
    advisories.set(id, entry);
  }
}

let blocking = 0;
for (const a of advisories.values()) {
  const serious = a.severity === "high" || a.severity === "critical";
  const allowed = ALLOWED[a.id];
  const verdict = !serious ? "ok (low/moderate)" : allowed ? "allowed" : "BLOCKING";
  if (serious && !allowed) blocking++;
  console.log(`${verdict.padEnd(18)} ${a.severity.padEnd(8)} ${a.id}  ${a.title}  [${[...a.packages].join(", ")}]`);
  if (allowed && serious) console.log(`${"".padEnd(28)}reason: ${allowed}`);
}
for (const id of Object.keys(ALLOWED)) {
  if (!advisories.has(id)) console.log(`note: ${id} is allowlisted but no longer reported. Remove it from scripts/audit-check.mjs.`);
}

console.log(blocking ? `\n${blocking} blocking advisory(ies) in production dependencies.` : "\nNo blocking advisories in production dependencies.");
process.exit(blocking ? 1 : 0);
