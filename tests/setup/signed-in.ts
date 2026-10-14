import { vi } from "vitest";

// Integration tests call page loaders and services directly, outside a
// request: they run as a signed-in owner. tests/integration/auth.test.ts
// covers the real Data Access Layer.
vi.mock("@/server/auth/dal", () => {
  const owner = { id: "test-owner", name: "Test Owner", email: "owner@test.local", role: "OWNER" };
  return {
    getCurrentUser: async () => owner,
    requireUser: async () => owner,
    requireActionUser: async () => owner,
    unauthorizedResponse: async () => null,
    sessionCookieOptions: async (expires: Date) => ({ httpOnly: true, sameSite: "lax", secure: false, path: "/", expires }),
    safeNext: (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/"),
  };
});
