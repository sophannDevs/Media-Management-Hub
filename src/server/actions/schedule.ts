"use server";

import { z } from "zod";
import { nudgeWorker } from "../worker";
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
  idempotencyKey: z.string().min(8).max(64).optional(),
  repost: z.boolean().optional(),
  override: z.object({ reason: z.string().trim().max(500) }).nullish(),
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

/** Removes a post's override of soft requirements (WF-01). */
export async function removeOverrideAction(scheduleId: string) {
  return runAction(id, scheduleId, (id) => schedule.removeOverride(id), "Override removed — the post needs every requirement again");
}

export async function cancelScheduleAction(scheduleId: string) {
  return runAction(id, scheduleId, (id) => schedule.cancelSchedule(id), "Post cancelled");
}

const queuedMessage = (n: { inProcess: boolean; withinSeconds: number }) =>
  n.inProcess ? "Sending now — the status updates on its own" : `Queued — the publishing worker sends it within ${n.withinSeconds} seconds`;

/**
 * Re-queues a failed post (PUB-06). Answers at once: the upload happens in the
 * worker, never inside this request, and the page shows the status as it changes.
 */
export async function retryScheduleAction(scheduleId: string, opts: { confirmUnknownOutcome?: boolean } = {}) {
  return runAction(
    z.object({ id, confirmUnknownOutcome: z.boolean().optional() }),
    { id: scheduleId, ...opts },
    async ({ id, confirmUnknownOutcome }) => {
      await schedule.retrySchedule(id, { confirmUnknownOutcome });
      return nudgeWorker();
    },
    queuedMessage,
  );
}

/** Asks the worker to look at the queue now instead of at its next check. Doesn't wait for it. */
export async function runQueueNowAction() {
  return runAction(z.undefined(), undefined, async () => nudgeWorker(), (n) =>
    n.inProcess ? "Checking the queue now" : `The publishing worker checks the queue every ${n.withinSeconds} seconds`,
  );
}
