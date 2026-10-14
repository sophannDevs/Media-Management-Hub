import path from "node:path";
import { defineConfig } from "prisma/config";

// With a config file the Prisma CLI no longer reads .env itself, so load it
// here. There may be no .env (CI passes the variables directly).
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
