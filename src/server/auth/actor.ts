import { AsyncLocalStorage } from "node:async_hooks";

// Who is acting, for services deep in the call stack (override authors, the
// activity log). runAction sets the signed-in user for every Server Action;
// the worker's pass runs as WORKER; anything else (setup, scripts, tests) is
// SYSTEM unless a Route Handler's session says otherwise (see resolveActor).

export type ActorSource = "USER" | "WORKER" | "SYSTEM";
export interface Actor {
  userId: string | null;
  source: ActorSource;
}

const actor = new AsyncLocalStorage<Actor>();

export const runAsUser = <T>(userId: string, fn: () => Promise<T>) => actor.run({ userId, source: "USER" }, fn);
export const runAsWorker = <T>(fn: () => Promise<T>) => actor.run({ userId: null, source: "WORKER" }, fn);
export const runAsSystem = <T>(fn: () => Promise<T>) => actor.run({ userId: null, source: "SYSTEM" }, fn);

/** The actor set for this call, or null when none was. */
export const currentActor = (): Actor | null => actor.getStore() ?? null;
export const currentUserId = () => actor.getStore()?.userId ?? null;
