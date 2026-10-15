import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { GET as callback } from "@/app/api/oauth/[platform]/callback/route";
import { GET as start } from "@/app/api/oauth/[platform]/start/route";
import { db } from "@/lib/db";
import type { PlatformAuth } from "@/lib/platforms/oauth";
import { PublishError } from "@/lib/platforms/types";
import { decryptSecret, isEncrypted } from "@/lib/secrets";
import { processSchedule, runMaintenance } from "@/server/services/publishing";
import { refreshExpiringTokens, storeAccountTokens } from "@/server/services/tokens";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";
import { fake } from "../helpers/fake-provider";

// PUB-07: connecting a real channel or Page, and keeping its sign-in alive.

const ctx = (platform: string) => ({ params: Promise.resolve({ platform }) }) as never;
const get = (path: string, headers: Record<string, string> = {}) => new Request(`http://app.test${path}`, { headers: { host: "app.test", ...headers } });
const cookieOf = (res: Response) => {
  const m = /mf_oauth=([^;]*)/.exec(res.headers.get("set-cookie") ?? "");
  return m ? decodeURIComponent(m[1]) : null;
};

let exchanges: { code: string; redirectUri: string; codeVerifier: string }[];
let refreshes: string[];
function scriptedAuth(over: Partial<PlatformAuth> = {}): PlatformAuth {
  return {
    scopes: ["publish", "read"],
    authorizationUrl: ({ redirectUri, state, codeChallenge }) => `https://platform.test/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}`,
    exchangeCode: async (input) => {
      exchanges.push(input);
      return { accessToken: `AT-${input.code}`, refreshToken: "RT-1", expiresAt: new Date(Date.now() + 3_600_000), scope: "publish read" };
    },
    refresh: async (refreshToken) => {
      refreshes.push(refreshToken);
      return { accessToken: "AT-fresh", refreshToken, expiresAt: new Date(Date.now() + 3_600_000) };
    },
    listAccounts: async () => [
      { externalId: "UC1", name: "Lab", handle: "@lab", followers: 10, avatarUrl: "https://i/a.png" },
      { externalId: "UC2", name: "Second channel" },
    ],
    ...over,
  };
}

beforeEach(async () => {
  await seedPlatforms();
  fake.reset();
  fake.mock = false;
  fake.auth = scriptedAuth();
  exchanges = [];
  refreshes = [];
  await db.publishingSchedule.deleteMany();
  await db.socialAccount.deleteMany();
});

describe("connecting through the platform (PUB-07)", () => {
  it("sends the owner to the platform with a fresh state and PKCE challenge, and keeps them in a sealed cookie", async () => {
    const res = await start(get("/api/oauth/youtube/start"), ctx("youtube"));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://platform.test");
    expect(to.searchParams.get("redirect_uri")).toBe("http://app.test/api/oauth/youtube/callback");
    expect(to.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(to.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const cookie = cookieOf(res)!;
    expect(isEncrypted(cookie)).toBe(true);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=lax/i);
    expect(res.headers.get("set-cookie")).toMatch(/Path=\/api\/oauth/);
  });

  it("refuses a callback whose state doesn't match, or that wasn't started here", async () => {
    const started = await start(get("/api/oauth/youtube/start"), ctx("youtube"));
    const cookie = cookieOf(started)!;

    const wrong = await callback(get("/api/oauth/youtube/callback?code=abc&state=forged", { cookie: `mf_oauth=${encodeURIComponent(cookie)}` }), ctx("youtube"));
    expect(wrong.status).toBe(302);
    expect(decodeURIComponent(wrong.headers.get("location")!)).toMatch(/\/accounts\?error=.*state did not match/);

    const none = await callback(get("/api/oauth/youtube/callback?code=abc&state=whatever"), ctx("youtube"));
    expect(decodeURIComponent(none.headers.get("location")!)).toMatch(/not started here/);

    const other = await callback(get("/api/oauth/facebook/callback?code=abc&state=whatever", { cookie: `mf_oauth=${encodeURIComponent(cookie)}` }), ctx("facebook"));
    expect(decodeURIComponent(other.headers.get("location")!)).toMatch(/not started here/);

    expect(exchanges).toHaveLength(0);
    expect(await db.socialAccount.count()).toBe(0);
  });

  it("connects every account the sign-in can publish to, with sealed tokens, and updates them on a reconnect", async () => {
    const started = await start(get("/api/oauth/youtube/start"), ctx("youtube"));
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const cookie = cookieOf(started)!;

    const res = await callback(get(`/api/oauth/youtube/callback?code=code-1&state=${state}`, { cookie: `mf_oauth=${encodeURIComponent(cookie)}` }), ctx("youtube"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://app.test/accounts?connected=2&platform=youtube");
    expect(res.headers.get("set-cookie")).toMatch(/mf_oauth=;.*Max-Age=0/i);
    expect(exchanges).toEqual([{ code: "code-1", redirectUri: "http://app.test/api/oauth/youtube/callback", codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/) }]);

    const rows = await db.socialAccount.findMany({ where: { platformId: "youtube" }, orderBy: { externalId: "asc" } });
    expect(rows.map((r) => [r.externalId, r.name, r.handle, r.followers, r.status, r.isDefault])).toEqual([
      ["UC1", "Lab", "@lab", 10, "CONNECTED", true],
      ["UC2", "Second channel", "", 0, "CONNECTED", false],
    ]);
    for (const r of rows) {
      expect(isEncrypted(r.accessToken)).toBe(true);
      expect(decryptSecret(r.accessToken!)).toBe("AT-code-1");
      expect(decryptSecret(r.refreshToken!)).toBe("RT-1");
      expect(r.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    }

    // Reconnecting (an expired sign-in) updates the same rows
    await db.socialAccount.update({ where: { id: rows[0].id }, data: { status: "TOKEN_EXPIRED", lastError: "expired" } });
    const again = await start(get("/api/oauth/youtube/start"), ctx("youtube"));
    const state2 = new URL(again.headers.get("location")!).searchParams.get("state")!;
    await callback(get(`/api/oauth/youtube/callback?code=code-2&state=${state2}`, { cookie: `mf_oauth=${encodeURIComponent(cookieOf(again)!)}` }), ctx("youtube"));
    const after = await db.socialAccount.findMany({ where: { platformId: "youtube" }, orderBy: { externalId: "asc" } });
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ id: rows[0].id, status: "CONNECTED", lastError: null, isDefault: true });
    expect(decryptSecret(after[0].accessToken!)).toBe("AT-code-2");
  });

  it("relays the platform's refusal, and refuses to start a platform that isn't configured", async () => {
    const started = await start(get("/api/oauth/youtube/start"), ctx("youtube"));
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const denied = await callback(get(`/api/oauth/youtube/callback?error=access_denied&error_description=The+user+said+no&state=${state}`, { cookie: `mf_oauth=${encodeURIComponent(cookieOf(started)!)}` }), ctx("youtube"));
    expect(decodeURIComponent(denied.headers.get("location")!)).toMatch(/did not grant access: access_denied — The user said no/);

    fake.mock = true;
    const res = await start(get("/api/oauth/youtube/start"), ctx("youtube"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringMatching(/not configured/) });
  });
});

describe("keeping the sign-in alive (PUB-07)", () => {
  it("renews a token about to expire before the upload, and gives the platform the new one", async () => {
    const account = await createAccount("youtube", { externalId: "UC1" });
    await storeAccountTokens(account.id, { accessToken: "AT-old", refreshToken: "RT-1", tokenExpiresAt: new Date(Date.now() + 60_000) });
    const content = await createReadyContent();
    const schedule = await insertSchedule(content.id, account.id, { activeKey: `${content.id}:${account.id}` });

    expect(await processSchedule(schedule.id)).toBe("published");
    expect(refreshes).toEqual(["RT-1"]);
    expect(fake.calls[0].account.accessToken).toBe("AT-fresh");
    const row = await db.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(decryptSecret(row.accessToken!)).toBe("AT-fresh");
    expect(row.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it("leaves a token with time left alone", async () => {
    const account = await createAccount("youtube", { externalId: "UC1" });
    await storeAccountTokens(account.id, { accessToken: "AT-ok", refreshToken: "RT-1", tokenExpiresAt: new Date(Date.now() + 3_600_000) });
    const content = await createReadyContent();
    const schedule = await insertSchedule(content.id, account.id, { activeKey: `${content.id}:${account.id}` });
    expect(await processSchedule(schedule.id)).toBe("published");
    expect(refreshes).toEqual([]);
    expect(fake.calls[0].account.accessToken).toBe("AT-ok");
  });

  it("the maintenance pass renews what expires within a day and blocks accounts the platform no longer accepts", async () => {
    const soon = await createAccount("youtube", { name: "Expiring soon", externalId: "UC1" });
    await storeAccountTokens(soon.id, { accessToken: "AT-soon", refreshToken: "RT-soon", tokenExpiresAt: new Date(Date.now() + 3_600_000) });
    const later = await createAccount("youtube", { name: "Fine for days", externalId: "UC2" });
    await storeAccountTokens(later.id, { accessToken: "AT-later", refreshToken: "RT-later", tokenExpiresAt: new Date(Date.now() + 3 * 86_400_000) });
    const dead = await createAccount("youtube", { name: "Revoked", externalId: "UC3" });
    await storeAccountTokens(dead.id, { accessToken: "AT-dead", refreshToken: "RT-dead", tokenExpiresAt: new Date(Date.now() + 60_000) });
    fake.auth = scriptedAuth({
      refresh: async (rt) => {
        if (rt === "RT-dead") throw new PublishError("Google no longer accepts the saved sign-in (invalid_grant). Reconnect the channel.", "AUTH", false);
        refreshes.push(rt);
        return { accessToken: `fresh-${rt}`, refreshToken: rt, expiresAt: new Date(Date.now() + 3_600_000) };
      },
    });

    const direct = await refreshExpiringTokens();
    expect(direct).toEqual({ refreshed: 1, failed: [{ id: dead.id, name: "Revoked", message: expect.stringMatching(/invalid_grant/) }] });
    expect(refreshes).toEqual(["RT-soon"]);
    expect(decryptSecret((await db.socialAccount.findUniqueOrThrow({ where: { id: soon.id } })).accessToken!)).toBe("fresh-RT-soon");
    expect(decryptSecret((await db.socialAccount.findUniqueOrThrow({ where: { id: later.id } })).accessToken!)).toBe("AT-later");

    await runMaintenance();
    const revoked = await db.socialAccount.findUniqueOrThrow({ where: { id: dead.id } });
    expect(revoked.status).toBe("TOKEN_EXPIRED");
    expect(revoked.lastError).toMatch(/invalid_grant/);
  });
});
