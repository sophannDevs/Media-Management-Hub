import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { logger } from "@/lib/log";
import { runAsUser } from "../auth/actor";
import { requireActionUser } from "../auth/dal";
import { type ActionResult, ServiceError } from "../errors";
import { actionPath, currentRequestId, runInRequest } from "../request-context";

/**
 * Wraps a Server Action body: checks the session (every action, not only the
 * proxy, as the Next.js docs require), validates input, runs as the signed-in
 * user, maps known errors to a user-facing result and re-renders the current
 * route on success. Every failure leaves one structured log line and carries
 * the request id (ARCH-04): a refusal logs at warn, an unexpected error at
 * error with the stack.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.infer<S>) => Promise<T>,
  message?: string | ((result: T) => string),
): Promise<ActionResult<T>> {
  const requestId = await currentRequestId();
  const path = await actionPath();
  const log = logger.child({ requestId, method: "ACTION", path });
  let userId: string;
  try {
    userId = (await requireActionUser()).id;
  } catch (e) {
    if (e instanceof ServiceError) {
      log.warn("action refused", { code: e.code, message: e.message });
      return { ok: false, error: e.message, code: e.code, requestId };
    }
    throw e;
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => i.message);
    log.warn("action refused", { userId, code: "VALIDATION", details });
    return { ok: false, error: "Please check the form.", details, code: "VALIDATION", requestId };
  }
  try {
    const data = await runInRequest({ requestId, method: "ACTION", path }, () => runAsUser(userId, () => fn(parsed.data)));
    refresh();
    return { ok: true, data, message: typeof message === "function" ? message(data) : message };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ServiceError) {
      log.warn("action refused", { userId, code: e.code, message: e.message });
      return { ok: false, error: e.message, details: e.details, code: e.code, info: e.info, requestId };
    }
    log.error("action failed", { userId, err: e });
    return { ok: false, error: "Something went wrong. Please try again.", code: "INTERNAL", requestId };
  }
}

export const id = z.string().min(1);
export const ids = z.array(z.string().min(1)).min(1, "Select at least one item.");
