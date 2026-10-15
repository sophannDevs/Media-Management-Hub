"use client";

import { CalendarClock, Ellipsis, SquareArrowOutUpRight } from "lucide-react";
import Link from "next/link";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { ContentThumb, thumbIconFor } from "@/components/app/content-thumb";
import { PLATFORM_NAMES, PlatformIcon } from "@/components/app/platform-icon";
import { StatusBadge } from "@/components/app/status-badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ScheduleStatus, scheduleLabel } from "@/lib/workflow/statuses";
import type { CalendarEvent } from "@/server/queries/calendar";

/** Status is shown as the chip's left border colour. */
const STATUS_BORDER: Record<string, string> = {
  WAITING: "border-l-violet-500",
  PROCESSING: "border-l-amber-500",
  PUBLISHED: "border-l-olive-600",
  FAILED: "border-l-rose-600",
  RETRY_SCHEDULED: "border-l-orange-500",
};

export const contentHref = (ev: CalendarEvent) => `/content/${ev.content.id}?tab=publishing`;
const chipTitle = (ev: CalendarEvent) =>
  `${ev.content.title}\n${scheduleLabel(ev.status, ev.simulated)} · ${PLATFORM_NAMES[ev.platformId] ?? ev.platformId} · ${ev.accountName}\n${ev.timeLabel}${ev.movable ? "\nDrag, or press Space and use the arrow keys, to reschedule" : ""}`;

/** Id of the visually hidden instructions every movable chip points at. */
export const MOVE_HELP_ID = "calendar-move-help";

export interface ChipProps {
  ev: CalendarEvent;
  /** Being dragged with the mouse */
  dimmed: boolean;
  /** Picked up with the keyboard */
  grabbed: boolean;
  onDragStart: (e: DragEvent<HTMLAnchorElement>) => void;
  onDragEnd: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLAnchorElement>) => void;
  onBlur: () => void;
  onReschedule: () => void;
}

function chipClass(ev: CalendarEvent, p: Pick<ChipProps, "dimmed" | "grabbed">, base: string) {
  return cn(
    "rounded-lg border border-[#ece9d6] border-l-[3px] transition-[background-color,opacity] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
    base,
    STATUS_BORDER[ev.status] ?? "border-l-stone-400",
    ev.movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
    p.dimmed && "opacity-40",
    p.grabbed && "ring-2 ring-primary ring-offset-1",
  );
}

/** What every chip link carries: the drag, keyboard-move and focus hooks. */
function linkProps(p: ChipProps) {
  const { ev } = p;
  return {
    href: contentHref(ev),
    draggable: ev.movable,
    onDragStart: p.onDragStart,
    onDragEnd: p.onDragEnd,
    onKeyDown: p.onKeyDown,
    onBlur: p.onBlur,
    title: chipTitle(ev),
    "data-chip": ev.id,
    "aria-describedby": ev.movable ? MOVE_HELP_ID : undefined,
  } as const;
}

/**
 * The chip and its actions menu side by side (a menu button can't live inside
 * the link). The menu is the touch and screen-reader way to reschedule: it
 * shows on hover and focus, and always on touch screens.
 */
function Frame({ ev, onReschedule, children }: { ev: CalendarEvent; onReschedule: () => void; children: ReactNode }) {
  return (
    <div className="group/chip relative">
      {children}
      {ev.movable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${ev.content.title}`}
              className="pointer-events-none absolute top-1 right-1 flex size-6 items-center justify-center rounded-md bg-white/95 text-stone-600 opacity-0 shadow-sm ring-1 ring-[#ece9d6] transition-opacity group-focus-within/chip:pointer-events-auto group-focus-within/chip:opacity-100 group-hover/chip:pointer-events-auto group-hover/chip:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100"
            >
              <Ellipsis className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onReschedule}>
              <CalendarClock />
              Reschedule…
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={contentHref(ev)}>
                <SquareArrowOutUpRight />
                Open post
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function MonthChip(p: ChipProps) {
  const { ev } = p;
  return (
    <Frame ev={ev} onReschedule={p.onReschedule}>
      <Link {...linkProps(p)} className={chipClass(ev, p, "flex items-center gap-1.5 rounded-md bg-[#f7f5e6] px-1.5 py-1 text-xs leading-tight hover:bg-olive-50")}>
        <PlatformIcon platform={ev.platformId} size={12} />
        <span className="shrink-0 text-muted-foreground tabular-nums">{ev.timeLabel.replace(":00", "")}</span>
        <span className="truncate font-medium text-stone-800">{ev.content.title}</span>
      </Link>
    </Frame>
  );
}

export function WeekChip(p: ChipProps) {
  const { ev } = p;
  return (
    <Frame ev={ev} onReschedule={p.onReschedule}>
      <Link {...linkProps(p)} className={chipClass(ev, p, "block bg-white p-1.5 text-xs hover:bg-[#fdfcf4]")}>
        <div className="flex items-center gap-1.5">
          <ContentThumb src={ev.content.thumbUrl} seed={ev.content.id} icon={thumbIconFor(ev.content)} className="h-6 w-10 rounded" />
          <PlatformIcon platform={ev.platformId} size={12} />
          <span className="truncate text-xs text-muted-foreground tabular-nums">{ev.timeLabel}</span>
        </div>
        <p className="mt-1 line-clamp-2 leading-snug font-medium text-stone-800">{ev.content.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{ev.accountName}</p>
      </Link>
    </Frame>
  );
}

export function DayChip(p: ChipProps) {
  const { ev } = p;
  return (
    <Frame ev={ev} onReschedule={p.onReschedule}>
      <Link {...linkProps(p)} className={chipClass(ev, p, "flex items-start gap-3 bg-white p-2 hover:bg-[#fdfcf4]")}>
        <ContentThumb src={ev.content.thumbUrl} seed={ev.content.id} icon={thumbIconFor(ev.content)} durationSec={ev.content.durationSec} className="h-14 w-24" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-snug font-medium text-stone-800">{ev.content.title}</p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <PlatformIcon platform={ev.platformId} size={14} />
            <span className="tabular-nums">{ev.timeLabel}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge def={ScheduleStatus} value={ev.status} label={scheduleLabel(ev.status, ev.simulated)} size="sm" />
            <span className="truncate text-xs text-muted-foreground">{ev.accountName}</span>
          </div>
        </div>
      </Link>
    </Frame>
  );
}
