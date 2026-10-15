import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateKeySpec, isEncrypted, keyIdOf, parseKeyRing, rotateSecret, SecretsError, secretsConfigured, TOKEN_KEYS_ENV } from "@/lib/secrets";

// SEC-04: tokens at rest are ciphertext under a key that can be rotated.

const KEY_A = generateKeySpec("a");
const KEY_B = generateKeySpec("b");
const setKeys = (spec: string | undefined) => {
  if (spec === undefined) delete process.env[TOKEN_KEYS_ENV];
  else process.env[TOKEN_KEYS_ENV] = spec;
};
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof SecretsError) return e.code;
    throw e;
  }
  return "no error";
};

afterEach(() => setKeys(undefined));

describe("secrets (SEC-04)", () => {
  it("encrypts and decrypts, with a different ciphertext each time", () => {
    setKeys(KEY_A);
    const token = "ya29.a0AfH6SMB-example-token-ÄÖÜ-😀";
    const one = encryptSecret(token);
    const two = encryptSecret(token);
    expect(one).not.toBe(two);
    expect(one).not.toContain("ya29");
    expect(isEncrypted(one)).toBe(true);
    expect(keyIdOf(one)).toBe("a");
    expect(decryptSecret(one)).toBe(token);
    expect(decryptSecret(two)).toBe(token);
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("refuses anything that is not its own ciphertext", () => {
    setKeys(KEY_A);
    for (const v of ["mock_abc123", "", "enc:v1:a:short", "enc:v2:a:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "ya29.token"]) {
      expect(isEncrypted(v)).toBe(false);
      expect(codeOf(() => decryptSecret(v))).toBe("MALFORMED");
    }
    expect(isEncrypted(null)).toBe(false);
    expect(keyIdOf("mock_abc")).toBeNull();
  });

  it("notices a changed value, nonce or key", () => {
    setKeys(KEY_A);
    const value = encryptSecret("secret-token");
    const parts = value.split(":");
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    const tamperedBody = [...parts.slice(0, 4), flip(parts[4], 3)].join(":");
    const tamperedNonce = [...parts.slice(0, 3), flip(parts[3], 2), parts[4]].join(":");
    expect(codeOf(() => decryptSecret(tamperedBody))).toBe("TAMPERED");
    expect(codeOf(() => decryptSecret(tamperedNonce))).toBe("TAMPERED");
    // Same key id, different key material: also refused
    setKeys(generateKeySpec("a"));
    expect(codeOf(() => decryptSecret(value))).toBe("TAMPERED");
  });

  it("needs a key, and says how to get one", () => {
    setKeys(undefined);
    expect(secretsConfigured()).toBe(false);
    expect(codeOf(() => encryptSecret("x"))).toBe("NO_KEY");
    expect(() => encryptSecret("x")).toThrow(/TOKEN_ENCRYPTION_KEYS is not set.*secrets:key/);
    setKeys(KEY_A);
    expect(secretsConfigured()).toBe(true);
  });

  it("rejects keys of the wrong size, bad ids and duplicates", () => {
    expect(() => parseKeyRing("a:" + Buffer.alloc(16).toString("base64url"))).toThrow(/32 random bytes/);
    expect(() => parseKeyRing("bad id:" + Buffer.alloc(32).toString("base64url"))).toThrow(/1-32 letters/);
    expect(() => parseKeyRing(`${KEY_A},${KEY_A}`)).toThrow(/appears twice/);
    expect(parseKeyRing("")).toBeNull();
    expect(parseKeyRing("   ")).toBeNull();
    // Standard base64 with padding is accepted too
    const std = `s:${Buffer.alloc(32, 7).toString("base64")}`;
    expect(parseKeyRing(std)?.current.id).toBe("s");
  });

  it("rotates: the first key encrypts, older keys still decrypt until they are dropped", () => {
    setKeys(KEY_A);
    const old = encryptSecret("rotate-me");

    setKeys(`${KEY_B},${KEY_A}`);
    expect(decryptSecret(old)).toBe("rotate-me");
    expect(keyIdOf(encryptSecret("new"))).toBe("b");
    const rotated = rotateSecret(old);
    expect(keyIdOf(rotated)).toBe("b");
    expect(decryptSecret(rotated)).toBe("rotate-me");
    expect(rotateSecret(rotated)).toBe(rotated);

    setKeys(KEY_B);
    expect(decryptSecret(rotated)).toBe("rotate-me");
    expect(codeOf(() => decryptSecret(old))).toBe("UNKNOWN_KEY");
  });
});
