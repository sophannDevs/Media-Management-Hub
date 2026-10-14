import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Argon2id (Node's built-in implementation) at OWASP's recommended minimum:
// 19 MiB of memory, 2 passes, 1 lane. Stored as a PHC string, so the
// parameters travel with the hash and can be raised later.
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 };
const hash = promisify(argon2);

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const tag = await hash("argon2id", { message: password, nonce: salt, ...PARAMS });
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(tag)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored);
  if (!m) return false;
  const expected = Buffer.from(m[5], "base64");
  const actual = await hash("argon2id", {
    message: password,
    nonce: Buffer.from(m[4], "base64"),
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
