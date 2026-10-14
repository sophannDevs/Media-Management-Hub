import { AsyncLocalStorage } from "node:async_hooks";
import { headers } from "next/headers";
import { acceptRequestId, newRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";

// What is known about the request being served, for log lines and error
// responses (ARCH-04). Set by route() for Route Handlers and by runAction for
// Server Actions; code running outside a request (the worker, tests) has none.

export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
}

const store = new AsyncLocalStorage<RequestContext>();

export const runInRequest = <T>(ctx: RequestContext, fn: () => T): T => store.run(ctx, fn);
export const requestContext = () => store.getStore();

/**
 * The id of the request being served: the context's, else the x-request-id
 * header the proxy added, else a fresh one (tests, the worker).
 */
export async function currentRequestId() {
  const ctx = store.getStore();
  if (ctx) return ctx.requestId;
  try {
    return acceptRequestId((await headers()).get(REQUEST_ID_HEADER)) ?? newRequestId();
  } catch {
    return newRequestId();
  }
}

/** The page a Server Action was invoked from (its Referer's path), for log lines. */
export async function actionPath() {
  try {
    const referer = (await headers()).get("referer");
    return referer ? new URL(referer).pathname : undefined;
  } catch {
    return undefined;
  }
}
