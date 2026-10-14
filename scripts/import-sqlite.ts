// One-time copy of the old SQLite database (prisma/dev.db) into PostgreSQL.
//   npm run db:import-sqlite [-- path/to/dev.db] [-- --force]
// Reads with Node's built-in SQLite driver and writes through Prisma, table by
// table in foreign-key order. Refuses to run when PostgreSQL already has
// content, unless --force is given (it then only adds rows that don't exist).
import { DatabaseSync } from "node:sqlite";
import { Prisma, PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile();
} catch {}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? "prisma/dev.db";
const force = args.includes("--force");

// Parents before children. Content's video/thumbnail links are set after MediaAsset exists.
const ORDER = [
  "User", "WorkspaceSettings", "Platform", "Category", "Series", "Campaign", "Tag", "Content", "ContentPlatform",
  "Script", "ScriptVersion", "ImagePrompt", "MediaAsset", "SocialAccount", "PublishingSchedule", "PublishingJob",
  "ActivityLog", "Notification", "AnalyticsSnapshot", "AiPrompt",
] as const;

const delegate = (db: PrismaClient, model: string) =>
  (db as unknown as Record<string, { createMany(args: { data: unknown[]; skipDuplicates: boolean }): Promise<{ count: number }> }>)[model[0].toLowerCase() + model.slice(1)];

function convert(model: string, row: Record<string, unknown>) {
  const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === model)!.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!(f.name in row)) continue;
    const v = row[f.name];
    if (v === null || v === undefined) {
      out[f.name] = f.type === "Json" ? Prisma.DbNull : null;
    } else if (f.type === "DateTime") out[f.name] = new Date(typeof v === "number" || typeof v === "bigint" ? Number(v) : String(v));
    else if (f.type === "Boolean") out[f.name] = Number(v) === 1 || v === true || v === "true";
    else if (f.type === "Json") out[f.name] = typeof v === "string" ? JSON.parse(v) : v;
    else if (f.type === "Int") out[f.name] = Number(v);
    else if (f.type === "Float") out[f.name] = Number(v);
    else out[f.name] = v;
  }
  return out;
}

async function main() {
  const sqlite = new DatabaseSync(file, { readOnly: true });
  const db = new PrismaClient();
  try {
    if ((await db.content.count()) > 0 && !force) {
      throw new Error("PostgreSQL already has content. Run with --force to add only the rows that are missing.");
    }
    const tables = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => String((r as { name: string }).name)));
    const videoLinks: { id: string; videoAssetId: unknown; thumbnailAssetId: unknown }[] = [];

    for (const model of ORDER) {
      if (!tables.has(model)) continue;
      const rows = sqlite.prepare(`SELECT * FROM "${model}"`).all() as Record<string, unknown>[];
      const data = rows.map((r) => {
        const out = convert(model, r);
        if (model === "Content") {
          videoLinks.push({ id: String(r.id), videoAssetId: r.videoAssetId, thumbnailAssetId: r.thumbnailAssetId });
          out.videoAssetId = null;
          out.thumbnailAssetId = null;
        }
        return out;
      });
      for (let i = 0; i < data.length; i += 500) {
        await delegate(db, model).createMany({ data: data.slice(i, i + 500), skipDuplicates: true });
      }
      console.log(`${model.padEnd(20)} ${rows.length}`);
    }

    for (const c of videoLinks) {
      if (!c.videoAssetId && !c.thumbnailAssetId) continue;
      await db.content.update({
        where: { id: c.id },
        data: { videoAssetId: (c.videoAssetId as string | null) ?? null, thumbnailAssetId: (c.thumbnailAssetId as string | null) ?? null },
      });
    }
    if (tables.has("_ContentToTag")) {
      const links = sqlite.prepare(`SELECT "A", "B" FROM "_ContentToTag"`).all() as { A: string; B: string }[];
      for (const l of links) {
        await db.$executeRaw`INSERT INTO "_ContentToTag" ("A", "B") VALUES (${l.A}, ${l.B}) ON CONFLICT DO NOTHING`;
      }
      console.log(`${"_ContentToTag".padEnd(20)} ${links.length}`);
    }
    console.log(`Imported ${file} into PostgreSQL.`);
  } finally {
    sqlite.close();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
