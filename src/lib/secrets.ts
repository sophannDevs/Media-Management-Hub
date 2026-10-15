import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Secrets at rest (SEC-04): OAuth tokens are stored as ciphertext, never as
// the token itself. AES-256-GCM with a random nonce per value, so the same
// token stored twice gives two different ciphertexts, and any change to the
// stored value fails to decrypt instead of yielding garbage.
//
// Keys come from TOKEN_ENCRYPTION_KEYS: "id:key[,id:key…]", each key 32
// random bytes in base64 (or base64url). The FIRST key encrypts; every key
// can decrypt. To rotate, put a new key first and keep the old one until
// every stored value has been re-encrypted (rotateSecret), then drop it.
// Each ciphertext names the key it was made with:
//
//   enc:v1:<key id>:<nonce>:<ciphertext+tag>     (base64url parts)
//
// A value without that shape is refused rather than treated as a token, so a
// plain-text token can never slip through unnoticed.

export const TOKEN_KEYS_ENV = "TOKEN_ENCRYPTION_KEYS";

const PREFIX = "enc";
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
/** Authenticated but unencrypted context: a ciphertext made for another purpose or version fails here. */
const AAD = Buffer.from("mediaflow:secret:v1");
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

export type SecretsErrorCode =
  /** TOKEN_ENCRYPTION_KEYS is not set (or not usable) */
  | "NO_KEY"
  /** The value names a key that is not in the ring (dropped too early?) */
  | "UNKNOWN_KEY"
  /** Not a ciphertext this module made */
  | "MALFORMED"
  /** The value, nonce or tag was changed, or the key is wrong */
  | "TAMPERED";

export class SecretsError extends Error {
  constructor(
    message: string,
    public code: SecretsErrorCode,
  ) {
    super(message);
    this.name = "SecretsError";
  }
}

interface KeyRing {
  current: { id: string; key: Buffer };
  byId: Map<string, Buffer>;
}

function decodeKey(id: string, text: string): Buffer {
  const key = Buffer.from(text, text.includes("+") || text.includes("/") || text.includes("=") ? "base64" : "base64url");
  if (key.length !== KEY_BYTES) throw new SecretsError(`${TOKEN_KEYS_ENV}: key "${id}" must be ${KEY_BYTES} random bytes in base64 (got ${key.length})`, "NO_KEY");
  return key;
}

/** Parses "id:key[,id:key…]". Null when the variable is empty; throws when it is set but unusable. */
export function parseKeyRing(spec: string | undefined | null): KeyRing | null {
  if (!spec?.trim()) return null;
  const byId = new Map<string, Buffer>();
  let current: KeyRing["current"] | null = null;
  for (const entry of spec.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    const id = sep > 0 ? trimmed.slice(0, sep) : "";
    if (!KEY_ID.test(id)) throw new SecretsError(`${TOKEN_KEYS_ENV}: each entry is "id:key", where id is 1-32 letters, digits, - or _`, "NO_KEY");
    if (byId.has(id)) throw new SecretsError(`${TOKEN_KEYS_ENV}: key id "${id}" appears twice`, "NO_KEY");
    const key = decodeKey(id, trimmed.slice(sep + 1).trim());
    byId.set(id, key);
    current ??= { id, key };
  }
  return current ? { current, byId } : null;
}

// Parsed once per distinct value of the variable (tests change it)
let cached: { spec: string | undefined; ring: KeyRing | null } | null = null;
function ring(): KeyRing | null {
  const spec = process.env[TOKEN_KEYS_ENV];
  if (!cached || cached.spec !== spec) cached = { spec, ring: parseKeyRing(spec) };
  return cached.ring;
}

function requireRing(): KeyRing {
  const r = ring();
  if (!r) {
    throw new SecretsError(`${TOKEN_KEYS_ENV} is not set: tokens can't be stored. Generate a key with \`npm run secrets:key\` and put it in .env.`, "NO_KEY");
  }
  return r;
}

/** True when a key is configured, so tokens can be stored and read. */
export function secretsConfigured(): boolean {
  try {
    return ring() !== null;
  } catch {
    return false;
  }
}

/** A new "id:key" entry for TOKEN_ENCRYPTION_KEYS. */
export function generateKeySpec(id = "k1"): string {
  if (!KEY_ID.test(id)) throw new SecretsError("A key id is 1-32 letters, digits, - or _", "NO_KEY");
  return `${id}:${randomBytes(KEY_BYTES).toString("base64url")}`;
}

/** Whether a stored value is a ciphertext this module can try to read. */
export function isEncrypted(value: string | null | undefined): value is string {
  if (!value) return false;
  const parts = value.split(":");
  return parts.length === 5 && parts[0] === PREFIX && parts[1] === VERSION && KEY_ID.test(parts[2]) && B64URL.test(parts[3]) && B64URL.test(parts[4]);
}

/** The id of the key a stored value was encrypted with, or null. */
export function keyIdOf(value: string | null | undefined): string | null {
  return isEncrypted(value) ? value.split(":")[2] : null;
}

/** Encrypts with the current key. Throws NO_KEY when none is configured. */
export function encryptSecret(plain: string): string {
  const { current } = requireRing();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, current.key, nonce);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [PREFIX, VERSION, current.id, nonce.toString("base64url"), body.toString("base64url")].join(":");
}

/** Decrypts a value made by encryptSecret, with whichever key in the ring it names. */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) throw new SecretsError("Not an encrypted secret.", "MALFORMED");
  const [, , id, nonceText, bodyText] = value.split(":");
  const key = requireRing().byId.get(id);
  if (!key) throw new SecretsError(`The secret was encrypted with key "${id}", which is not in ${TOKEN_KEYS_ENV}.`, "UNKNOWN_KEY");
  const nonce = Buffer.from(nonceText, "base64url");
  const body = Buffer.from(bodyText, "base64url");
  if (nonce.length !== NONCE_BYTES || body.length < 16) throw new SecretsError("Not an encrypted secret.", "MALFORMED");
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(body.subarray(body.length - 16));
  try {
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretsError("The stored secret can't be read: it was changed, or the key is wrong.", "TAMPERED");
  }
}

/**
 * The same secret under the current key. Returns the value unchanged when it
 * already uses the current key, so a rotation pass can run over every row.
 */
export function rotateSecret(value: string): string {
  if (keyIdOf(value) === requireRing().current.id) return value;
  return encryptSecret(decryptSecret(value));
}
