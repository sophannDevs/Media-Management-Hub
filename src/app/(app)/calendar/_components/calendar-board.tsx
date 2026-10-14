"use client";

import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { type DragEvent, useOptimistic, useState } from "react";
import { toast } from "sonner";
import { ContentThumb, thumbIconFor } from "@/components/app/content-thumb";
import { PLATFORM_NAMES, PlatformIcon } from "@/components/app/platform-icon";
import { useScheduleDialog } from "@/components/app/schedule-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { useServerAction } from "@/hooks/use-server-action";
import { zonedToUtc } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ScheduleStatus, scheduleLabel } from "@/lib/workflow/statuses";
import { rescheduleAction } from "@/server/actions/schedule";
import type { CalendarData, CalendarEvent } from "@/server/queries/calendar";
import { calendarHref, decodeContentDrag, DRAG_CONTENT, DRAG_SCHEDULE, FIRST_HOUR, LAST_HOUR, pad2, rowHour } from "./calendar-shared";

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Status is shown as the chip's left border colour. */
const STATUS_BORDER: Record<string, string> = {
  WAITING: "border-l-violet-500",
  PROCESSING: "border-l-amber-500",
  PUBLISHED: "border-l-olive-600",
  FAILED: "border-l-rose-600",
  RETRY_SCHEDULED: "border-l-orange-500",
};

const contentHref = (ev: CalendarEvent) => `/content/${ev.content.id}?tab=publishing`;
const chipTitle = (ev: CalendarEvent) =>
  `${ev.content.title}\n${scheduleLabel(ev.status, ev.simulated)} · ${PLATFORM_NAMES[ev.platformId] ?? ev.platformId} · ${ev.accountName}\n${ev.timeLabel}${ev.movable ? "\nDrag to reschedule" : ""}`;
const hasType = (e: DragEvent, type: string) => Array.from(e.dataTransfer.types).includes(type);
/** Reads the clock — only call from event handlers, never during render. */
const hasPassed = (at: Date) => at.getTime() <= Date.now();
/** Next full hour today ("21:00"), or "23:59" late in the evening. Event handlers only. */
function nextHourToday(tz: string) {
  const h = Number(formatInTimeZone(new Date(Date.now() + 3_600_000), tz, "H"));
  return h === 0 ? "23:59" : `${pad2(h)}:00`;
}

type Move = { id: string; dayKey: string; time: string; timeLabel: string };
type Props = Pick<CalendarData, "view" | "days" | "events" | "tz" | "todayKey" | "nowHour" | "nowMinute" | "platform">;

/**
 * Month / week / day grid. Posts can be dragged to another day (month keeps the
 * local time) or hour slot (week / day); ready content dropped from the sidebar
 * opens the Schedule dialog prefilled with that slot.
 */
export function CalendarBoard({ view, days, events: serverEvents, tz, todayKey, nowHour, nowMinute, platform }: Props) {
  const { run } = useServerAction();
  const { openSchedule } = useScheduleDialog();
  const [events, applyMove] = useOptimistic(serverEvents, (state, m: Move) =>
    state.map((e) => (e.id === m.id ? { ...e, dayKey: m.dayKey, time: m.time, timeLabel: m.timeLabel, status: "WAITING" } : e)),
  );
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const dayHref = (key: string) => calendarHref({ view: "day", date: key, platform: platform ?? undefined });

  function onEventDragStart(e: DragEvent<HTMLElement>, ev: CalendarEvent) {
    if (!ev.movable) {
      e.preventDefault();
      return;
    }
    // Replace the link's default payload so dropping elsewhere never navigates
    e.dataTransfer.clearData();
    e.dataTransfer.setData(DRAG_SCHEDULE, ev.id);
    e.dataTransfer.effectAllowed = "move";
    const r = e.currentTarget.getBoundingClientRect();
    e.dataTransfer.setDragImage(e.currentTarget, e.clientX - r.left, e.clientY - r.top);
    setDragging(ev.id);
  }

  function onCellDragOver(e: DragEvent<HTMLElement>, cell: string) {
    const isMove = hasType(e, DRAG_SCHEDULE);
    if (!isMove && !hasType(e, DRAG_CONTENT)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isMove ? "move" : "copy";
    setOver(cell);
  }

  function onCellDragLeave(e: DragEvent<HTMLElement>, cell: string) {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setOver((o) => (o === cell ? null : o));
  }

  function onCellDrop(e: DragEvent<HTMLElement>, date: string, hour?: number) {
    e.preventDefault();
    setOver(null);
    setDragging(null);
    const scheduleId = e.dataTransfer.getData(DRAG_SCHEDULE);
    const content = decodeContentDrag(e.dataTransfer.getData(DRAG_CONTENT));
    if (!scheduleId && !content) return;
    if (date < todayKey) {
      toast.error("Can't schedule in the past", { description: "Drop it on today or a later day." });
      return;
    }
    const slot = hour === undefined ? undefined : `${pad2(hour)}:00`;

    if (content) {
      let time = slot ?? "18:00";
      if (hasPassed(zonedToUtc(date, time, tz))) {
        if (slot) {
          toast.error("That time has already passed", { description: "Pick a later time slot." });
          return;
        }
        time = nextHourToday(tz);
      }
      openSchedule({ contentId: content.id, date, time, platformId: content.platformId });
      return;
    }

    const ev = events.find((x) => x.id === scheduleId);
    if (!ev || !ev.movable) return;
    const time = slot ?? ev.time;
    if (ev.dayKey === date && ev.time === time) return;
    if (!ev.accountConnected) {
      toast.error(`Reconnect “${ev.accountName}” before rescheduling.`, { description: "Social Accounts → Reconnect" });
      return;
    }
    const at = zonedToUtc(date, time, tz);
    if (hasPassed(at)) {
      toast.error("That time has already passed", { description: "Pick a later time slot." });
      return;
    }
    const timeLabel = formatInTimeZone(at, tz, "h:mm a");
    run(
      () => {
        applyMove({ id: ev.id, dayKey: date, time, timeLabel });
        return rescheduleAction(ev.id, at.toISOString());
      },
      { success: `Rescheduled to ${formatInTimeZone(at, tz, "EEE, MMM d")} · ${timeLabel}` },
    );
  }

  const dropProps = (cell: string, date: string, hour?: number) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => onCellDragOver(e, cell),
    onDragLeave: (e: DragEvent<HTMLDivElement>) => onCellDragLeave(e, cell),
    onDrop: (e: DragEvent<HTMLDivElement>) => onCellDrop(e, date, hour),
  });
  const dropHighlight = (cell: string, past: boolean) =>
    over === cell && (past ? "bg-rose-50/70 ring-2 ring-rose-200 ring-inset" : "bg-olive-50 ring-2 ring-olive-300 ring-inset");
  const chipProps = (ev: CalendarEvent) => ({
    ev,
    dimmed: dragging === ev.id,
    onDragStart: (e: DragEvent<HTMLAnchorElement>) => onEventDragStart(e, ev),
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
  });

  if (view === "month") {
    const byDay = new Map<string, CalendarEvent[]>();
    for (const ev of events) byDay.set(ev.dayKey, [...(byDay.get(ev.dayKey) ?? []), ev]);
    for (const list of byDay.values()) list.sort((a, b) => a.time.localeCompare(b.time));

    return (
      <div className="thin-scroll overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 border-b border-[#f0eddb] bg-[#fcfbf3]">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2 text-xs font-medium text-muted-foreground">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const items = byDay.get(day.key) ?? [];
              return (
                <div
                  key={day.key}
                  {...dropProps(day.key, day.key)}
                  className={cn(
                    "min-h-[7.5rem] border-r border-b border-[#f0eddb] p-1.5 transition-colors [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0",
                    !day.inMonth && "bg-[#fcfbf6]",
                    day.isToday && "bg-olive-50/50",
                    dropHighlight(day.key, day.isPast),
                  )}
                >
                  <Link
                    href={dayHref(day.key)}
                    title={`Open ${day.longLabel}`}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      day.isToday ? "bg-primary font-semibold text-primary-foreground" : day.inMonth ? "font-medium text-stone-700 hover:bg-olive-100" : "text-muted-foreground hover:bg-olive-50",
                    )}
                  >
                    {day.day}
                  </Link>
                  <div className="mt-1 space-y-1">
                    {items.slice(0, 3).map((ev) => (
                      <MonthChip key={ev.id} {...chipProps(ev)} />
                    ))}
                    {items.length > 3 && (
                      <Link href={dayHref(day.key)} className="block px-1 text-xs font-medium text-olive-700 hover:underline">
                        +{items.length - 3} more
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Week / day time grid
  const bySlot = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const k = `${ev.dayKey}|${rowHour(ev.time)}`;
    bySlot.set(k, [...(bySlot.get(k) ?? []), ev]);
  }
  for (const list of bySlot.values()) list.sort((a, b) => a.time.localeCompare(b.time));
  const cols = view === "week" ? "grid-cols-[56px_repeat(7,minmax(0,1fr))]" : "grid-cols-[56px_minmax(0,1fr)]";
  const large = view === "day";

  return (
    <div className="thin-scroll overflow-x-auto">
      <div className={cn(view === "week" && "min-w-[880px]")}>
        <div className={cn("grid border-b border-[#f0eddb] bg-[#fcfbf3]", cols)}>
          <div />
          {days.map((day) => (
            <Link key={day.key} href={dayHref(day.key)} title={`Open ${day.longLabel}`} className="border-l border-[#f0eddb] px-2 py-2 text-center hover:bg-olive-50/70">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">{day.weekday}</p>
              <p className={cn("text-lg font-semibold tabular-nums", day.isToday && "text-primary")}>{day.day}</p>
            </Link>
          ))}
        </div>
        {HOURS.map((h) => (
          <div key={h} className={cn("grid", cols)}>
            <div className="border-b border-[#f6f4e8] pt-1 pr-2 text-right text-xs text-muted-foreground tabular-nums">{pad2(h)}:00</div>
            {days.map((day) => {
              const cell = `${day.key}|${h}`;
              const items = bySlot.get(cell) ?? [];
              const past = day.isPast || (day.isToday && h <= nowHour);
              return (
                <div
                  key={cell}
                  {...dropProps(cell, day.key, h)}
                  className={cn("relative min-h-14 space-y-1 border-b border-l border-[#f0eddb] p-1 transition-colors", past && "bg-[#fcfbf6]", dropHighlight(cell, past))}
                >
                  {day.isToday && h === nowHour && (
                    <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: `${(nowMinute / 60) * 100}%` }} aria-hidden>
                      <span className="-ml-1 size-2 rounded-full bg-primary" />
                      <span className="h-0.5 flex-1 bg-primary/70" />
                    </div>
                  )}
                  {items.map((ev) => (large ? <DayChip key={ev.id} {...chipProps(ev)} /> : <WeekChip key={ev.id} {...chipProps(ev)} />))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

interface ChipProps {
  ev: CalendarEvent;
  dimmed: boolean;
  onDragStart: (e: DragEvent<HTMLAnchorElement>) => void;
  onDragEnd: () => void;
}

function chipClass(ev: CalendarEvent, dimmed: boolean, base: string) {
  return cn(
    "rounded-lg border border-[#ece9d6] border-l-[3px] transition-[background-color,opacity] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
    base,
    STATUS_BORDER[ev.status] ?? "border-l-stone-400",
    ev.movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
    dimmed && "opacity-40",
  );
}

function MonthChip({ ev, dimmed, onDragStart, onDragEnd }: ChipProps) {
  return (
    <Link
      href={contentHref(ev)}
      draggable={ev.movable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={chipTitle(ev)}
      className={chipClass(ev, dimmed, "flex items-center gap-1.5 rounded-md bg-[#f7f5e6] px-1.5 py-1 text-xs leading-tight hover:bg-olive-50")}
    >
      <PlatformIcon platform={ev.platformId} size={12} />
      <span className="shrink-0 text-muted-foreground tabular-nums">{ev.timeLabel.replace(":00", "")}</span>
      <span className="truncate font-medium text-stone-800">{ev.content.title}</span>
    </Link>
  );
}

function WeekChip({ ev, dimmed, onDragStart, onDragEnd }: ChipProps) {
  return (
    <Link
      href={contentHref(ev)}
      draggable={ev.movable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={chipTitle(ev)}
      className={chipClass(ev, dimmed, "block bg-white p-1.5 text-xs hover:bg-[#fdfcf4]")}
    >
      <div className="flex items-center gap-1.5">
        <ContentThumb src={ev.content.thumbUrl} seed={ev.content.id} icon={thumbIconFor(ev.content)} className="h-6 w-10 rounded" />
        <PlatformIcon platform={ev.platformId} size={12} />
        <span className="truncate text-xs text-muted-foreground tabular-nums">{ev.timeLabel}</span>
      </div>
      <p className="mt-1 line-clamp-2 leading-snug font-medium text-stone-800">{ev.content.title}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{ev.accountName}</p>
    </Link>
  );
}

function DayChip({ ev, dimmed, onDragStart, onDragEnd }: ChipProps) {
  return (
    <Link
      href={contentHref(ev)}
      draggable={ev.movable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={chipTitle(ev)}
      className={chipClass(ev, dimmed, "flex items-start gap-3 bg-white p-2 hover:bg-[#fdfcf4]")}
    >
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
  );
}
