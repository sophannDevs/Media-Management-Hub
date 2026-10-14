"use client";

import { LayoutGrid, Rows3, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Priority, Stage } from "@/lib/workflow/statuses";
import type { ContentListParams } from "@/server/queries/content";
import type { ContentFormOptions } from "@/server/queries/shared";

const ALL = "__all";
const QUICK = [
  ["ALL", "All"],
  ["PRODUCTION", "In production"],
  ["READY", "Ready to post"],
  ["SCHEDULED", "Scheduled"],
  ["PUBLISHED", "Published"],
  ["FAILED", "Failed"],
  ["IDEA", "Ideas"],
] as const;

export function buildHref(params: ContentListParams, patch: Partial<ContentListParams>) {
  const next = { ...params, ...patch };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v && v !== ALL && !(k === "stage" && v === "ALL")) sp.set(k, v);
  const s = sp.toString();
  return s ? `/content?${s}` : "/content";
}

export function ContentFilters({
  params,
  counts,
  stage,
  options,
}: {
  params: ContentListParams;
  counts: Record<string, number>;
  stage: string;
  options: ContentFormOptions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? "");
  const first = useRef(true);

  // Debounced search → URL
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => startTransition(() => router.replace(buildHref(params, { q: q.trim() || undefined }), { scroll: false })), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [q]);

  const go = (patch: Partial<ContentListParams>) => startTransition(() => router.replace(buildHref(params, patch), { scroll: false }));
  const active = Boolean(params.q || params.platform || params.category || params.priority || params.created || params.scheduled);
  const deepStage = !QUICK.some(([k]) => k === stage) ? stage : null;

  return (
    <div className={cn("space-y-4 transition-opacity", pending && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="thin-scroll -mx-1 max-w-full overflow-x-auto px-1">
          <div className="inline-flex gap-1 rounded-xl border border-[#ebe7c6] bg-secondary p-1">
            {QUICK.map(([key, label]) => (
              <Link
                key={key}
                href={buildHref(params, { stage: key })}
                scroll={false}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap",
                  stage === key ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                <span className="text-xs text-stone-400 tabular-nums">{counts[key] ?? 0}</span>
              </Link>
            ))}
            {deepStage && (
              <span className="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-medium whitespace-nowrap shadow-sm">
                {Stage.label(deepStage)}
                <Link href={buildHref(params, { stage: "ALL" })} aria-label="Clear stage filter" className="text-stone-400 hover:text-foreground">
                  <X className="size-3.5" />
                </Link>
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto inline-flex gap-1 rounded-xl border border-[#ebe7c6] bg-secondary p-1">
          {(
            [
              ["table", "Table", Rows3],
              ["cards", "Cards", LayoutGrid],
            ] as const
          ).map(([v, label, Icon]) => (
            <Link
              key={v}
              href={buildHref(params, { view: v })}
              scroll={false}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium",
                params.view
                  ? params.view === v
                    ? "bg-white text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                  : // No explicit choice: phones show cards, larger screens the table
                    v === "table"
                    ? "text-muted-foreground hover:text-foreground md:bg-white md:text-foreground md:shadow-sm"
                    : "bg-white text-foreground shadow-sm md:bg-transparent md:text-muted-foreground md:shadow-none",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-card">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-9" placeholder="Search title, tag or description" aria-label="Search content" />
        </div>
        <FilterSelect label="All platforms" value={params.platform} onChange={(v) => go({ platform: v })} items={options.platforms.filter((p) => p.enabled).map((p) => [p.id, p.name])} />
        <FilterSelect label="All categories" value={params.category} onChange={(v) => go({ category: v })} items={options.categories.map((c) => [c.id, c.name])} />
        <FilterSelect label="Any priority" value={params.priority} onChange={(v) => go({ priority: v })} items={Priority.options.map((p) => [p.value, p.label])} />
        <FilterSelect label="Created: any time" value={params.created} onChange={(v) => go({ created: v })} items={[["7", "Last 7 days"], ["30", "Last 30 days"]]} />
        <FilterSelect label="Scheduled: any" value={params.scheduled} onChange={(v) => go({ scheduled: v })} items={[["week", "This week"], ["next", "Next week"], ["none", "Not scheduled"]]} />
        {active && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); go({ q: undefined, platform: undefined, category: undefined, priority: undefined, created: undefined, scheduled: undefined }); }}>
            <X />Clear
          </Button>
        )}
      </div>
    </div>
  );
}

function FilterSelect({ label, value, items, onChange }: { label: string; value?: string; items: (readonly [string, string])[]; onChange: (v: string | undefined) => void }) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={cn("w-auto bg-white data-[size=default]:h-9", value && "border-olive-300 bg-olive-50")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {items.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
