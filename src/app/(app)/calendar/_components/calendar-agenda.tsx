"use client";

import { CalendarClock, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContentThumb, thumbIconFor } from "@/components/app/content-thumb";
import { PLATFORM_NAMES, PlatformIcon } from "@/components/app/platform-icon";
import { useScheduleDialog } from "@/components/app/schedule-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDaysToKey, fmt } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ScheduleStatus, scheduleLabel } from "@/lib/workflow/statuses";
import type { CalendarEvent } from "@/server/queries/calendar";
import { calendarHref } from "./calendar-shared";
import { contentHref } from "./calendar-chips";

const STATUS_BORDER: Record<string, string> = {
  WAITING: "border-l-violet-500",
  PROCESSING: "border-l-amber-500",
  PUBLISHED: "border-l-olive-600",
  FAILED: "border-l-rose-600",
  RETRY_SCHEDULED: "border-l-orange-500",
};

/**
 * The calendar on a phone (UX-01): the month grid needs 720 px, so below the
 * medium breakpoint the same posts are listed by day instead, today and later
 * first, earlier days folded away. Every post can be rescheduled from here, and
 * "Go to date" reaches any day.
 */
export function CalendarAgenda({
  events,
  todayKey,
  platform,
  onReschedule,
}: {
  events: CalendarEvent[];
  todayKey: string;
  platform: string | null;
  onReschedule: (ev: CalendarEvent) => void;
}) {
  const router = useRouter();
  const { openSchedule } = useScheduleDialog();

  const byDay = new Map<string, CalendarEvent[]>();
  for (const ev of events) byDay.set(ev.dayKey, [...(byDay.get(ev.dayKey) ?? []), ev]);
  const groups = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, list] of groups) list.sort((a, b) => a.time.localeCompare(b.time));
  const upcoming = groups.filter(([key]) => key >= todayKey);
  const earlier = groups.filter(([key]) => key < todayKey);

  const tomorrowKey = addDaysToKey(todayKey, 1);
  const dayLabel = (key: string) => {
    const date = fmt(`${key}T12:00:00Z`, "UTC", "EEE, MMM d");
    return key === todayKey ? `Today · ${date}` : key === tomorrowKey ? `Tomorrow · ${date}` : date;
  };

  const day = ([key, list]: [string, CalendarEvent[]]) => (
    <section key={key} aria-labelledby={`agenda-${key}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`agenda-${key}`} className={cn("text-sm font-semibold", key === todayKey && "text-primary")}>
          {dayLabel(key)}
        </h3>
        {key >= todayKey && (
          <Button variant="ghost" size="icon-sm" aria-label={`Schedule a post on ${dayLabel(key)}`} onClick={() => openSchedule({ date: key })}>
            <Plus />
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {list.map((ev) => (
          <li key={ev.id} className={cn("rounded-xl border border-l-[3px] border-[#ece9d6] bg-white p-2.5", STATUS_BORDER[ev.status] ?? "border-l-stone-400")}>
            <Link href={contentHref(ev)} className="flex gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              <ContentThumb src={ev.content.thumbUrl} seed={ev.content.id} icon={thumbIconFor(ev.content)} className="h-14 w-20 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm leading-snug font-medium">{ev.content.title}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <PlatformIcon platform={ev.platformId} size={14} />
                  {PLATFORM_NAMES[ev.platformId] ?? ev.platformId} · <span className="tabular-nums">{ev.timeLabel}</span>
                </p>
              </div>
            </Link>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <StatusBadge def={ScheduleStatus} value={ev.status} label={scheduleLabel(ev.status, ev.simulated)} size="sm" />
                <span className="truncate text-xs text-muted-foreground">{ev.accountName}</span>
              </div>
              {ev.movable && (
                <Button variant="outline" size="sm" className="shrink-0 bg-white" aria-label={`Reschedule ${ev.content.title}, ${PLATFORM_NAMES[ev.platformId] ?? ev.platformId}`} onClick={() => onReschedule(ev)}>
                  <CalendarClock />
                  Reschedule
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="space-y-5 p-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="agenda-jump" className="shrink-0 text-xs text-muted-foreground">
          Go to date
        </Label>
        <Input
          id="agenda-jump"
          type="date"
          className="h-9 flex-1"
          onChange={(e) => e.target.value && router.push(calendarHref({ view: "day", date: e.target.value, platform: platform ?? undefined }))}
        />
      </div>
      {upcoming.map(day)}
      {earlier.length > 0 && (
        <details className="rounded-xl border border-[#ece9d6] bg-[#fcfbf3] p-3">
          <summary className="cursor-pointer text-sm font-medium">Earlier in this period ({earlier.reduce((n, [, l]) => n + l.length, 0)})</summary>
          <div className="mt-3 space-y-5">{earlier.map(day)}</div>
        </details>
      )}
    </div>
  );
}
