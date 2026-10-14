"use client";

import { CalendarDays, CalendarPlus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useScheduleDialog } from "@/components/app/schedule-dialog";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { runQueueNowAction } from "@/server/actions/schedule";

export function QueueHeaderActions() {
  const { run, pending } = useServerAction();
  const { openSchedule } = useScheduleDialog();
  return (
    <>
      <Button variant="outline" size="lg" className="bg-white" asChild>
        <Link href="/calendar">
          <CalendarDays />
          Calendar
        </Link>
      </Button>
      <Button variant="outline" size="lg" className="bg-white" disabled={pending} onClick={() => run(() => runQueueNowAction())}>
        <RefreshCw className={cn(pending && "animate-spin")} />
        {pending ? "Running…" : "Run queue now"}
      </Button>
      <Button size="lg" onClick={() => openSchedule()}>
        <CalendarPlus />
        Schedule post
      </Button>
    </>
  );
}
