import { vi } from "vitest";

// Outside a Next.js server, "use cache" is a plain string and cacheTag /
// cacheLife throw (they need the Cache Components runtime). Tests run the
// functions uncached: the cache APIs become no-ops and io() resolves at once.
vi.mock("next/cache", () => ({
  io: async () => {},
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  revalidatePath: () => {},
  refresh: () => {},
}));
