import { AsyncLocalStorage } from "node:async_hooks";

// Who is acting, for services deep in the call stack (override authors, the
// activity log). Set by runAction for every Server Action; null for the worker.
const actor = new AsyncLocalStorage<{ userId: string }>();

export const runAsUser = <T>(userId: string, fn: () => Promise<T>) => actor.run({ userId }, fn);

export const currentUserId = () => actor.getStore()?.userId ?? null;
