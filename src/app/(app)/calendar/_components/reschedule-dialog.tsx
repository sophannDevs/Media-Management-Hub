"use client";

import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CalendarEvent } from "@/server/queries/calendar";

/**
 * Move one post to a date and time you type or pick (A11Y-04): the way to
 * reschedule from the calendar without dragging, on a touch screen or with a
 * screen reader. Times are in the workspace's time zone.
 */
export function RescheduleDialog({
  event,
  tz,
  todayKey,
  onSubmit,
  onClose,
}: {
  event: CalendarEvent | null;
  tz: string;
  todayKey: string;
  /** Applies the move; returns false (after saying why) when it can't be done */
  onSubmit: (ev: CalendarEvent, date: string, time: string) => boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {/* Mounted per post, so the fields start from that post's slot */}
        {event && <RescheduleForm key={event.id} event={event} tz={tz} todayKey={todayKey} onSubmit={onSubmit} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function RescheduleForm({ event, tz, todayKey, onSubmit, onClose }: { event: CalendarEvent; tz: string; todayKey: string; onSubmit: (ev: CalendarEvent, date: string, time: string) => boolean; onClose: () => void }) {
  const [date, setDate] = useState(event.dayKey);
  const [time, setTime] = useState(event.time);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (date && time && onSubmit(event, date, time)) onClose();
      }}
    >
      <DialogHeader>
        <DialogTitle>Reschedule post</DialogTitle>
        <DialogDescription>
          “{event.content.title}” · currently {event.timeLabel}. Times are in {tz}.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="reschedule-date">Date</Label>
          <Input id="reschedule-date" type="date" required min={todayKey} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reschedule-time">Time</Label>
          <Input id="reschedule-time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!date || !time || (date === event.dayKey && time === event.time)}>
          <CalendarClock />
          Reschedule
        </Button>
      </DialogFooter>
    </form>
  );
}
