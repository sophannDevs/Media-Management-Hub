"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CALENDAR_VIEWS, type CalendarParams, calendarHref, VIEW_LABELS } from "./calendar-shared";

/** Platform filter + Month / Week / Day switch. All state lives in the URL. */
export function CalendarControls({ params, platforms }: { params: CalendarParams; platforms: { id: string; name: string }[] }) {
  const router = useRouter();
  const platform = platforms.find((p) => p.id === params.platform);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={params.platform ?? "all"}
        onValueChange={(v) => router.push(calendarHref({ ...params, platform: v === "all" ? undefined : v }), { scroll: false })}
      >
        <SelectTrigger className="h-9 min-w-[150px] bg-white data-[size=default]:h-9" aria-label="Filter by platform">
          {/* Explicit label so the value is part of the server-rendered HTML */}
          <SelectValue>
            {platform ? (
              <>
                <PlatformIcon platform={platform.id} size={14} />
                {platform.name}
              </>
            ) : (
              "All platforms"
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All platforms</SelectItem>
          {platforms.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <PlatformIcon platform={p.id} size={14} />
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <nav aria-label="Calendar view" className="inline-flex gap-1 rounded-xl border border-[#ebe7c6] bg-secondary p-[3px]">
        {CALENDAR_VIEWS.map((v) => {
          const active = params.view === v;
          return (
            <Link
              key={v}
              href={calendarHref({ ...params, view: v })}
              aria-current={active ? "page" : undefined}
              scroll={false}
              className={cn(
                "flex h-7 items-center rounded-lg px-3 text-[13px] font-medium transition-colors",
                active ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {VIEW_LABELS[v]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
