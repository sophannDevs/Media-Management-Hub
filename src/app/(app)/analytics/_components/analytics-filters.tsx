"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, type TransitionStartFunction, useContext, useOptimistic, useTransition } from "react";
import { PLATFORM_NAMES, PlatformIcon } from "@/components/app/platform-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Range / platform live in the URL. Changing them re-renders the page on the
// server; while that runs the current charts stay on screen, dimmed.

const TransitionContext = createContext<{ pending: boolean; start: TransitionStartFunction } | null>(null);

export function AnalyticsTransition({ children }: { children: ReactNode }) {
  const [pending, start] = useTransition();
  return <TransitionContext.Provider value={{ pending, start }}>{children}</TransitionContext.Provider>;
}

/** Holds the previous render at reduced opacity while new filters load. */
export function PendingFrame({ children, className }: { children: ReactNode; className?: string }) {
  const pending = useContext(TransitionContext)?.pending ?? false;
  return (
    <div aria-busy={pending} className={cn("transition-opacity duration-200", pending && "opacity-55", className)}>
      {children}
    </div>
  );
}

const ALL = "__all";

interface FilterState {
  range: number;
  platform: string | null;
}

export function AnalyticsFilters({
  range,
  platform,
  ranges,
  platforms,
  defaultRange,
}: FilterState & { ranges: readonly number[]; platforms: readonly string[]; defaultRange: number }) {
  const router = useRouter();
  const context = useContext(TransitionContext);
  const [, startLocal] = useTransition();
  const start = context?.start ?? startLocal;
  const [view, setView] = useOptimistic<FilterState>({ range, platform });

  function go(next: FilterState) {
    const sp = new URLSearchParams();
    if (next.range !== defaultRange) sp.set("range", String(next.range));
    if (next.platform) sp.set("platform", next.platform);
    const qs = sp.toString();
    start(() => {
      setView(next);
      router.replace(qs ? `/analytics?${qs}` : "/analytics", { scroll: false });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Date range" className="inline-flex gap-1 rounded-xl border border-[#ebe7c6] bg-secondary p-1">
        {ranges.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={view.range === r}
            onClick={() => view.range !== r && go({ ...view, range: r })}
            className={cn(
              "h-8 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
              view.range === r ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r} days
          </button>
        ))}
      </div>
      <Select value={view.platform ?? ALL} onValueChange={(v) => go({ ...view, platform: v === ALL ? null : v })}>
        <SelectTrigger aria-label="Platform" className={cn("w-[164px] rounded-xl bg-white data-[size=default]:h-[42px]", view.platform && "border-olive-300")}>
          {/* Explicit children so the server-rendered trigger already shows the selection */}
          <SelectValue>
            {view.platform ? (
              <>
                <PlatformIcon platform={view.platform} size={14} />
                {PLATFORM_NAMES[view.platform] ?? view.platform}
              </>
            ) : (
              "All platforms"
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All platforms</SelectItem>
          {platforms.map((p) => (
            <SelectItem key={p} value={p}>
              <PlatformIcon platform={p} size={14} />
              {PLATFORM_NAMES[p] ?? p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
