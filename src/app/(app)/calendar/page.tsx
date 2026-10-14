import { CalendarPlus, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, Panel } from "@/components/app/content-bits";
import { PLATFORM_NAMES } from "@/components/app/platform-icon";
import { ScheduleButton } from "@/components/app/schedule-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listProviders } from "@/lib/platforms/registry";
import { cn } from "@/lib/utils";
import { type CalendarData, getCalendarData } from "@/server/queries/calendar";
import { CalendarBoard } from "./_components/calendar-board";
import { CalendarControls } from "./_components/calendar-controls";
import { calendarHref, parseCalendarParams } from "./_components/calendar-shared";
import { ReadyList } from "./_components/ready-list";

export const metadata: Metadata = { title: "Content Calendar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        title="Content Calendar"
        description="Drag a post to another day to reschedule. Drag ready content from the right to schedule it."
        actions={
          <Suspense fallback={<ControlsSkeleton />}>
            <Controls searchParams={searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<CalendarSkeleton />}>
        <Calendar searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Controls({ searchParams }: { searchParams: SearchParams }) {
  const params = parseCalendarParams(await searchParams);
  return <CalendarControls params={params} platforms={listProviders().map((p) => ({ id: p.id, name: p.name }))} />;
}

async function Calendar({ searchParams }: { searchParams: SearchParams }) {
  const d = await getCalendarData(parseCalendarParams(await searchParams));
  const platform = d.platform ?? undefined;
  const unit = d.view === "month" ? "month" : d.view === "week" ? "week" : "day";

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      <section className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-card xl:col-span-9" aria-label="Calendar">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#f1eedf] px-4 py-3">
          <Button variant="outline" size="sm" className="bg-white" asChild>
            <Link href={calendarHref({ view: d.view, platform })} scroll={false}>Today</Link>
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href={calendarHref({ view: d.view, date: d.prevDate, platform })} scroll={false} aria-label={`Previous ${unit}`}>
              <ChevronLeft />
            </Link>
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href={calendarHref({ view: d.view, date: d.nextDate, platform })} scroll={false} aria-label={`Next ${unit}`}>
              <ChevronRight />
            </Link>
          </Button>
          <h2 className="ml-1 min-w-0 font-semibold">{d.title}</h2>
          <Legend className="ml-auto hidden md:flex" />
        </div>

        {d.events.length === 0 && (
          <div className="flex flex-col gap-2 border-b border-[#f1eedf] bg-[#fcfbf3] px-4 py-3 text-sm sm:flex-row sm:items-center">
            <span className="flex items-center gap-2 text-muted-foreground">
              <CalendarPlus className="size-4 shrink-0 text-primary" />
              Nothing scheduled {d.view === "day" ? "on this day" : `this ${unit}`}
              {d.platformName ? ` on ${d.platformName}` : ""}. Drag ready content onto a day to schedule it.
            </span>
            <ScheduleButton contentId={null} variant="outline" size="sm" className="bg-white sm:ml-auto">
              <CalendarPlus />
              Schedule post
            </ScheduleButton>
          </div>
        )}

        <CalendarBoard
          view={d.view}
          days={d.days}
          events={d.events}
          tz={d.tz}
          todayKey={d.todayKey}
          nowHour={d.nowHour}
          nowMinute={d.nowMinute}
          platform={d.platform}
        />
        <Legend className="flex border-t border-[#f1eedf] px-4 py-2.5 md:hidden" />
      </section>

      <aside className="min-w-0 space-y-6 xl:col-span-3">
        <Panel
          title="Ready to schedule"
          description="Drag onto a day, or click to schedule"
          action={d.ready.length > 0 ? <span className="text-xs text-muted-foreground tabular-nums">{d.ready.length}</span> : undefined}
        >
          <ReadyList items={d.ready} platform={d.platform} />
        </Panel>
        <BestTimes d={d} />
      </aside>
    </div>
  );
}

const LEGEND = [
  ["Scheduled", "bg-violet-500"],
  ["Published", "bg-olive-600"],
  ["Failed", "bg-rose-600"],
  ["Retrying", "bg-orange-500"],
] as const;

function Legend({ className }: { className?: string }) {
  return (
    <div className={cn("flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {LEGEND.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", color)} />
          {label}
        </span>
      ))}
    </div>
  );
}

function BestTimes({ d }: { d: CalendarData }) {
  if (!d.bestTimes.length) return null;
  return (
    <Panel
      title="Best posting times"
      description={`${d.bestTimesSimulated ? "Simulated data · " : ""}Avg views per post · ${d.bestTimesBasedOn} ${d.platformName ?? "published"} post${d.bestTimesBasedOn === 1 ? "" : "s"}`}
    >
      <ul className="space-y-3 p-4 text-sm">
        {d.bestTimes.map((s) => (
          <li key={s.key} className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-olive-50 text-olive-700">
              <Clock className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="font-medium tabular-nums">{s.label}</p>
              <p className="truncate text-xs text-muted-foreground">
                {s.avgViews} avg views · {s.posts} post{s.posts === 1 ? "" : "s"} · {s.platforms.map((p) => PLATFORM_NAMES[p] ?? p).join(", ")}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-[#f1eedf] px-4 py-2.5 text-xs text-muted-foreground">
        Times in {d.tz}
        {d.bestTimesSimulated && " · based on generated numbers, not real audience data"}
      </p>
    </Panel>
  );
}

function ControlsSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-9 w-[150px] rounded-lg" />
      <Skeleton className="h-9 w-[178px] rounded-xl" />
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-12">
      <div className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-card xl:col-span-9">
        <div className="flex items-center gap-2 border-b border-[#f1eedf] px-4 py-3">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="size-7" />
          <Skeleton className="size-7" />
          <Skeleton className="ml-1 h-5 w-40" />
        </div>
        <Skeleton className="h-9 rounded-none" />
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className="h-[7.5rem] border-r border-b border-[#f0eddb] p-1.5 [&:nth-child(7n)]:border-r-0">
              <Skeleton className="size-6 rounded-full" />
              {i % 3 === 1 && <Skeleton className="mt-2 h-5 w-full" />}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-6 xl:col-span-3">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    </div>
  );
}
