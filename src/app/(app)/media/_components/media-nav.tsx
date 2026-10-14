"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ComponentProps, createContext, type ReactNode, useContext, useEffect, useOptimistic, useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MediaFilters } from "@/server/queries/media";

/** Shareable URL for a set of filters (defaults are left out). */
export function mediaHref(f: MediaFilters) {
  const sp = new URLSearchParams();
  if (f.type) sp.set("type", f.type);
  if (f.q) sp.set("q", f.q);
  if (f.content) sp.set("content", f.content);
  if (f.usage) sp.set("usage", f.usage);
  if (f.days) sp.set("days", String(f.days));
  if (f.page > 1) sp.set("page", String(f.page));
  const s = sp.toString();
  return s ? `/media?${s}` : "/media";
}

export const CLEARED: Partial<MediaFilters> = { type: null, q: "", content: null, usage: null, days: null };

type Patch = Partial<MediaFilters>;
interface NavOptions {
  replace?: boolean;
  scrollTop?: boolean;
}

const Ctx = createContext<{
  /** Current filters, including a change that is still loading */
  filters: MediaFilters;
  pending: boolean;
  hrefFor: (patch: Patch) => string;
  navigate: (patch: Patch, opts?: NavOptions) => void;
} | null>(null);

export function useMediaNav() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMediaNav must be used inside <MediaNavProvider>");
  return ctx;
}

/**
 * Filters live in the URL. Changes navigate inside a transition so the page
 * can show which filter is pending while the server renders the new results.
 */
export function MediaNavProvider({ filters, children }: { filters: MediaFilters; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(filters);
  // Latest filters for callbacks that fire later (debounced search), so they never undo a newer change
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = optimistic;
  }, [optimistic]);

  // Any filter change goes back to page 1 unless the patch says otherwise
  const merge = (base: MediaFilters, patch: Patch): MediaFilters => ({ ...base, page: 1, ...patch });

  function navigate(patch: Patch, opts: NavOptions = {}) {
    const next = merge(latest.current, patch);
    latest.current = next;
    const href = mediaHref(next);
    startTransition(() => {
      setOptimistic(next);
      if (opts.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
    if (opts.scrollTop) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <Ctx.Provider value={{ filters: optimistic, pending, hrefFor: (patch) => mediaHref(merge(optimistic, patch)), navigate }}>
      {children}
    </Ctx.Provider>
  );
}

/** A real link (shareable, opens in a new tab) that filters in place. */
export function MediaNavLink({ patch, scrollTop, ...props }: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { patch: Patch; scrollTop?: boolean }) {
  const { hrefFor, navigate } = useMediaNav();
  return (
    <Link
      {...props}
      href={hrefFor(patch)}
      scroll={false}
      onNavigate={(e) => {
        e.preventDefault();
        navigate(patch, { scrollTop });
      }}
    />
  );
}

/** Dims its children while new results load. */
export function MediaPending({ children, className }: { children: ReactNode; className?: string }) {
  const { pending } = useMediaNav();
  return (
    <div aria-busy={pending} className={cn("transition-opacity duration-200", pending && "opacity-55", className)}>
      {children}
    </div>
  );
}

export function ClearFiltersButton({ label = "Clear filters", ...props }: Omit<ComponentProps<typeof Button>, "onClick"> & { label?: string }) {
  const { navigate } = useMediaNav();
  return (
    <Button {...props} onClick={() => navigate(CLEARED)}>
      <X />
      {label}
    </Button>
  );
}
