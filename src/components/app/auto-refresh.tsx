"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the page from the server every few seconds while `active` and the
 * tab is visible, so a post being sent changes status on screen (PUB-06).
 * The server decides `active`; when nothing is in flight it stops.
 */
export function AutoRefresh({ active, seconds = 4 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [active, seconds, router]);
  return null;
}
