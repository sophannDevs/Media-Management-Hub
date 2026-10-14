import { db } from "@/lib/db";
import type { WorkflowRules } from "@/lib/workflow/rules";

export async function getSettings() {
  return (await db.workspaceSettings.findUnique({ where: { id: 1 } })) ?? db.workspaceSettings.create({ data: { id: 1 } });
}

export type Settings = Awaited<ReturnType<typeof getSettings>>;

export function rulesFrom(s: Settings): WorkflowRules {
  return {
    requireScriptApproved: s.requireScriptApproved,
    requireImagesApproved: s.requireImagesApproved,
    requireFinalVideo: s.requireFinalVideo,
    requireReview: s.requireReview,
    requireThumbnail: s.requireThumbnail,
  };
}

export async function getRules() {
  return rulesFrom(await getSettings());
}

export function notificationPrefs(s: Settings): Record<string, boolean> {
  const prefs = s.notificationPrefs;
  return prefs && typeof prefs === "object" && !Array.isArray(prefs) ? (prefs as Record<string, boolean>) : {};
}
