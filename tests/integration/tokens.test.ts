import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/registry", async () => (await import("../helpers/fake-provider")).fakeRegistry);

import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, generateKeySpec, isEncrypted, TOKEN_KEYS_ENV } from "@/lib/secrets";
import { NotificationType } from "@/lib/workflow/statuses";
import { processSchedule } from "@/server/services/publishing";
import { accountKeyIds, rotateAllAccountTokens, storeAccountTokens } from "@/server/services/tokens";
import { connectAccount, disconnectAccount, reconnectAccount } from "@/server/services/workspace";
import { createAccount, createReadyContent, insertSchedule, seedPlatforms } from "../helpers/factories";
import { fake } from "../helpers/fake-provider";

// SEC-04: OAuth tokens are ciphertext in the database and plain only on their
// way to a platform.

const testKey = process.env[TOKEN_KEYS_ENV]!;
const row = (id: string) => db.socialAccount.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await seedPlatforms();
  fake.reset();
  await db.publishingSchedule.deleteMany();
  // Each test starts with no accounts, so token counts are exact
  await db.socialAccount.deleteMany();
});
afterEach(() => {
  process.env[TOKEN_KEYS_ENV] = testKey;
});

describe("token vault (SEC-04)", () => {
  it("stores connect and reconnect tokens as ciphertext, never the token", async () => {
    const a = await connectAccount({ platformId: "youtube", name: "Vault channel" });
    const stored = await row(a.id);
    expect(isEncrypted(stored.accessToken)).toBe(true);
    expect(stored.accessToken).not.toContain("mock");
    expect(decryptSecret(stored.accessToken!)).toMatch(/^mock_/);

    await reconnectAccount(a.id);
    const again = await row(a.id);
    expect(isEncrypted(again.accessToken)).toBe(true);
    expect(again.accessToken).not.toBe(stored.accessToken);

    await disconnectAccount(a.id);
    const gone = await row(a.id);
    expect(gone.accessToken).toBeNull();
    expect(gone.refreshToken).toBeNull();
    expect(gone.status).toBe("DISCONNECTED");
  });

  it("refuses to connect an account when no key is configured, and says what to do", async () => {
    delete process.env[TOKEN_KEYS_ENV];
    await expect(connectAccount({ platformId: "youtube", name: "No key" })).rejects.toThrow(/TOKEN_ENCRYPTION_KEYS is not set.*secrets:key/);
    expect(await db.socialAccount.count({ where: { name: "No key" } })).toBe(0);
  });

  it("gives the platform the plain token, and only there", async () => {
    const account = await createAccount("youtube");
    await storeAccountTokens(account.id, { accessToken: "ya29.plain-for-the-platform", refreshToken: "1//refresh" });
    const stored = await row(account.id);
    expect(stored.accessToken).not.toContain("ya29");
    expect(stored.refreshToken).not.toContain("1//");

    const content = await createReadyContent();
    const schedule = await insertSchedule(content.id, account.id, { activeKey: `${content.id}:${account.id}` });
    expect(await processSchedule(schedule.id)).toBe("published");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].account.accessToken).toBe("ya29.plain-for-the-platform");
  });

  it("treats a token it can't read as missing credentials: no upload, account marked, person told", async () => {
    const account = await createAccount("youtube", { name: "Lost key channel" });
    // Encrypted under a key this ring doesn't have (the key was rotated away too early, or the value was damaged)
    process.env[TOKEN_KEYS_ENV] = generateKeySpec("gone");
    const foreign = encryptSecret("ya29.unreadable");
    process.env[TOKEN_KEYS_ENV] = testKey;
    await db.socialAccount.update({ where: { id: account.id }, data: { accessToken: foreign } });

    const content = await createReadyContent();
    const schedule = await insertSchedule(content.id, account.id, { activeKey: `${content.id}:${account.id}` });
    expect(await processSchedule(schedule.id)).toBe("failed");
    expect(fake.calls).toHaveLength(0);
    const s = await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id }, include: { jobs: true } });
    expect(s.status).toBe("FAILED");
    expect(s.lastErrorCode).toBe("AUTH");
    expect(s.lastError).toMatch(/can't be read.*Reconnect the account/);
    expect(s.jobs.map((j) => j.status)).toEqual(["FAILED"]);
    expect((await row(account.id)).status).toBe("TOKEN_EXPIRED");
    expect(await db.notification.count({ where: { type: NotificationType.PUBLISH_FAILED, message: { contains: "Lost key channel" } } })).toBeGreaterThan(0);
  });

  it("rotates every stored token to the new key and leaves unreadable ones alone", async () => {
    const a = await createAccount("youtube", { name: "Rotate A" });
    const b = await createAccount("facebook", { name: "Rotate B" });
    await storeAccountTokens(a.id, { accessToken: "token-a", refreshToken: "refresh-a" });
    await storeAccountTokens(b.id, { accessToken: "token-b" });
    const c = await createAccount("youtube", { name: "Unreadable C" });
    process.env[TOKEN_KEYS_ENV] = generateKeySpec("lost");
    await db.socialAccount.update({ where: { id: c.id }, data: { accessToken: encryptSecret("token-c") } });

    const newKey = generateKeySpec("next");
    process.env[TOKEN_KEYS_ENV] = `${newKey},${testKey}`;
    const result = await rotateAllAccountTokens();
    expect(result).toEqual({ rotated: 2, unchanged: 0, unreadable: 1, total: 3 });
    const ids = await accountKeyIds();
    expect(ids.find((x) => x.id === a.id)?.keyId).toBe("next");
    expect(ids.find((x) => x.id === b.id)?.keyId).toBe("next");
    expect(ids.find((x) => x.id === c.id)?.keyId).toBe("lost");

    // With the old key dropped, the rotated tokens still open
    process.env[TOKEN_KEYS_ENV] = newKey;
    expect(decryptSecret((await row(a.id)).refreshToken!)).toBe("refresh-a");
    expect(decryptSecret((await row(b.id)).accessToken!)).toBe("token-b");
  });
});
