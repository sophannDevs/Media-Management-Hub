"use client";

import { CalendarClock, CalendarPlus, CalendarX, ChartColumn, ChevronDown, CircleAlert, CircleCheck, CircleX, ExternalLink, Pencil, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, Panel } from "@/components/app/content-bits";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { PlatformIcon } from "@/components/app/platform-icon";
import { useScheduleDialog } from "@/components/app/schedule-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { useRetrySchedule } from "@/components/app/use-retry-schedule";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { AccountStatus, ScheduleStatus, scheduleLabel } from "@/lib/workflow/statuses";
import { cancelScheduleAction, removeOverrideAction } from "@/server/actions/schedule";
import type { ContentWorkspace } from "@/server/queries/content";

type Schedule = ContentWorkspace["schedules"][number];

export function PublishingTab({ data }: { data: ContentWorkspace }) {
  const { openSchedule } = useScheduleDialog();
  const active = data.schedules.filter((s) => s.status !== "CANCELLED");
  const cancelled = data.schedules.filter((s) => s.status === "CANCELLED");
  const [showCancelled, setShowCancelled] = useState(false);
  const ready = data.workflow.ready;
  // Missing soft requirements can be waived per post in the dialog; hard ones can't (WF-01)
  const canSchedule = ready || !data.workflow.missing.some((m) => m.hard);

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-8">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Platform schedules</p>
          <Button size="sm" disabled={!canSchedule || data.content.archived} onClick={() => openSchedule({ contentId: data.content.id })} title={canSchedule ? undefined : "A final video file is required"}>
            <CalendarPlus />Add schedule
          </Button>
        </div>

        {active.length === 0 ? (
          <div className="rounded-2xl border bg-card shadow-card">
            <EmptyState
              icon={<CalendarPlus />}
              title="No schedules yet"
              description={ready ? "This video is ready — pick a platform, account and time." : "Finish the missing items, then schedule a post for each platform."}
              action={ready ? <Button onClick={() => openSchedule({ contentId: data.content.id })}><CalendarPlus />Schedule post</Button> : undefined}
            />
          </div>
        ) : (
          active.map((s) => <ScheduleCard key={s.id} s={s} />)
        )}

        {cancelled.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowCancelled((v) => !v)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronDown className={cn("size-4 transition-transform", showCancelled && "rotate-180")} />
              Cancelled ({cancelled.length})
            </button>
            {showCancelled && <div className="mt-3 space-y-3 opacity-80">{cancelled.map((s) => <ScheduleCard key={s.id} s={s} />)}</div>}
          </div>
        )}
      </div>

      <Panel className="self-start lg:col-span-4" title="Scheduling requirements">
        <ul className="space-y-2.5 p-4">
          {data.publishingChecks.map((c) => (
            <li key={c.label} className="flex items-start gap-2.5 text-sm">
              {c.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-rose-600" />}
              <span className={cn(!c.ok && "text-rose-800")}>{c.label}</span>
            </li>
          ))}
        </ul>
        {data.publishingChecks.some((c) => !c.ok && c.label.includes("account")) && (
          <div className="border-t border-[#f3f1e4] p-4">
            <Button variant="outline" size="sm" className="w-full" asChild><Link href="/accounts">Manage social accounts</Link></Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ScheduleCard({ s }: { s: Schedule }) {
  const { openSchedule } = useScheduleDialog();
  const { run, pending: running } = useServerAction();
  const { retry, pending, dialog } = useRetrySchedule();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [history, setHistory] = useState(false);
  const failed = s.status === "FAILED" || s.status === "RETRY_SCHEDULED";
  const editable = !["PUBLISHED", "PROCESSING"].includes(s.status);

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[#f1eedf] bg-[#fcfbf3]">
          <PlatformIcon platform={s.platformId} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{s.platformName}</p>
            <StatusBadge def={ScheduleStatus} value={s.status} label={scheduleLabel(s.status, s.simulated)} />
            {s.override && <StatusBadge tone="warn" label="Override" size="sm" />}
            {s.account.status !== "CONNECTED" && <StatusBadge def={AccountStatus} value={s.account.status} size="sm" />}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{s.account.name} · {s.visibilityLabel} · {s.timezone}</p>
          {s.title && <p className="mt-0.5 truncate text-xs text-stone-500">“{s.title}”</p>}
        </div>
        <div className="md:text-right">
          <p className="font-medium">{s.relative === "Today" || s.relative === "Tomorrow" ? `${s.relative}, ` : ""}{s.dateLabel}</p>
          <p className="text-sm text-muted-foreground">{s.timeLabel}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {s.status === "PUBLISHED" ? (
            <>
              {s.externalUrl && <Button variant="outline" size="sm" asChild><a href={s.externalUrl} target="_blank" rel="noreferrer"><ExternalLink />View post</a></Button>}
              <Button variant="ghost" size="sm" asChild><Link href="/analytics"><ChartColumn />Stats</Link></Button>
            </>
          ) : editable ? (
            <>
              <Button variant="outline" size="sm" onClick={() => openSchedule({ scheduleId: s.id })}><Pencil />{s.status === "CANCELLED" ? "Reschedule" : "Edit"}</Button>
              {s.status !== "CANCELLED" && (
                <Button variant="ghost" size="icon-sm" title="Cancel this post" aria-label="Cancel this post" onClick={() => setConfirmCancel(true)}><CalendarX /></Button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {s.override && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-950 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1">
            <span className="font-medium">Scheduled before Ready to Post{s.override.atLabel ? ` (${s.override.atLabel})` : ""}.</span> Reason: “{s.override.reason}”
          </p>
          {editable && (
            <Button variant="outline" size="sm" className="bg-white" disabled={running} onClick={() => run(() => removeOverrideAction(s.id))}>
              Remove override
            </Button>
          )}
        </div>
      )}

      {s.status === "PUBLISHED" && s.publishedLabel && (
        <p className="mt-3 text-xs text-muted-foreground">
          {s.simulated ? `Simulated publish ${s.publishedLabel}. Nothing was sent to ${s.platformName}.` : `Published ${s.publishedLabel}`}
        </p>
      )}

      {failed && s.lastError && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 sm:flex-row sm:items-center">
          <CircleAlert className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs break-words">{s.lastError}</p>
            {s.status === "RETRY_SCHEDULED" && s.nextAttemptLabel && <p className="mt-1 text-xs text-rose-700">Automatic retry at {s.nextAttemptLabel}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" className="bg-white" onClick={() => openSchedule({ scheduleId: s.id })}><CalendarClock />Reschedule</Button>
            <Button size="sm" disabled={pending} onClick={() => retry(s.id)}><RefreshCw className={cn(pending && "animate-spin")} />Retry now</Button>
          </div>
        </div>
      )}

      {s.jobs.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setHistory((v) => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-3.5 transition-transform", history && "rotate-180")} />
            {s.attempts} attempt{s.attempts === 1 ? "" : "s"}
          </button>
          {history && (
            <ul className="mt-2 space-y-1.5 rounded-xl bg-[#fcfbf3] p-3 text-xs">
              {s.jobs.map((j) => (
                <li key={j.id} className="flex gap-2">
                  <span className="w-16 shrink-0 font-medium">Attempt {j.attempt}</span>
                  <span className={cn("w-20 shrink-0", j.status === "FAILED" ? "text-rose-700" : j.status === "SUCCEEDED" ? "text-olive-700" : "text-amber-700")}>{j.status.toLowerCase()}</span>
                  <span className="w-36 shrink-0 text-muted-foreground">{j.startedLabel}</span>
                  {j.error && <span className="min-w-0 truncate font-mono text-rose-800" title={j.error}>{j.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialog}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Cancel this ${s.platformName} post?`}
        description="It is removed from the publishing queue. The content stays Ready to Post and you can schedule it again."
        confirmLabel="Cancel post"
        onConfirm={() => run(() => cancelScheduleAction(s.id))}
      />
    </div>
  );
}
