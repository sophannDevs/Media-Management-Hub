import { AiGenerationError, generateScript } from "@/lib/ai/claude";
import { db } from "@/lib/db";
import { wordCount } from "@/lib/workflow/rules";
import { ActivityType } from "@/lib/workflow/statuses";
import { ServiceError } from "../errors";
import { logActivity } from "./activity";
import { syncPublishingStatus } from "./content";

async function ensureScript(contentId: string) {
  return db.script.upsert({ where: { contentId }, update: {}, create: { contentId } });
}

/** Saves the script text as a new version. */
export async function saveScriptVersion(
  contentId: string,
  body: string,
  opts: { note?: string; source?: "MANUAL" | "PASTE" | "CLAUDE" } = {},
) {
  const content = await db.content.findUnique({ where: { id: contentId }, select: { scriptStatus: true } });
  if (!content) throw new ServiceError("Content not found.");
  if (!body.trim()) throw new ServiceError("The script is empty.");

  const script = await ensureScript(contentId);
  const version = script.currentVersion + 1;
  // Editing an approved script sends it back for review
  const nextStatus =
    content.scriptStatus === "NOT_STARTED" || content.scriptStatus === "GENERATING" || content.scriptStatus === "APPROVED"
      ? "GENERATED"
      : content.scriptStatus;
  const changed = body !== script.body;
  if (!changed && script.currentVersion > 0) throw new ServiceError("No changes since the last version.");

  await db.$transaction([
    db.scriptVersion.create({
      data: { scriptId: script.id, version, body, note: opts.note ?? "", wordCount: wordCount(body), status: nextStatus, source: opts.source ?? "MANUAL" },
    }),
    db.script.update({ where: { id: script.id }, data: { body, currentVersion: version } }),
    db.content.update({ where: { id: contentId }, data: { scriptStatus: nextStatus } }),
  ]);
  await logActivity({
    contentId,
    type: opts.source === "CLAUDE" ? ActivityType.SCRIPT_GENERATED : ActivityType.SCRIPT_SAVED,
    message: opts.source === "CLAUDE" ? `Script v${version} generated with Claude` : `Script v${version} saved${opts.note ? ` — ${opts.note}` : ""}`,
  });
  await syncPublishingStatus(contentId);
  return { version };
}

export async function restoreScriptVersion(versionId: string) {
  const v = await db.scriptVersion.findUnique({ where: { id: versionId }, include: { script: true } });
  if (!v) throw new ServiceError("Version not found.");
  return saveScriptVersion(v.script.contentId, v.body, { note: `Restored from v${v.version}` });
}

export async function generateScriptWithClaude(contentId: string, promptId?: string | null) {
  const content = await db.content.findUnique({ where: { id: contentId }, select: { title: true, idea: true, description: true, targetAudience: true, language: true, contentType: true, scriptStatus: true } });
  if (!content) throw new ServiceError("Content not found.");
  const template = promptId ? (await db.aiPrompt.findUnique({ where: { id: promptId } }))?.content : null;

  const previous = content.scriptStatus;
  await db.content.update({ where: { id: contentId }, data: { scriptStatus: "GENERATING" } });
  try {
    const result = await generateScript({
      title: content.title,
      idea: content.idea,
      description: content.description,
      audience: content.targetAudience,
      language: content.language,
      contentType: content.contentType,
      template,
    });
    await db.content.update({ where: { id: contentId }, data: { scriptStatus: previous === "APPROVED" ? "APPROVED" : previous } });
    const saved = await saveScriptVersion(contentId, result.body, {
      source: "CLAUDE",
      note: result.source === "MOCK" ? "Mock draft (no API key)" : `Generated with ${result.model}`,
    });
    return { ...saved, mock: result.source === "MOCK" };
  } catch (e) {
    await db.content.update({ where: { id: contentId }, data: { scriptStatus: previous } });
    if (e instanceof AiGenerationError) throw new ServiceError(e.message);
    throw e;
  }
}
