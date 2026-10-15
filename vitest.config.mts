import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Two projects:
// - unit: pure functions, no database
// - integration: services and queries against a throwaway SQLite database
//   (one migrated copy per test file, see tests/setup)
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    setupFiles: ["tests/setup/next-cache.ts", "tests/setup/secrets-key.ts"],
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/setup/template-db.ts"],
          // Its own list replaces the root one, so the key setup is repeated here
          setupFiles: ["tests/setup/secrets-key.ts", "tests/setup/test-db.ts", "tests/setup/signed-in.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
