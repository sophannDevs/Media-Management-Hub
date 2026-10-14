"use client";

import { CalendarClock, ChartColumn, ExternalLink, KeyRound, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useScheduleDialog } from "@/components/app/schedule-dialog";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { cancelScheduleAction, retryScheduleAction } from "@/server/actions/schedule";

interface ActionProps {
  id: string;
  status: string;
  accountConnected: boolean;
  externalUrl?: string | null;
}

const CANCEL_COPY = {
  title: "Cancel this post?",
  description: "It will be removed from the queue. You can schedule it again anytime.",
  confirmLabel: "Cancel post",
};

/** Row actions in the queue table. */
export function RowActions({ id, status, externalUrl }: ActionProps) {
  const { run, pending } = useServerAction();
  const { openSchedule } = useScheduleDialog();

  if (status === "PUBLISHED") {
    return (
      <div className="flex justify-end gap-1">
        {externalUrl && (
          <Button variant="ghost" size="sm" asChild>
            <a href={externalUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              View post
            </a>
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <Link href="/analytics">
            <ChartColumn />
            Stats
          </Link>
        </Button>
      </div>
    );
  }
  if (status === "PROCESSING") {
    return <p className="text-right text-xs text-muted-foreground">Publishing now…</p>;
  }

  const failed = status === "FAILED" || status === "RETRY_SCHEDULED";
  const editLabel = status === "WAITING" ? "Edit schedule" : "Reschedule";
  return (
    <div className="flex items-center justify-end gap-1">
      {failed && (
        <Button variant="outline" size="sm" className="bg-white" disabled={pending} onClick={() => run(() => retryScheduleAction(id))}>
          <RefreshCw className={cn(pending && "animate-spin")} />
          Retry
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" title={editLabel} aria-label={editLabel} disabled={pending} onClick={() => openSchedule({ scheduleId: id })}>
        <CalendarClock />
      </Button>
      {status !== "CANCELLED" && (
        <ConfirmDialog {...CANCEL_COPY} onConfirm={() => run(() => cancelScheduleAction(id))}>
          <Button variant="ghost" size="icon-sm" title="Cancel post" aria-label="Cancel post" disabled={pending}>
            <X />
          </Button>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Actions on a failed-post callout: Reconnect (when needed), Retry, Reschedule, Cancel. */
export function FailedActions({ id, accountConnected }: ActionProps) {
  const { run, pending } = useServerAction();
  const { openSchedule } = useScheduleDialog();
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {!accountConnected && (
        <Button asChild>
          <Link href="/accounts">
            <KeyRound />
            Reconnect
          </Link>
        </Button>
      )}
      <Button variant={accountConnected ? "default" : "outline"} className={cn(!accountConnected && "bg-white")} disabled={pending} onClick={() => run(() => retryScheduleAction(id))}>
        <RefreshCw className={cn(pending && "animate-spin")} />
        {pending ? "Retrying…" : "Retry"}
      </Button>
      <Button variant="outline" className="bg-white" disabled={pending} onClick={() => openSchedule({ scheduleId: id })}>
        <CalendarClock />
        Reschedule
      </Button>
      <ConfirmDialog {...CANCEL_COPY} onConfirm={() => run(() => cancelScheduleAction(id))}>
        <Button variant="ghost" disabled={pending}>
          <X />
          Cancel
        </Button>
      </ConfirmDialog>
    </div>
  );
}
