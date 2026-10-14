import { beforeEach, describe, expect, it, vi } from "vitest";

// The real Data Access Layer, with the request's cookie jar and Next's redirect stubbed.
const jar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.token ? { name, value: jar.token } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  unstable_rethrow: () => {},
}));

import { db } from "@/lib/db";
import { authenticate, ownerNeedsSetup, setupOwner } from "@/server/auth/owner";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, deleteSession, sessionUser } from "@/server/auth/session";

const dal = await vi.importActual<typeof import("@/server/auth/dal")>("@/server/auth/dal");
const PASSWORD = "correct horse battery";

beforeEach(async () => {
  jar.token = undefined;
  await db.session.deleteMany();
  await db.user.deleteMany();
});

const owner = () => setupOwner({ name: "Owner", email: "Owner@Example.com", password: PASSWORD, confirm: PASSWORD });

describe("passwords", () => {
  it("hashes with Argon2id and a fresh salt, and verifies", async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword("wrong password!", a)).toBe(false);
    expect(await verifyPassword(PASSWORD, "not-a-hash")).toBe(false);
  });
});

describe("owner setup and sign-in (SEC-01)", () => {
  it("is open until an owner has a password, then closed", async () => {
    await db.user.create({ data: { name: "Seeded", email: "owner@mediaflow.local" } });
    expect(await ownerNeedsSetup()).toBe(true);
    await owner();
    expect(await ownerNeedsSetup()).toBe(false);
    expect(await db.user.count()).toBe(1); // the seeded row was claimed, not duplicated
    await expect(owner()).rejects.toThrow(/already set up/);
  });

  it("refuses short or mismatched passwords", async () => {
    await expect(setupOwner({ name: "O", email: "o@example.com", password: "short", confirm: "short" })).rejects.toThrow(/at least 10/);
    await expect(setupOwner({ name: "O", email: "o@example.com", password: PASSWORD, confirm: "different!!" })).rejects.toThrow(/don't match/);
  });

  it("signs in with the right password, case-insensitively by email", async () => {
    await owner();
    expect((await authenticate("owner@EXAMPLE.com", PASSWORD)).name).toBe("Owner");
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    await owner();
    await expect(authenticate("nobody@example.com", PASSWORD)).rejects.toThrow("Email or password is incorrect.");
    await expect(authenticate("owner@example.com", "wrong password")).rejects.toThrow("Email or password is incorrect.");
  });

  it("locks the account for 15 minutes after 5 failures", async () => {
    await owner();
    for (let i = 0; i < 5; i++) await expect(authenticate("owner@example.com", "wrong password")).rejects.toThrow();
    await expect(authenticate("owner@example.com", PASSWORD)).rejects.toThrow(/Too many failed attempts/);
    const user = await db.user.findFirstOrThrow();
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });
});

describe("sessions", () => {
  it("stores only a hash of the token, and expires", async () => {
    const { id } = await owner();
    const { token } = await createSession(id, "test agent");
    expect(await db.session.count({ where: { id: token } })).toBe(0);
    expect((await sessionUser(token))?.id).toBe(id);

    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await sessionUser(token)).toBeNull();
  });

  it("is gone after sign-out", async () => {
    const { id } = await owner();
    const { token } = await createSession(id);
    await deleteSession(token);
    expect(await sessionUser(token)).toBeNull();
  });
});

describe("data access layer", () => {
  it("sends pages to /login and refuses actions without a session", async () => {
    await expect(dal.requireUser()).rejects.toThrow("REDIRECT /login");
    await expect(dal.requireActionUser()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect((await dal.unauthorizedResponse())?.status).toBe(401);
  });

  it("returns the owner for a valid session cookie", async () => {
    const { id } = await owner();
    jar.token = (await createSession(id)).token;
    expect((await dal.requireUser()).id).toBe(id);
    expect(await dal.unauthorizedResponse()).toBeNull();
  });

  it("accepts only same-site relative paths after sign-in", () => {
    expect(dal.safeNext("/content?stage=READY")).toBe("/content?stage=READY");
    expect(dal.safeNext("//evil.example")).toBe("/");
    expect(dal.safeNext("https://evil.example")).toBe("/");
    expect(dal.safeNext("/\\evil.example")).toBe("/");
  });
});
