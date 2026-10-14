import { CalendarPlus, CircleCheck, History, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { EmptyState, PageHeader } from "@/components/app/content-bits";
import { ContentThumb, thumbIconFor } from "@/components/app/content-thumb";
import { PlatformIcon, PlatformLabel } from "@/components/app/platform-icon";
import { ScheduleButton } from "@/components/app/schedule-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AccountStatus, JobStatus, ScheduleStatus, scheduleLabel } from "@/lib/workflow/statuses";
import { getQueueData, type QueueData, type QueueRow } from "@/server/queries/schedule";
import { QueueHeaderActions } from "./_components/header-actions";
import { FailedActions, RowActions } from "./_components/queue-actions";
import { QueueFilters } from "./_components/queue-filters";
import { parseQueueParams, type QueueTab, queueHref } from "./_components/queue-shared";

export const metadata: Metadata = { title: "Publishing queue" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function SchedulePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        title="Publishing queue"
        description="Every scheduled post, per platform. Failed posts keep their error so you can retry or reschedule."
        actions={<QueueHeaderActions />}
      />
      <Suspense fallback={<QueueSkeleton />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const d = await getQueueData(parseQueueParams(await searchParams));
  return (
    <>
      <AutoRefresh active={d.inFlight} />
      <WorkerCard d={d} />
      {d.failed.length > 0 && <FailedCallouts d={d} />}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <QueueTabs d={d} />
        <QueueFilters params={d.params} platforms={d.platforms} accounts={d.accounts} className="lg:ml-auto" />
      </div>
      <section className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-card" aria-label="Scheduled posts">
        {d.rows.length ? <QueueTable d={d} /> : <QueueEmpty d={d} />}
      </section>
    </>
  );
}

function WorkerCard({ d }: { d: QueueData }) {
  const w = d.worker;
  const stats: { label: string; value: number; className: string; tab: QueueTab }[] = [
    { label: "Waiting", value: d.counts.waiting, className: "text-foreground", tab: "upcoming" },
    { label: "Processing", value: d.counts.processing, className: "text-amber-700", tab: "upcoming" },
    { label: "Retrying", value: d.counts.retrying, className: "text-orange-700", tab: "failed" },
    { label: "Failed", value: d.counts.failed, className: "text-rose-700", tab: "failed" },
    {
      label: d.counts.published > 0 && d.counts.publishedSimulated === d.counts.published ? "Simulated" : "Published",
      value: d.counts.published,
      className: "text-olive-700",
      tab: "published",
    },
  ];
  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-card md:flex-row md:items-center" aria-label="Publishing worker">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {w.running ? (
          <span className="relative flex size-2.5 shrink-0" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-olive-400 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-olive-600" />
          </span>
        ) : (
          <span className="size-2.5 shrink-0 rounded-full bg-rose-600" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {w.running ? "Publishing worker is running" : "Publishing worker is not running — scheduled posts won't go out"}
            {w.simulated && <span className="font-normal text-orange-800"> · simulated publishing, nothing is sent to the platforms</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {w.running ? (
              `Checks the queue every ${w.intervalSec} seconds${w.mode === "PROCESS" ? " in its own process" : w.mode === "INLINE" ? " inside the web server" : ""}`
            ) : (
              <>
                Start it with <code className="rounded bg-muted px-1 font-mono text-xs">npm run worker</code>, or trigger{" "}
                <code className="rounded bg-muted px-1 font-mono text-xs">POST /api/cron/publish</code> from a scheduler
              </>
            )}
            {" · "}
            {w.lastRunAgo ? `last publish attempt ${w.lastRunAgo}` : "no publish attempts yet"}
            {w.autoRetry ? ` · auto-retry: up to ${w.maxRetries} attempts, ${w.retryDelayMinutes} min apart` : " · automatic retry is off"}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-1 text-center md:gap-4">
        {stats.map((s) => (
          <Link key={s.label} href={queueHref({ status: s.tab })} scroll={false} className="rounded-lg px-1.5 py-1 transition-colors hover:bg-olive-50">
            <p className={cn("text-lg font-semibold tabular-nums", s.className)}>{s.value}</p>
            <p className="text-xs whitespace-nowrap text-muted-foreground">{s.label}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function FailedCallouts({ d }: { d: QueueData }) {
  return (
    <section className="space-y-3" aria-label="Failed posts">
      {d.failed.map((r) => (
        <div key={r.id} className="flex flex-col gap-4 rounded-2xl border border-rose-200 bg-white p-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ContentThumb src={r.content.thumbUrl} seed={r.content.id} icon={thumbIconFor(r.content)} className="h-12 w-20" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge def={ScheduleStatus} value={r.status} />
                <span className="text-xs text-muted-foreground">{r.when}</span>
              </div>
              <Link href={`/content/${r.content.id}?tab=publishing`} className="mt-1 block truncate text-sm font-medium hover:text-primary">
                {r.content.title}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1.5">
                  <PlatformIcon platform={r.platformId} size={12} />
                  <span className="truncate">{r.platformName} · {r.account.name}</span>
                </span>
                <StatusBadge def={AccountStatus} value={r.account.status} size="sm" />
              </div>
            </div>
          </div>
          {r.lastError && (
            <p className="rounded-lg border border-rose-100 bg-rose-50 p-2.5 font-mono text-xs break-words text-rose-800 lg:max-w-sm">{r.lastError}</p>
          )}
          <FailedActions id={r.id} status={r.status} accountConnected={r.account.status === "CONNECTED"} />
        </div>
      ))}
      {d.failedMore > 0 && (
        <Link href={queueHref({ status: "failed" })} className="inline-block text-sm font-medium text-rose-700 hover:underline">
          +{d.failedMore} more failed post{d.failedMore === 1 ? "" : "s"} — view all
        </Link>
      )}
    </section>
  );
}

function QueueTabs({ d }: { d: QueueData }) {
  return (
    <div className="thin-scroll min-w-0 overflow-x-auto">
      <nav aria-label="Queue status" className="inline-flex gap-1 rounded-xl border border-[#ebe7c6] bg-secondary p-[3px]">
        {d.tabs.map((t) => {
          const active = t.key === d.params.status;
          return (
            <Link
              key={t.key}
              href={queueHref({ ...d.params, status: t.key })}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                active ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className={cn("text-xs tabular-nums", t.key === "failed" && t.count > 0 ? "text-rose-700" : "text-muted-foreground")}>{t.count}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function QueueTable({ d }: { d: QueueData }) {
  // Rows arrive sorted by time, so each local day is one contiguous group
  const groups: { day: string; label: string; rows: QueueRow[] }[] = [];
  for (const r of d.rows) {
    const last = groups.at(-1);
    if (last?.day === r.day) last.rows.push(r);
    else groups.push({ day: r.day, label: r.group, rows: [r] });
  }
  return (
    <>
      <div className="thin-scroll overflow-x-auto">
        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr className="text-left text-xs text-muted-foreground *:border-b *:border-[#eeebd8] *:bg-[#fcfbf3] *:px-3.5 *:py-2.5 *:font-medium *:whitespace-nowrap">
              <th scope="col">Scheduled time</th>
              <th scope="col">Content</th>
              <th scope="col">Platform &amp; account</th>
              <th scope="col">Visibility</th>
              <th scope="col">Status</th>
              <th scope="col">Attempts</th>
              <th scope="col" className="text-right">Actions</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.day}>
              <tr>
                <th scope="rowgroup" colSpan={7} className="border-b border-[#f3f1e4] bg-[#fcfbf3] px-3.5 py-2 text-left text-xs font-semibold text-stone-600">
                  {g.label}
                </th>
              </tr>
              {g.rows.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {d.tabTotal > d.rows.length && (
        <p className="border-t border-[#f1eedf] px-4 py-2.5 text-xs text-muted-foreground">
          Showing {d.rows.length} of {d.tabTotal} posts — filter by platform or account to narrow the list.
        </p>
      )}
    </>
  );
}

function Row({ r }: { r: QueueRow }) {
  const connected = r.account.status === "CONNECTED";
  return (
    <tr className="transition-colors hover:bg-[#fdfcf4] *:border-b *:border-[#f3f1e4] *:px-3.5 *:py-3 *:align-middle">
      <td className="whitespace-nowrap" title={r.setIn ? `Scheduled as ${r.setIn}` : undefined}>
        <p className="font-medium tabular-nums">{r.time}</p>
        <p className="text-xs text-muted-foreground">{r.zone}</p>
      </td>
      <td>
        <Link href={`/content/${r.content.id}?tab=publishing`} className="flex items-center gap-3 hover:text-primary">
          <ContentThumb src={r.content.thumbUrl} seed={r.content.id} icon={thumbIconFor(r.content)} durationSec={r.content.durationSec} className="h-10 w-16" />
          <span className="line-clamp-2 max-w-[240px] min-w-[160px] font-medium">{r.content.title}</span>
        </Link>
      </td>
      <td>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Avatar className="size-7">
            {r.account.avatarUrl && <AvatarImage src={r.account.avatarUrl} alt="" />}
            <AvatarFallback className="bg-olive-100 text-xs font-semibold text-olive-800">{r.account.initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm">{r.account.name}</p>
            <PlatformLabel platform={r.platformId} size={12} className="text-xs" />
            {!connected && <StatusBadge def={AccountStatus} value={r.account.status} size="sm" className="mt-0.5" />}
          </div>
        </div>
      </td>
      <td className="max-w-[150px] text-stone-600">{r.visibility}</td>
      <td>
        <StatusCell r={r} />
      </td>
      <td>
        <Attempts r={r} />
      </td>
      <td>
        <RowActions id={r.id} status={r.status} accountConnected={connected} externalUrl={r.externalUrl} />
      </td>
    </tr>
  );
}

function StatusCell({ r }: { r: QueueRow }) {
  const showError = (r.status === "FAILED" || r.status === "RETRY_SCHEDULED") && r.lastError;
  return (
    <div className="min-w-[150px]">
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge def={ScheduleStatus} value={r.status} label={scheduleLabel(r.status, r.simulated)} />
        {r.override && (
          <span title={`Scheduled before Ready to Post. Reason: ${r.override}`}>
            <StatusBadge tone="warn" label="Override" size="sm" />
          </span>
        )}
      </div>
      {r.nextAttempt && <p className="mt-1 text-xs whitespace-nowrap text-orange-700">Next attempt {r.nextAttempt}</p>}
      {showError && (
        <p className="mt-0.5 max-w-[190px] truncate text-xs text-muted-foreground" title={r.lastError ?? undefined}>
          {r.lastError}
        </p>
      )}
      {r.overdue && <p className="mt-1 text-xs text-amber-700">Due — goes out on the next worker run</p>}
      {r.publishedAgo && (
        <p className="mt-1 text-xs text-muted-foreground">
          {r.simulated ? "Simulated" : "Published"} {r.publishedAgo}
        </p>
      )}
    </div>
  );
}

function Attempts({ r }: { r: QueueRow }) {
  if (!r.jobCount) return <span className="pl-2.5 text-muted-foreground tabular-nums">{r.attempts}</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="tabular-nums" aria-label={`${r.attempts} attempts — show history`} title="Attempt history">
          {r.attempts}
          <History className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="border-b border-[#f1eedf] px-3.5 py-2.5">
          <p className="text-sm font-semibold">Attempt history</p>
          <p className="text-xs text-muted-foreground">
            {r.jobCount} run{r.jobCount === 1 ? "" : "s"}
            {r.jobCount > r.jobs.length ? ` · latest ${r.jobs.length} shown` : ""}
          </p>
        </div>
        <ol className="thin-scroll max-h-72 divide-y divide-[#f3f1e4] overflow-y-auto">
          {r.jobs.map((j) => {
            return (
              <li key={j.id} className="space-y-1 px-3.5 py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Attempt #{j.attempt}</span>
                  <StatusBadge def={JobStatus} value={j.status} size="sm" />
                </div>
                <p className="text-muted-foreground">
                  Started {j.started}
                  {j.finished ? ` · finished ${j.finished} (${j.took})` : " · still running"}
                </p>
                {j.error && <p className="rounded-md border border-rose-100 bg-rose-50 p-1.5 font-mono text-xs break-words text-rose-800">{j.error}</p>}
              </li>
            );
          })}
        </ol>
      </PopoverContent>
    </Popover>
  );
}

const EMPTY: Record<QueueTab, { title: string; description: string }> = {
  upcoming: { title: "Nothing in the queue", description: "Schedule a ready video and it will show up here." },
  failed: { title: "No failed posts", description: "Everything went out as planned." },
  published: { title: "Nothing published yet", description: "Published posts show up here with a link to the live post." },
  cancelled: { title: "No cancelled posts", description: "Cancelled posts stay here so you can reschedule them later." },
  all: { title: "No posts yet", description: "Schedule a ready video to start your publishing queue." },
};

function QueueEmpty({ d }: { d: QueueData }) {
  const tab = d.params.status;
  const copy = EMPTY[tab];
  const filteredOut = d.isFiltered && d.tabTotalUnfiltered > 0;
  return (
    <EmptyState
      icon={tab === "failed" ? <CircleCheck /> : <Inbox />}
      title={filteredOut ? "No posts match these filters" : copy.title}
      description={filteredOut ? "Try another platform or account, or clear the filters." : copy.description}
      action={
        filteredOut ? (
          <Button variant="outline" className="bg-white" asChild>
            <Link href={queueHref({ status: tab })} scroll={false}>Clear filters</Link>
          </Button>
        ) : tab === "upcoming" || tab === "all" ? (
          <ScheduleButton contentId={null}>
            <CalendarPlus />
            Schedule post
          </ScheduleButton>
        ) : undefined
      }
    />
  );
}

function QueueSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-card md:flex-row md:items-center">
        <div className="flex flex-1 items-center gap-3">
          <Skeleton className="size-2.5 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </div>
        <div className="grid grid-cols-5 gap-1 md:gap-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex flex-col items-center gap-1 px-1.5 py-1">
              <Skeleton className="h-6 w-8" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Skeleton className="h-9 w-[440px] max-w-full rounded-xl" />
        <div className="flex gap-2 lg:ml-auto">
          <Skeleton className="h-9 w-[150px]" />
          <Skeleton className="h-9 w-[170px]" />
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
        <Skeleton className="h-10 rounded-none" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-[#f3f1e4] px-4 py-3 last:border-0">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-10 w-16" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </>
  );
}
