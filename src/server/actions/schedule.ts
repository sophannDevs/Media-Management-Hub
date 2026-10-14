"use server";

import { z } from "zod";
import { tick } from "../worker";
import * as publishing from "../services/publishing";
import * as schedule from "../services/schedule";
import { id, runAction } from "./_run";

const scheduleSchema = z.object({
  contentId: id,
  platformId: z.string().min(1, "Select a platform."),
  accountId: z.string().min(1, "Select a social account."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time."),
  timezone: z.string().min(1),
  title: z.string().trim().min(1, "Title is required."),
  caption: z.string().default(""),
  hashtags: z.string().default(""),
  thumbnailAssetId: z.string().nullish(),
  visibility: z.string().optional(),
});
export type ScheduleFormValues = z.input<typeof scheduleSchema>;

export async function createScheduleAction(input: ScheduleFormValues) {
  return runAction(scheduleSchema, input, async (d) => (await schedule.createSchedule(d)).id, "Post scheduled — added to the publishing queue");
}

export async function updateScheduleAction(scheduleId: string, input: ScheduleFormValues) {
  return runAction(z.object({ id, data: scheduleSchema }), { id: scheduleId, data: input }, ({ id, data }) => schedule.updateSchedule(id, data), "Schedule updated");
}

export async function rescheduleAction(scheduleId: string, scheduledAtIso: string) {
  return runAction(
    z.object({ id, at: z.iso.datetime({ offset: true }) }),
    { id: scheduleId, at: scheduledAtIso },
    ({ id, at }) => schedule.reschedule(id, new Date(at)),
    "Rescheduled",
  );
}

export async function cancelScheduleAction(scheduleId: string) {
  return runAction(id, scheduleId, (id) => schedule.cancelSchedule(id), "Post cancelled");
}

/** Re-queues a failed post and publishes it right away. */
export async function retryScheduleAction(scheduleId: string) {
  return runAction(
    id,
    scheduleId,
    async (id) => {
      await schedule.retrySchedule(id);
      return publishing.processSchedule(id);
    },
    (r) => (r === "published" ? "Published successfully" : r === "retry" ? "Still failing — another retry is scheduled" : r === "failed" ? "Publishing failed again — see the error" : "Queued"),
  );
}

/** Runs the publishing worker now (instead of waiting for the next tick). */
export async function runQueueNowAction() {
  return runAction(z.undefined(), undefined, async () => tick(), (s) => (s ? `Processed ${s.processed} post(s)` : "Worker is already running"));
}
