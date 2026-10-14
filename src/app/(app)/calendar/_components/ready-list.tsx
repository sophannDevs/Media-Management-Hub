"use client";

import { GripVertical } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ContentThumb, thumbIconFor } from "@/components/app/content-thumb";
import { PlatformStack } from "@/components/app/platform-icon";
import { useScheduleDialog } from "@/components/app/schedule-dialog";
import { cn } from "@/lib/utils";
import type { ReadyItem } from "@/server/queries/calendar";
import { DRAG_CONTENT, encodeContentDrag } from "./calendar-shared";

/** Ready-to-post content: drag onto a calendar day, or click to open the Schedule dialog. */
export function ReadyList({ items, platform }: { items: ReadyItem[]; platform: string | null }) {
  const { openSchedule } = useScheduleDialog();
  const [dragging, setDragging] = useState<string | null>(null);

  if (!items.length) {
    return <p className="p-4 text-sm text-muted-foreground">Nothing waiting — all ready content is scheduled.</p>;
  }

  // Preselect the filtered platform only when the video targets it (or has no targets yet)
  const platformFor = (c: ReadyItem) => (platform && (!c.platforms.length || c.platforms.includes(platform)) ? platform : undefined);
  const open = (c: ReadyItem) => openSchedule({ contentId: c.id, platformId: platformFor(c) });
  const shown = items.slice(0, 12);

  return (
    <div className="space-y-2 p-3">
      {shown.map((c) => (
        <div
          key={c.id}
          role="button"
          tabIndex={0}
          draggable
          title="Drag onto a day, or click to schedule"
          onDragStart={(e) => {
            e.dataTransfer.clearData();
            e.dataTransfer.setData(DRAG_CONTENT, encodeContentDrag({ id: c.id, platformId: platformFor(c) }));
            e.dataTransfer.effectAllowed = "copy";
            setDragging(c.id);
          }}
          onDragEnd={() => setDragging(null)}
          onClick={() => open(c)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open(c);
            }
          }}
          className={cn(
            "flex cursor-grab items-center gap-2.5 rounded-xl border border-[#ece9d6] bg-white p-2 transition-colors outline-none hover:border-olive-300 focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing",
            dragging === c.id && "opacity-50",
          )}
        >
          <GripVertical className="size-4 shrink-0 text-stone-300" aria-hidden />
          <ContentThumb src={c.thumbUrl} seed={c.id} icon={thumbIconFor(c)} className="h-9 w-14" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-xs leading-snug font-medium">{c.title}</p>
            <div className="mt-1 flex items-center gap-2">
              <PlatformStack platforms={c.platforms} size={16} />
              {c.target && <span className="truncate text-[11px] text-muted-foreground">Target {c.target}</span>}
            </div>
          </div>
        </div>
      ))}
      {items.length > shown.length && (
        <Link href="/content?stage=READY" className="block px-1 pt-1 text-xs font-medium text-primary hover:underline">
          View all {items.length} ready videos
        </Link>
      )}
    </div>
  );
}
