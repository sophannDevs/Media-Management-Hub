"use client";

import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { type DragEvent, type KeyboardEvent, useEffect, useOptimistic, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerAction } from "@/hooks/use-server-action";
import { addDaysToKey, zonedToUtc } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { rescheduleAction } from "@/server/actions/schedule";
import type { CalendarData, CalendarEvent } from "@/server/queries/calendar";
import { CalendarAgenda } from "./calendar-agenda";
import { type ChipProps, DayChip, MonthChip, MOVE_HELP_ID, WeekChip } from "./calendar-chips";
import { calendarHref, decodeContentDrag, DRAG_CONTENT, DRAG_SCHEDULE, FIRST_HOUR, LAST_HOUR, pad2, rowHour } from "./calendar-shared";
import { RescheduleDialog } from "./reschedule-dialog";
import { useScheduleDialog } from "@/components/app/schedule-dialog";

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
/** A post picked up with the keyboard, and the slot it would drop into (hour is null in the month view, which keeps the time). */
type Grab = { id: string; dayKey: string; hour: number | null };

/**
 * Month / week / day grid, and on phones an agenda list. A post can be moved
 * three ways: dragged to another day (month keeps the local time) or hour slot
 * (week / day); picked up with Space and moved with the arrow keys; or through
 * its Reschedule… menu (A11Y-04). Ready content dropped from the sidebar opens
 * the Schedule dialog prefilled with that slot.
 */
export function CalendarBoard({ view, days, events: serverEvents, tz, todayKey, nowHour, nowMinute, platform }: Props) {
  const { run } = useServerAction();
  const { openSchedule } = useScheduleDialog();
  const [events, applyMove] = useOptimistic(serverEvents, (state, m: Move) =>
    state.map((e) => (e.id === m.id ? { ...e, dayKey: m.dayKey, time: m.time, timeLabel: m.timeLabel, status: "WAITING" } : e)),
  );
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [grab, setGrab] = useState<Grab | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [rescheduling, setRescheduling] = useState<CalendarEvent | null>(null);
  // After a keyboard drop the chip is re-created in its new cell: give it focus back
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (!refocus.current) return;
    document.querySelector<HTMLElement>(`[data-chip="${CSS.escape(refocus.current)}"]`)?.focus();
    refocus.current = null;
  }, [events]);

  const dayHref = (key: string) => calendarHref({ view: "day", date: key, platform: platform ?? undefined });
  const cellOf = (dayKey: string, hour: number | null) => (hour === null ? dayKey : `${dayKey}|${hour}`);
  const when = (dayKey: string, hour: number | null, time: string) => {
    const at = zonedToUtc(dayKey, hour === null ? time : `${pad2(hour)}:00`, tz);
    return formatInTimeZone(at, tz, hour === null ? "EEE, MMM d" : "EEE, MMM d 'at' h:mm a");
  };

  /**
   * Moves a post to a day and "HH:mm" in the workspace time zone, however the
   * person asked (drag, keys, dialog). Returns false, after saying why, when it can't.
   */
  function commitMove(ev: CalendarEvent, date: string, time: string): boolean {
    if (date < todayKey) {
      toast.error("Can't schedule in the past", { description: "Pick today or a later day." });
      return false;
    }
    if (ev.dayKey === date && ev.time === time) return true;
    if (!ev.accountConnected) {
      toast.error(`Reconnect “${ev.accountName}” before rescheduling.`, { description: "Social Accounts → Reconnect" });
      return false;
    }
    const at = zonedToUtc(date, time, tz);
    if (hasPassed(at)) {
      toast.error("That time has already passed", { description: "Pick a later time." });
      return false;
    }
    const timeLabel = formatInTimeZone(at, tz, "h:mm a");
    run(
      () => {
        applyMove({ id: ev.id, dayKey: date, time, timeLabel });
        return rescheduleAction(ev.id, at.toISOString());
      },
      { success: `Rescheduled to ${formatInTimeZone(at, tz, "EEE, MMM d")} · ${timeLabel}` },
    );
    return true;
  }

  // ----- Mouse drag and drop -----

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
    if (ev?.movable) commitMove(ev, date, slot ?? ev.time);
  }

  // ----- Keyboard: Space picks a post up, arrows choose the slot, Enter drops it, Escape cancels -----

  const first = days[0]?.key;
  const last = days[days.length - 1]?.key;

  function pickUp(ev: CalendarEvent) {
    const hour = view === "month" ? null : rowHour(ev.time);
    setGrab({ id: ev.id, dayKey: ev.dayKey, hour });
    setOver(cellOf(ev.dayKey, hour));
    setAnnouncement(`Picked up “${ev.content.title}”, scheduled ${ev.dayKey} ${ev.timeLabel}. Arrow keys choose a new ${view === "month" ? "day" : "slot"}, Enter drops it, Escape cancels.`);
  }

  function moveGrab(ev: CalendarEvent, dDays: number, dHours: number) {
    if (!grab) return;
    const dayKey = addDaysToKey(grab.dayKey, dDays);
    const hour = grab.hour === null ? null : grab.hour + dHours;
    if (dayKey < first || dayKey > last || (hour !== null && (hour < FIRST_HOUR || hour > LAST_HOUR))) {
      setAnnouncement(`That is the edge of the ${view}. ${when(grab.dayKey, grab.hour, ev.time)}.`);
      return;
    }
    setGrab({ ...grab, dayKey, hour });
    setOver(cellOf(dayKey, hour));
    setAnnouncement(`${when(dayKey, hour, ev.time)}${dayKey < todayKey ? ", in the past" : ""}.`);
  }

  function dropGrab(ev: CalendarEvent) {
    if (!grab) return;
    const time = grab.hour === null ? ev.time : `${pad2(grab.hour)}:00`;
    if (!commitMove(ev, grab.dayKey, time)) {
      setAnnouncement("Can't drop it there. Choose another slot, or press Escape to cancel.");
      return;
    }
    refocus.current = ev.id;
    setGrab(null);
    setOver(null);
    setAnnouncement(`Moved to ${when(grab.dayKey, grab.hour, ev.time)}.`);
  }

  function cancelGrab() {
    if (!grab) return;
    setGrab(null);
    setOver(null);
    setAnnouncement("Move cancelled.");
  }

  function onChipKeyDown(e: KeyboardEvent<HTMLAnchorElement>, ev: CalendarEvent) {
    if (!ev.movable) return;
    if (grab?.id !== ev.id) {
      if (e.key === " ") {
        e.preventDefault();
        pickUp(ev);
      }
      return;
    }
    const month = view === "month";
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: month ? [-7, 0] : [0, -1],
      ArrowDown: month ? [7, 0] : [0, 1],
    };
    if (step[e.key]) {
      e.preventDefault();
      moveGrab(ev, ...step[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dropGrab(ev);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelGrab();
    }
  }

  const dropProps = (cell: string, date: string, hour?: number) => ({
    onDragOver: (e: DragEvent<HTMLDivElement>) => onCellDragOver(e, cell),
    onDragLeave: (e: DragEvent<HTMLDivElement>) => onCellDragLeave(e, cell),
    onDrop: (e: DragEvent<HTMLDivElement>) => onCellDrop(e, date, hour),
  });
  const dropHighlight = (cell: string, past: boolean) =>
    over === cell && (past ? "bg-rose-50/70 ring-2 ring-rose-200 ring-inset" : "bg-olive-50 ring-2 ring-olive-300 ring-inset");
  const chipProps = (ev: CalendarEvent): ChipProps => ({
    ev,
    dimmed: dragging === ev.id,
    grabbed: grab?.id === ev.id,
    onDragStart: (e) => onEventDragStart(e, ev),
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
    onKeyDown: (e) => onChipKeyDown(e, ev),
    // Leaving the chip drops the pick-up (without moving anything)
    onBlur: () => grab?.id === ev.id && cancelGrab(),
    onReschedule: () => setRescheduling(ev),
  });

  return (
    <>
      <p id={MOVE_HELP_ID} className="sr-only">
        Press Space to pick this post up, then the arrow keys to choose a new {view === "month" ? "day" : "time slot"}, Enter to drop it and Escape to cancel. Or open its actions menu and choose Reschedule.
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Phones: a list by day. Tablets and desktops: the grid. */}
      <div className="md:hidden">
        <CalendarAgenda events={events} todayKey={todayKey} platform={platform} onReschedule={setRescheduling} />
      </div>
      <div className="hidden md:block">{view === "month" ? renderMonth() : renderTimeGrid()}</div>

      <RescheduleDialog event={rescheduling} tz={tz} todayKey={todayKey} onSubmit={commitMove} onClose={() => setRescheduling(null)} />
    </>
  );

  function renderMonth() {
    const byDay = new Map<string, CalendarEvent[]>();
    for (const ev of events) byDay.set(ev.dayKey, [...(byDay.get(ev.dayKey) ?? []), ev]);
    for (const list of byDay.values()) list.sort((a, b) => a.time.localeCompare(b.time));

    return (
      <div className="thin-scroll overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 border-b border-[#f0eddb] bg-[#fcfbf3]">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2 text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const items = byDay.get(day.key) ?? [];
              return (
                <div
                  key={day.key}
                  data-day={day.key}
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

  function renderTimeGrid() {
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
                    data-cell={cell}
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
}
