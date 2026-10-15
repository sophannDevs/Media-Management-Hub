import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { adminExec, withDatabase } from "../helpers/pg";
import { createAccount, createReadyContent, seedPlatforms } from "../helpers/factories";

// DB-04: a backup can be restored, and the drill proves it. Skipped where the
// PostgreSQL command-line tools aren't installed.
const tools = spawnSync("pg_dump", ["--version"], { encoding: "utf8" }).error === undefined || existsSync("C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe");

const work = mkdtempSync(path.join(tmpdir(), "mediaflow-backup-"));
const backups = path.join(work, "backups");
const storage = path.join(work, "storage");
const restored = `mediaflow_restored_${Date.now().toString(36)}`;
const server = () => process.env.DATABASE_URL!;

/** Runs a project script against this test's database, with its own backup and storage folders. */
const script = (file: string, args: string[] = [], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [file, ...args], { encoding: "utf8", env: { ...process.env, STORAGE_DIR: storage, ...env }, timeout: 120_000 });

const counts = async (client: PrismaClient) => ({
  content: await client.content.count(),
  media: await client.mediaAsset.count(),
  accounts: await client.socialAccount.count(),
});

afterAll(async () => {
  await adminExec(server(), `DROP DATABASE IF EXISTS "${restored}" WITH (FORCE)`).catch(() => {});
  rmSync(work, { recursive: true, force: true });
});

describe.skipIf(!tools)("backup and restore (DB-04)", () => {
  let before: Awaited<ReturnType<typeof counts>>;

  beforeAll(async () => {
    await seedPlatforms();
    await createAccount("youtube");
    for (let i = 0; i < 3; i++) await createReadyContent({ title: `Yesterday's video ${i}` });
    // A stored file the database refers to, and a real file for every key the fixtures made up
    mkdirSync(path.join(storage, "media/2026/10"), { recursive: true });
    writeFileSync(path.join(storage, "media/2026/10/precious.bin"), "the only copy");
    await db.mediaAsset.create({ data: { type: "OTHER", fileName: "precious.bin", storageKey: "media/2026/10/precious.bin", size: 13 } });
    for (const m of await db.mediaAsset.findMany({ where: { storageKey: { not: null } }, select: { storageKey: true } })) {
      const file = path.join(storage, m.storageKey!);
      mkdirSync(path.dirname(file), { recursive: true });
      if (!existsSync(file)) writeFileSync(file, "x");
    }
    before = await counts(db);
  }, 60_000);

  it("backs up the database and the files, with a manifest that matches", async () => {
    const r = script("scripts/db-backup.mjs", ["--dir", backups]);
    expect(r.status, r.stderr).toBe(0);
    const [name] = readdirSync(backups).filter((n) => /^\d{8}-\d{6}$/.test(n));
    const manifest = JSON.parse(readFileSync(path.join(backups, name, "manifest.json"), "utf8"));
    expect(manifest.tables).toMatchObject({ Content: before.content, MediaAsset: before.media, SocialAccount: before.accounts });
    expect(manifest.migrations.length).toBeGreaterThan(5);
    expect(manifest.files).toMatchObject({ included: true, total: before.media, copied: before.media });
    expect(readFileSync(path.join(backups, "files/media/2026/10/precious.bin"), "utf8")).toBe("the only copy");
    // The password never appears in the output or the manifest
    expect(r.stdout + JSON.stringify(manifest)).not.toContain(new URL(server()).password);
  }, 120_000);

  it("brings back yesterday's data after it was destroyed, and the files with it", async () => {
    // Something goes wrong: content deleted, the stored file lost
    await db.content.deleteMany();
    await db.mediaAsset.deleteMany();
    rmSync(path.join(storage, "media/2026/10/precious.bin"));
    expect((await counts(db)).content).toBe(0);

    const r = script("scripts/db-restore.mjs", ["latest", "--dir", backups, "--into", restored, "--files"]);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toContain("Everything matches the backup");

    const back = new PrismaClient({ datasources: { db: { url: withDatabase(server(), restored) } } });
    try {
      expect(await counts(back)).toEqual(before);
      expect((await back.content.findMany({ select: { title: true }, orderBy: { title: "asc" } })).map((c) => c.title)).toEqual(["Yesterday's video 0", "Yesterday's video 1", "Yesterday's video 2"]);
    } finally {
      await back.$disconnect();
    }
    expect(readFileSync(path.join(storage, "media/2026/10/precious.bin"), "utf8")).toBe("the only copy");
    // The live database was not touched by a restore into another one
    expect((await counts(db)).content).toBe(0);
  }, 120_000);

  it("never restores over an existing database unless told to, and only locally", async () => {
    const r = script("scripts/db-restore.mjs", ["latest", "--dir", backups, "--into", restored]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`The database "${restored}" already exists`);
    const remote = script("scripts/db-restore.mjs", ["latest", "--dir", backups, "--replace"], { DATABASE_URL: "postgresql://app:pw@db.prod.example.com:5432/app" });
    expect(remote.status).toBe(1);
    expect(remote.stderr).toContain("--replace refused");
  });

  it("runs the drill: restores into a scratch database, checks it, and removes it", async () => {
    const r = script("scripts/db-restore.mjs", ["--verify", "--dir", backups]);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toContain("The drill passed");
    const left = await db.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname LIKE '%_drill_%'`;
    expect(left).toEqual([]);
  }, 120_000);

  it("fails the drill when a file the database refers to is in neither place", async () => {
    rmSync(path.join(storage, "media/2026/10/precious.bin"));
    rmSync(path.join(backups, "files/media/2026/10/precious.bin"));
    // The live database was emptied above: put the row back so the restored data refers to the file
    await db.mediaAsset.create({ data: { type: "OTHER", fileName: "precious.bin", storageKey: "media/2026/10/precious.bin", size: 13 } });
    expect(script("scripts/db-backup.mjs", ["--dir", backups]).status).toBe(0); // a full backup, which claims to cover the files
    const r = script("scripts/db-restore.mjs", ["--verify", "--dir", backups]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/uploaded file.* in neither the storage folder nor the backup/);
  }, 120_000);

  it("keeps only the newest dumps but never deletes files", async () => {
    for (let i = 0; i < 3; i++) expect(script("scripts/db-backup.mjs", ["--dir", backups, "--db-only", "--keep", "2"]).status).toBe(0);
    expect(readdirSync(backups).filter((n) => /^\d{8}-\d{6}$/.test(n))).toHaveLength(2);
  }, 120_000);
});

describe("destructive commands (DB-04)", () => {
  const remote = { DATABASE_URL: "postgresql://app:pw@db.prod.example.com:5432/app" };

  it("db:reset refuses a database that isn't on this machine, before connecting to anything", () => {
    const r = script("scripts/db-reset.mjs", [], remote);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("db:reset refused: DATABASE_URL points at db.prod.example.com");
    expect(r.stdout).not.toContain("Backing up");
  });

  it("the seed refuses it too", () => {
    const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"], { encoding: "utf8", env: { ...process.env, ...remote }, timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Seeding refused: DATABASE_URL points at db.prod.example.com");
  });
});
