import {
  CalendarClock,
  CalendarPlus,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clapperboard,
  Eye,
  FileText,
  Film,
  ImageIcon,
  Lightbulb,
  Loader,
  Rocket,
  TriangleAlert,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActivityIcon } from "@/components/app/activity-icon";
import { EmptyState, Panel, PriorityBadge } from "@/components/app/content-bits";
import { ContentThumb } from "@/components/app/content-thumb";
import { PlatformIcon, PlatformLabel } from "@/components/app/platform-icon";
import { ScheduleButton } from "@/components/app/schedule-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { compactNumber, dayKey, fmt, fmtTime, relativeDay, timeAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { PIPELINE_STAGES, ScheduleStatus, Stage, scheduleLabel } from "@/lib/workflow/statuses";
import { getDashboardData, type DashboardData } from "@/server/queries/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const d = await getDashboardData();
  return (
    <>
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <p className="text-sm text-muted-foreground">{fmt(d.now, d.tz, "EEEE, MMMM d, yyyy")}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{greeting(Number(fmt(d.now, d.tz, "H")))}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {d.counts.scheduledToday} post{d.counts.scheduledToday === 1 ? "" : "s"} going out today · {d.counts.scheduledThisWeek} more this week · {d.counts.inProduction} video
            {d.counts.inProduction === 1 ? "" : "s"} in production
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="lg" className="bg-white" asChild><Link href="/calendar">Open calendar</Link></Button>
          <Button variant="outline" size="lg" className="bg-white" asChild><Link href="/content">View all content</Link></Button>
        </div>
      </div>

      <AttentionBanner d={d} />
      <StatCards d={d} />

      <section className="grid gap-4 md:gap-6 lg:grid-cols-12">
        <Panel className="lg:col-span-4" title="Content pipeline" description="Videos in each production stage" action={<Button variant="ghost" size="sm" asChild><Link href="/content">All</Link></Button>}>
          <Pipeline d={d} />
        </Panel>
        <Panel className="lg:col-span-5" title="Upcoming schedule" description="Next posts across all platforms" action={<Button variant="ghost" size="sm" asChild><Link href="/schedule">Queue</Link></Button>}>
          <Upcoming d={d} />
        </Panel>
        <Panel className="lg:col-span-3" title="Tasks & missing items" description="What each video still needs">
          <Tasks d={d} />
        </Panel>
      </section>

      <section className="grid gap-4 md:gap-6 lg:grid-cols-12">
        <Panel className="lg:col-span-8" title="This week" description={`${fmt(`${d.week[0]}T12:00:00Z`, "UTC", "MMM d")} – ${fmt(`${d.week[6]}T12:00:00Z`, "UTC", "MMM d")}`} action={<Button variant="ghost" size="sm" asChild><Link href="/calendar">Full calendar</Link></Button>}>
          <WeekStrip d={d} />
        </Panel>
        <Panel className="lg:col-span-4" title="Recent activity" description="Across all content">
          <div className="space-y-4 p-4">
            {d.activity.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
            {d.activity.map((a) => (
              <div key={a.id} className="flex gap-3">
                <ActivityIcon type={a.type} />
                <div className="min-w-0 text-sm">
                  <p>{a.message}</p>
                  {a.content && (
                    <Link href={`/content/${a.content.id}?tab=activity`} className="line-clamp-1 text-xs text-muted-foreground hover:text-primary">
                      {a.content.title}
                    </Link>
                  )}
                </div>
                <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">{timeAgo(a.createdAt, d.now)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </>
  );
}

function greeting(hour: number) {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function AttentionBanner({ d }: { d: DashboardData }) {
  const failed = d.counts.failedPosts;
  if (!failed && !d.accountIssues.length) return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-white p-4 sm:flex-row sm:items-start">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-700"><TriangleAlert className="size-5" /></span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          {failed > 0 && `${failed} post${failed > 1 ? "s" : ""} failed to publish`}
          {failed > 0 && d.accountIssues.length > 0 && " · "}
          {d.accountIssues.length > 0 && `${d.accountIssues.length} account${d.accountIssues.length > 1 ? "s" : ""} need${d.accountIssues.length > 1 ? "" : "s"} reconnecting`}
        </p>
        {/* The latest few; the queue lists them all */}
        <ul className="mt-1 space-y-0.5">
          {d.failed.slice(0, 3).map((f) => (
            <li key={f.id} className="truncate text-muted-foreground">
              <Link href={`/content/${f.content.id}?tab=publishing`} className="hover:text-foreground hover:underline">&ldquo;{f.content.title}&rdquo;</Link> → {f.accountName}: {f.lastError ?? "publishing failed"}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2">
        {d.accountIssues.length > 0 && <Button variant="outline" asChild><Link href="/accounts">Reconnect</Link></Button>}
        {failed > 0 && <Button asChild><Link href="/schedule?status=failed">{failed > 3 ? `See all ${failed}` : "Review failed"}</Link></Button>}
      </div>
    </div>
  );
}

function StatCards({ d }: { d: DashboardData }) {
  const c = d.counts;
  const cards = [
    { label: "Total videos", value: c.total, icon: Clapperboard, sub: `${c.ideas} idea${c.ideas === 1 ? "" : "s"} waiting`, href: "/content" },
    { label: "In production", value: c.inProduction, icon: Loader, sub: `${c.script} script · ${c.images} image · ${c.video} video · ${c.review} review`, href: "/content?stage=PRODUCTION" },
    { label: "Ready to post", value: c.ready, icon: Rocket, sub: "Waiting for a schedule", href: "/content?stage=READY", accent: true },
    { label: "Scheduled", value: c.scheduled, icon: CalendarClock, sub: `${c.scheduledThisWeek} post${c.scheduledThisWeek === 1 ? "" : "s"} left this week`, href: "/schedule" },
    {
      label: c.published > 0 && c.publishedSimulated === c.published ? "Published (simulated)" : "Published",
      value: c.published,
      icon: CircleCheck,
      sub: c.monthViewsSimulated ? `${compactNumber(c.monthViews)} simulated views this month` : `${compactNumber(c.monthViews)} views this month`,
      href: "/analytics",
    },
    { label: "Failed posts", value: c.failedPosts, icon: CircleAlert, sub: c.failedPosts ? "Needs your attention" : "All clear", href: "/schedule?status=failed", danger: c.failedPosts > 0 },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
      {cards.map((s) => (
        <Link
          key={s.label}
          href={s.href}
          className={cn("rounded-2xl border bg-card p-4 shadow-card transition-colors hover:border-olive-300", s.accent && "border-primary bg-primary text-white hover:border-primary")}
        >
          <div className="flex items-center justify-between">
            <span className={cn("text-sm", s.accent ? "text-olive-100" : "text-muted-foreground")}>{s.label}</span>
            <span className={cn("flex size-8 items-center justify-center rounded-lg", s.accent ? "bg-white/15" : s.danger ? "bg-rose-50 text-rose-700" : "bg-olive-50 text-primary")}>
              <s.icon className="size-4" />
            </span>
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{s.value}</p>
          <p className={cn("mt-1 text-xs", s.accent ? "text-olive-100" : s.danger ? "text-rose-700" : "text-muted-foreground")}>{s.sub}</p>
        </Link>
      ))}
    </section>
  );
}

const STAGE_ICONS = { IDEA: Lightbulb, SCRIPT: FileText, IMAGES: ImageIcon, VIDEO: Film, REVIEW: Eye, READY: Rocket, SCHEDULED: CalendarClock, PUBLISHED: CircleCheck } as const;

function Pipeline({ d }: { d: DashboardData }) {
  const max = Math.max(1, ...PIPELINE_STAGES.map((s) => d.byStage[s] ?? 0));
  return (
    <div className="p-3">
      {PIPELINE_STAGES.map((s) => {
        const Icon = STAGE_ICONS[s as keyof typeof STAGE_ICONS];
        const n = d.byStage[s] ?? 0;
        return (
          <Link key={s} href={`/content?stage=${s}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-[#fcfbf3]">
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", s === "READY" ? "bg-primary text-white" : "bg-olive-50 text-primary")}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{s === "READY" ? "Ready to post" : s === "IDEA" ? "Idea" : Stage.label(s).replace(" Pending", "")}</span>
                <span className="font-semibold tabular-nums">{n}</span>
              </div>
              <Progress value={(n / max) * 100} aria-label={`${Stage.label(s)}: ${n} video${n === 1 ? "" : "s"}`} className="mt-1.5 h-1.5 bg-[#eeebd8]" />
            </div>
          </Link>
        );
      })}
      {(d.byStage.FAILED ?? 0) > 0 && (
        <Link href="/content?stage=FAILED" className="mt-1 flex items-center gap-3 rounded-xl bg-rose-50/60 p-2 text-sm text-rose-800 hover:bg-rose-50">
          <CircleAlert className="ml-1.5 size-4" />
          <span className="flex-1 font-medium">Failed</span>
          <span className="font-semibold">{d.byStage.FAILED}</span>
        </Link>
      )}
    </div>
  );
}

function Upcoming({ d }: { d: DashboardData }) {
  if (!d.upcoming.length) {
    return <EmptyState icon={<CalendarPlus />} title="Nothing scheduled" description="Schedule a ready video to see it here." />;
  }
  return (
    <div className="divide-y divide-[#f3f1e4]">
      {d.upcoming.map((s) => {
        const day = relativeDay(s.scheduledAt, d.now, d.tz);
        return (
          <Link key={s.id} href={`/content/${s.content.id}?tab=publishing`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#fdfcf4]">
            <ContentThumb src={s.content.thumbUrl} seed={s.content.id} durationSec={s.content.durationSec} className="h-12 w-20" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.content.title}</p>
              <div className="mt-1 flex items-center gap-3">
                <PlatformLabel platform={s.platformId} />
                <span className="truncate text-xs text-muted-foreground">{s.accountName}</span>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn("text-sm font-medium", day === "Today" && "text-primary")}>{day}</p>
              <p className="text-xs text-muted-foreground">{fmtTime(s.scheduledAt, d.tz)}</p>
              <div className="mt-1">
                <StatusBadge def={ScheduleStatus} value={s.status} label={scheduleLabel(s.status, s.simulated)} size="sm" />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Tasks({ d }: { d: DashboardData }) {
  if (!d.ready.length && !d.incomplete.length) {
    return <EmptyState icon={<CircleCheck />} title="All caught up" description="Nothing in production right now." />;
  }
  return (
    <div className="space-y-2 p-3">
      {d.ready.map((c) => (
        <div key={c.id} className="rounded-xl border border-olive-200 bg-olive-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-olive-800"><Rocket className="size-3.5" />Ready — needs a schedule</p>
          <Link href={`/content/${c.id}`} className="mt-1 line-clamp-2 text-sm font-medium hover:underline">{c.title}</Link>
          <ScheduleButton contentId={c.id} size="sm" className="mt-2 w-full"><CalendarPlus />Schedule post</ScheduleButton>
        </div>
      ))}
      {d.counts.ready > d.ready.length && (
        <Button variant="ghost" size="sm" className="w-full" asChild>
          <Link href="/content?stage=READY&sort=priority">View all {d.counts.ready} ready to post</Link>
        </Button>
      )}
      {d.incomplete.map((c) => (
        <Link key={c.id} href={`/content/${c.id}?tab=${c.missing[0]?.tab ?? "overview"}`} className="block rounded-xl border border-[#f1eedf] p-3 hover:border-olive-300">
          <div className="flex items-center justify-between gap-2">
            <PriorityBadge priority={c.priority} />
            <span className="text-xs text-muted-foreground">{c.completion}%</span>
          </div>
          <p className="mt-1 line-clamp-1 text-sm font-medium">{c.title}</p>
          <ul className="mt-1.5 space-y-0.5">
            {c.missing.slice(0, 2).map((m) => (
              <li key={m.key} className="flex items-center gap-1.5 text-xs text-muted-foreground"><CircleDashed className="size-3 text-amber-600" />{m.label}</li>
            ))}
            {c.missing.length > 2 && <li className="pl-[18px] text-xs text-muted-foreground">+{c.missing.length - 2} more</li>}
          </ul>
        </Link>
      ))}
      {d.counts.inProduction > d.incomplete.length && (
        <Button variant="ghost" size="sm" className="w-full" asChild>
          <Link href="/content?stage=PRODUCTION&sort=priority">View all {d.counts.inProduction} in production</Link>
        </Button>
      )}
    </div>
  );
}

function WeekStrip({ d }: { d: DashboardData }) {
  return (
    <div className="thin-scroll overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-7">
        {d.week.map((key) => {
          const isToday = key === d.todayKey;
          const items = d.weekSchedules.filter((s) => dayKey(s.scheduledAt, d.tz) === key);
          return (
            <div key={key} className={cn("min-h-[160px] border-r border-[#f1eedf] p-2.5 last:border-r-0", isToday && "bg-olive-50/60")}>
              <p className="text-xs tracking-wide text-muted-foreground uppercase">{fmt(`${key}T12:00:00Z`, "UTC", "EEE")}</p>
              <p className={cn("text-lg font-semibold", isToday && "text-primary")}>{Number(key.slice(8))}</p>
              <div className="mt-1 space-y-1.5">
                {items.map((s) => (
                  <Link key={s.id} href={`/content/${s.content.id}?tab=publishing`} className="block rounded-lg border bg-white p-1.5 hover:border-olive-300">
                    <div className="flex items-center gap-1">
                      <PlatformIcon platform={s.platformId} size={12} />
                      <span className="text-xs text-muted-foreground">{fmtTime(s.scheduledAt, d.tz)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-snug font-medium">{s.content.title}</p>
                    <div className="mt-1">
                      <StatusBadge def={ScheduleStatus} value={s.status} label={scheduleLabel(s.status, s.simulated)} size="sm" />
                    </div>
                  </Link>
                ))}
                {items.length > 0 && items[0].dayTotal > items.length && (
                  <Link href={`/calendar?view=day&date=${key}`} className="block px-1 text-xs font-medium text-primary hover:underline">
                    +{items[0].dayTotal - items.length} more
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-8 w-72" /></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[122px] rounded-2xl" />)}</div>
      <div className="grid gap-6 lg:grid-cols-12">
        <Skeleton className="h-[420px] rounded-2xl lg:col-span-4" />
        <Skeleton className="h-[420px] rounded-2xl lg:col-span-5" />
        <Skeleton className="h-[420px] rounded-2xl lg:col-span-3" />
      </div>
    </>
  );
}
