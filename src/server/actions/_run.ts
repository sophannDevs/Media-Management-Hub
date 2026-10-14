import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionResult, ServiceError } from "../errors";

/**
 * Wraps a Server Action body: validates input, maps known errors to a
 * user-facing result and re-renders the current route on success.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.infer<S>) => Promise<T>,
  message?: string | ((result: T) => string),
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please check the form.", details: parsed.error.issues.map((i) => i.message) };
  }
  try {
    const data = await fn(parsed.data);
    refresh();
    return { ok: true, data, message: typeof message === "function" ? message(data) : message };
  } catch (e) {
    if (e instanceof ServiceError) return { ok: false, error: e.message, details: e.details, code: e.code, info: e.info };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export const id = z.string().min(1);
export const ids = z.array(z.string().min(1)).min(1, "Select at least one item.");
