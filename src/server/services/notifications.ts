import { db } from "@/lib/db";
import type { NotificationTypeCode } from "@/lib/workflow/statuses";
import { getSettings, notificationPrefs } from "./settings";

/** Creates an in-app notification unless disabled in settings or already sent (dedupeKey). */
export async function notify(input: {
  type: NotificationTypeCode;
  title: string;
  message: string;
  href?: string;
  dedupeKey?: string;
}) {
  const prefs = notificationPrefs(await getSettings());
  if (prefs[input.type] === false) return;
  if (input.dedupeKey) {
    const exists = await db.notification.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } });
    if (exists) return;
  }
  await db.notification.create({ data: { ...input, dedupeKey: input.dedupeKey ?? null, href: input.href ?? null } });
}

export async function markNotificationsRead(ids?: string[]) {
  await db.notification.updateMany({
    where: { readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}
