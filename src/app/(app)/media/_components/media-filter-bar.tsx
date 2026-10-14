"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { ContentPicker } from "@/components/app/content-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { MediaContentOption, MediaFilters } from "@/server/queries/media";
import { CLEARED, useMediaNav } from "./media-nav";

const ANY = "__any";

export function MediaFilterBar({ filteredContent }: { filteredContent: MediaContentOption | null }) {
  const { filters, navigate, pending } = useMediaNav();
  const search = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Follow URL changes made elsewhere (Clear, back/forward) — but never overwrite what the user is typing
  useEffect(() => {
    const el = search.current;
    if (el && document.activeElement !== el && el.value !== filters.q) el.value = filters.q;
  }, [filters.q]);
  useEffect(() => {
    const t = timer;
    return () => clearTimeout(t.current);
  }, []);

  function onSearch(value: string) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => navigate({ q: value.trim() }, { replace: true }), 300);
  }

  function clearAll() {
    clearTimeout(timer.current);
    if (search.current) search.current.value = "";
    navigate(CLEARED);
  }

  const active = Boolean(filters.type || filters.q || filters.content || filters.usage || filters.days);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-card">
      <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={search}
          type="search"
          defaultValue={filters.q}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              clearTimeout(timer.current);
              navigate({ q: e.currentTarget.value.trim() }, { replace: true });
            }
          }}
          className="h-9 bg-white pl-9"
          placeholder="Search file name"
          aria-label="Search file name"
        />
      </div>
      <ContentPicker
        label="Content"
        placeholder="All content"
        readiness={false}
        className="w-full sm:w-[230px]"
        inputClassName={filters.content ? "border-olive-300 bg-olive-50" : undefined}
        value={filters.content === "none" ? { id: "none", title: "Unassigned files" } : filteredContent}
        fixed={[
          { id: "", title: "All content" },
          { id: "none", title: "Unassigned files" },
        ]}
        onChange={(c) => navigate({ content: c.id || null })}
      />
      <FilterSelect
        label="Usage"
        value={filters.usage}
        placeholder="Any usage"
        onChange={(usage) => navigate({ usage: usage as MediaFilters["usage"] })}
        className="min-w-0 flex-1 sm:flex-none"
        items={[
          ["used", "In use"],
          ["unused", "Unused"],
        ]}
      />
      <FilterSelect
        label="Created"
        value={filters.days ? String(filters.days) : null}
        placeholder="Any date"
        onChange={(days) => navigate({ days: days ? (Number(days) as MediaFilters["days"]) : null })}
        className="min-w-0 flex-1 sm:flex-none"
        items={[
          ["7", "Last 7 days"],
          ["30", "Last 30 days"],
        ]}
      />
      {active && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X />
          Clear filters
        </Button>
      )}
      <LoaderCircle aria-hidden className={cn("size-4 animate-spin text-muted-foreground transition-opacity", pending ? "opacity-100" : "opacity-0")} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  placeholder,
  items,
  special = [],
  onChange,
  className,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  items: (readonly [string, string])[];
  special?: (readonly [string, string])[];
  onChange: (value: string | null) => void;
  className?: string;
}) {
  return (
    <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? null : v)}>
      <SelectTrigger aria-label={label} className={cn("bg-white data-[size=default]:h-9", value && "border-olive-300 bg-olive-50", className)}>
        {/* Labelled on the server too, so the bar doesn't reflow after hydration (as PERF-09) */}
        <SelectValue>{[...special, ...items].find(([v]) => v === value)?.[1] ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-[min(20rem,var(--radix-select-content-available-height))] max-w-[min(24rem,calc(100vw-2rem))]">
        <SelectItem value={ANY}>{placeholder}</SelectItem>
        {special.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
        {special.length > 0 && items.length > 0 && <SelectSeparator />}
        {items.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
