// Unsaved writing kept in the browser (UX-03), so a closed tab, a reload or a
// crash doesn't lose it. Plain functions over a Storage-like object: the
// React side is in src/hooks/use-draft.ts.

/** A piece of writing and when it was last kept. */
export interface Draft<T> {
  at: number;
  value: T;
}

const PREFIX = "mediaflow:draft:";
/** A draft this old is forgotten rather than offered. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The stored text as a draft, or null when it is missing, damaged or too old. */
export function parseDraft<T>(raw: string | null, now = Date.now()): Draft<T> | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<Draft<T>> | null;
    if (d && typeof d === "object" && typeof d.at === "number" && "value" in d && now - d.at < DRAFT_MAX_AGE_MS) return { at: d.at, value: d.value as T };
  } catch {
    // damaged: treated as no draft
  }
  return null;
}

export function readDraft<T>(store: DraftStore, key: string, now = Date.now()): Draft<T> | null {
  try {
    return parseDraft<T>(store.getItem(PREFIX + key), now);
  } catch {
    return null;
  }
}

/** False when the browser refused (storage full or disabled), so the caller can warn instead of pretending. */
export function writeDraft<T>(store: DraftStore, key: string, value: T, now = Date.now()): boolean {
  try {
    store.setItem(PREFIX + key, JSON.stringify({ at: now, value } satisfies Draft<T>));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(store: DraftStore, key: string) {
  try {
    store.removeItem(PREFIX + key);
  } catch {
    // nothing to clear
  }
}

/** The browser's localStorage, or null on the server or when access is blocked. */
export function browserStore(): DraftStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// What each key held when it was first looked at in this page session. The
// editor keeps writing to the same key while someone types, so the draft on offer
// ("you have unsaved text from earlier") has to be remembered separately.
const loaded = new Map<string, Draft<unknown> | null>();

export function loadedDraft<T>(key: string): Draft<T> | null {
  if (!loaded.has(key)) {
    const store = browserStore();
    loaded.set(key, store ? readDraft(store, key) : null);
  }
  return loaded.get(key) as Draft<T> | null;
}

/** Forget the remembered draft, so the next look reads storage again. */
export function forgetLoadedDraft(key: string) {
  loaded.delete(key);
}
