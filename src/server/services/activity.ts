import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export async function logActivity(input: { contentId?: string | null; type: string; message: string; meta?: Record<string, unknown> }) {
  await db.activityLog.create({
    data: {
      contentId: input.contentId ?? null,
      type: input.type,
      message: input.message,
      meta: (input.meta ?? {}) as Prisma.InputJsonObject,
    },
  });
}
