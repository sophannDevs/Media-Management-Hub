"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { browserStore, clearDraft, type Draft, forgetLoadedDraft, loadedDraft, writeDraft } from "@/lib/drafts";

const noop = () => () => {};

/**
 * The draft that was in this browser when the page opened, or null. It is null
 * on the server and during hydration, then the stored draft: so the page the
 * server sent and the first client render agree.
 */
export function useLoadedDraft<T>(key: string): Draft<T> | null {
  return useSyncExternalStore(
    noop,
    () => loadedDraft<T>(key),
    () => null,
  );
}

/**
 * Keeps `value` in this browser while it is `dirty`, a moment after each change
 * and again when the page is hidden or the editor goes away, and forgets it
 * once it isn't dirty (it was saved or put back). While `paused` it writes
 * nothing, so an older draft that is still on offer isn't overwritten.
 * `failed` is true when the browser refused to store it.
 */
export function useAutosaveDraft<T>(key: string, value: T, { dirty, paused = false, delay = 600 }: { dirty: boolean; paused?: boolean; delay?: number }) {
  const [saved, setSaved] = useState<{ value: T; at: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ value, dirty, paused });
  useEffect(() => {
    latest.current = { value, dirty, paused };
  });

  useEffect(() => {
    const store = browserStore();
    if (!store || paused) return;
    if (!dirty) {
      clearDraft(store, key);
      return;
    }
    const timer = setTimeout(() => {
      const ok = writeDraft(store, key, value);
      setFailed(!ok);
      if (ok) setSaved({ value, at: Date.now() });
    }, delay);
    return () => clearTimeout(timer);
  }, [key, value, dirty, paused, delay]);

  useEffect(() => {
    const flush = () => {
      const store = browserStore();
      const { value, dirty, paused } = latest.current;
      if (store && dirty && !paused) writeDraft(store, key, value);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      // The next editor for this key starts from what storage holds then
      forgetLoadedDraft(key);
    };
  }, [key]);

  return { savedAt: saved && Object.is(saved.value, value) ? saved.at : null, failed };
}

/** Asks the browser to confirm before the tab closes or reloads while `active`. */
export function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need a return value; the text itself is never shown
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
