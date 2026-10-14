"use client";

import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaType, type MediaTypeCode } from "@/lib/workflow/statuses";
import { MediaNavLink, useMediaNav } from "./media-nav";
import { MEDIA_TYPE_ICONS, mediaTypePlural } from "./media-types";

/** Type summary that doubles as the type filter. Counts respect the other active filters. */
export function TypeCards({ counts, all }: { counts: Record<MediaTypeCode, number>; all: number }) {
  const { filters } = useMediaNav();
  const cards = [
    { code: null, label: "All media", Icon: Layers, n: all },
    ...MediaType.codes.map((code) => ({ code, label: mediaTypePlural(code), Icon: MEDIA_TYPE_ICONS[code], n: counts[code] ?? 0 })),
  ];
  return (
    <nav aria-label="Media types" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      {cards.map(({ code, label, Icon, n }) => {
        const on = filters.type === code;
        return (
          <MediaNavLink
            key={code ?? "ALL"}
            patch={{ type: code }}
            aria-current={on ? "true" : undefined}
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-3 shadow-card transition-colors",
              on ? "border-primary ring-2 ring-primary/15" : "hover:border-olive-300",
              code === null && "col-span-2 sm:col-span-1",
            )}
          >
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", on ? "bg-primary text-primary-foreground" : "bg-olive-50 text-primary")}>
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {n} file{n === 1 ? "" : "s"}
              </span>
            </span>
          </MediaNavLink>
        );
      })}
    </nav>
  );
}
