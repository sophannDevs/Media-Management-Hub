import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { type Actor, currentActor } from "../auth/actor";
import { getCurrentUser } from "../auth/dal";
import { requestContext } from "../request-context";

// The activity log (DB-05): every change with who made it (the signed-in
// user, the publishing worker or the system), what it was about (a content
// item, a schedule, a file, an account, the settings, a prompt, a label, a
// user), and the content item it belongs to when it has one.

export type EntityType = "CONTENT" | "SCHEDULE" | "MEDIA" | "ACCOUNT" | "SETTINGS" | "PROMPT" | "TAXONOMY" | "USER";

/**
 * Who is acting: the actor set for this call (Server Actions, the worker),
 * else the signed-in user of the request being served (Route Handlers), else
 * the system (setup, scripts, tests).
 */
export async function resolveActor(): Promise<Actor> {
  const set = currentActor();
  if (set) return set;
  if (requestContext()) {
    try {
      const user = await getCurrentUser();
      if (user) return { userId: user.id, source: "USER" };
    } catch {
      // not a request after all
    }
  }
  return { userId: null, source: "SYSTEM" };
}

/** What a row is about when the caller didn't say: schedules and posts, files, or the content item itself. */
function inferEntity(type: string, contentId: string | null | undefined, meta: Record<string, unknown> | undefined): { type: EntityType; id: string | null } {
  const str = (k: string) => (typeof meta?.[k] === "string" ? (meta[k] as string) : null);
  if (type.startsWith("schedule.") || type.startsWith("publish.")) return { type: "SCHEDULE", id: str("scheduleId") };
  if (type.startsWith("media.") || type.startsWith("video.")) return { type: "MEDIA", id: str("assetId") };
  return { type: "CONTENT", id: contentId ?? null };
}

export async function logActivity(input: {
  contentId?: string | null;
  type: string;
  message: string;
  meta?: Record<string, unknown>;
  /** What was changed; by default the content item (or the schedule / file named in `meta`) */
  entity?: { type: EntityType; id?: string | null };
  /** Who did it; by default the signed-in user, the worker in the worker, the system elsewhere */
  actor?: Partial<Actor>;
}) {
  const who = { ...(await resolveActor()), ...input.actor };
  const entity = input.entity ?? inferEntity(input.type, input.contentId, input.meta);
  await db.activityLog.create({
    data: {
      contentId: input.contentId ?? null,
      actorId: who.userId,
      source: who.source,
      entityType: entity.type,
      entityId: entity.id ?? null,
      type: input.type,
      message: input.message,
      meta: (input.meta ?? {}) as Prisma.InputJsonObject,
    },
  });
}
