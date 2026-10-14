import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/log";
import { acceptRequestId, newRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import { isCrossSite } from "@/lib/security/origin";
import type { ErrorCode } from "./errors";
import { requestContext, runInRequest } from "./request-context";

// One failure shape for Route Handlers and Server Actions (ARCH-04):
//   { ok: false, error: "message", code?: "NOT_FOUND", details?: ["…"], requestId: "…" }
// `error` is always a string safe to show; `requestId` matches the log line and
// the x-request-id response header.

/**
 * A failure response. Logs one line with the request id, so every failed
 * request leaves exactly one record: a refusal (4xx, or a deliberately
 * unavailable endpoint) at warn, an INTERNAL error (a bug) at error.
 */
export function apiError(status: number, code: ErrorCode, message: string, opts: { details?: string[]; headers?: HeadersInit; log?: boolean } = {}) {
  const ctx = requestContext();
  const requestId = ctx?.requestId ?? newRequestId();
  if (opts.log !== false) {
    const fields = { requestId, status, code, message, method: ctx?.method, path: ctx?.path };
    if (code === "INTERNAL") logger.error("request failed", fields);
    else logger.warn("request refused", fields);
  }
  const headers = new Headers(opts.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return Response.json({ ok: false, error: message, code, ...(opts.details ? { details: opts.details } : {}), requestId }, { status, headers });
}

/** A 403 for a request a browser sent from another site (SEC-03), or null to continue. */
export function rejectCrossSite(req: Request): Response | null {
  return isCrossSite(req) ? apiError(403, "FORBIDDEN", "Cross-site request refused.") : null;
}

/**
 * Wraps a Route Handler: gives the request an id (the caller's if it sent an
 * acceptable x-request-id, else a new one), makes it available to apiError and
 * the loggers, answers an uncaught error with a 500 in the common shape, and
 * puts the id on every response.
 */
export function route<R extends Request, A extends unknown[]>(handler: (req: R, ...rest: A) => Response | Promise<Response>) {
  return async (req: R, ...rest: A): Promise<Response> => {
    const requestId = acceptRequestId(req.headers.get(REQUEST_ID_HEADER)) ?? newRequestId();
    const url = new URL(req.url);
    return runInRequest({ requestId, method: req.method, path: url.pathname }, async () => {
      let res: Response;
      try {
        res = await handler(req, ...rest);
      } catch (e) {
        unstable_rethrow(e);
        logger.error("request failed", { requestId, method: req.method, path: url.pathname, status: 500, err: e });
        return apiError(500, "INTERNAL", "Something went wrong. Please try again.", { log: false });
      }
      try {
        res.headers.set(REQUEST_ID_HEADER, requestId);
      } catch {
        // A response with immutable headers: send an equal one that can carry the id
        const headers = new Headers(res.headers);
        headers.set(REQUEST_ID_HEADER, requestId);
        res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
      return res;
    });
  };
}
