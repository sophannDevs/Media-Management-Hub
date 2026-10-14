import { timingSafeEqual } from "node:crypto";

/**
 * Checks `Authorization: Bearer <secret>` in constant time.
 * "unset" means the secret isn't configured: callers must fail closed.
 */
export function checkBearer(req: Request, secret: string | undefined): "ok" | "denied" | "unset" {
  const expected = secret?.trim();
  if (!expected) return "unset";
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${expected}`);
  return got.length === want.length && timingSafeEqual(got, want) ? "ok" : "denied";
}
