// Compares row counts per table between the old SQLite file and PostgreSQL (after db:import-sqlite).
//   npx tsx scripts/compare-sqlite.ts [path/to/dev.db]
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile();
} catch {}

async function main() {
  const file = process.argv[2] ?? "prisma/dev.db";
  const sqlite = new DatabaseSync(file, { readOnly: true });
  const db = new PrismaClient();
  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'").all() as { name: string }[])
    .map((r) => r.name)
    .concat("_ContentToTag");

  let mismatches = 0;
  for (const t of tables) {
    const a = Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n);
    const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${t}"`);
    const b = Number(n);
    if (a !== b) mismatches++;
    console.log(`${t.padEnd(20)} sqlite ${String(a).padStart(5)}  postgres ${String(b).padStart(5)}${a === b ? "" : "  <-- differs"}`);
  }
  sqlite.close();
  await db.$disconnect();
  console.log(mismatches ? `${mismatches} table(s) differ.` : "All tables match.");
  return mismatches;
}

main().then((m) => process.exit(m ? 1 : 0));
