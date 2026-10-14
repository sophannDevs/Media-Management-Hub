"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ContentType, Priority } from "@/lib/workflow/statuses";
import * as content from "../services/content";
import * as imagePrompt from "../services/image-prompt";
import * as script from "../services/script";
import * as views from "../services/views";
import { currentUserId } from "../auth/actor";
import { requireActionUser } from "../auth/dal";
import { type ActionResult, ServiceError } from "../errors";
import { id, ids, runAction } from "./_run";

const optionalId = z.string().nullish().transform((v) => v || null);
const dateOnly = z
  .string()
  .nullish()
  .transform((v) => (v ? new Date(`${v}T12:00:00Z`) : null));

const contentSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200, "Title is too long."),
  idea: z.string().max(5000).default(""),
  description: z.string().max(10000).default(""),
  contentType: z.enum(ContentType.codes as [string, ...string[]]).default("LONG_FORM"),
  categoryId: optionalId,
  tags: z.string().max(500).default(""),
  targetAudience: z.string().max(200).default(""),
  language: z.string().max(50).default("English"),
  platforms: z.array(z.string()).default([]),
  priority: z.enum(Priority.codes as [string, ...string[]]).default("MEDIUM"),
  targetPublishDate: dateOnly,
  seriesId: optionalId,
  campaignId: optionalId,
  hashtags: z.string().max(1000).default(""),
});
export type ContentFormValues = z.input<typeof contentSchema>;

export async function createContentAction(input: ContentFormValues) {
  return runAction(contentSchema, input, async (data) => (await content.createContent(data)).id, "Content created");
}

export async function updateContentAction(contentId: string, input: Partial<ContentFormValues>) {
  return runAction(
    z.object({ id, data: contentSchema.partial() }),
    { id: contentId, data: input },
    ({ id, data }) => content.updateContent(id, data),
    "Saved",
  );
}

const statusField = z.enum(["scriptStatus", "imageStatus", "videoStatus", "reviewStatus"]);

export async function setStatusAction(contentId: string, field: content.StatusField, value: string) {
  return runAction(
    z.object({ id, field: statusField, value: z.string() }),
    { id: contentId, field, value },
    ({ id, field, value }) => content.setProductionStatus(id, field, value),
    `${content.STATUS_FIELDS[field]?.label ?? "Status"} updated`,
  );
}

export async function setChecklistFlagAction(contentId: string, key: "titleFinalized" | "descriptionFinalized", value: boolean) {
  return runAction(
    z.object({ id, key: z.enum(["titleFinalized", "descriptionFinalized"]), value: z.boolean() }),
    { id: contentId, key, value },
    ({ id, key, value }) => content.setChecklistFlag(id, key, value),
  );
}

export async function duplicateContentAction(contentId: string) {
  return runAction(id, contentId, async (id) => (await content.duplicateContent(id)).id, "Duplicated as a new draft");
}

export async function archiveContentAction(contentIds: string[]) {
  return runAction(ids, contentIds, (ids) => content.archiveContents(ids), (r) => {
    const what = contentIds.length === 1 ? "Archived" : `Archived ${contentIds.length} items`;
    return r.cancelled ? `${what} — ${r.cancelled} post${r.cancelled === 1 ? "" : "s"} taken out of the queue` : what;
  });
}

/** Restore from the archive; with `withPosts` the posts archiving cancelled go back in the queue (WF-07). */
export async function restoreContentAction(contentIds: string[], withPosts = true) {
  return runAction(
    z.object({ ids, withPosts: z.boolean() }),
    { ids: contentIds, withPosts },
    ({ ids, withPosts }) => content.restoreContents(ids, withPosts),
    (r) => {
      const notes = [
        r.restored && `${r.restored} post${r.restored === 1 ? "" : "s"} back in the queue`,
        r.expired && `${r.expired} past ${r.expired === 1 ? "its" : "their"} time ${r.expired === 1 ? "stays" : "stay"} cancelled`,
        r.conflicts && `${r.conflicts} replaced by newer posts ${r.conflicts === 1 ? "stays" : "stay"} cancelled`,
      ].filter(Boolean);
      return notes.length ? `Restored — ${notes.join(", ")}` : "Restored";
    },
  );
}

export async function deleteContentAction(contentIds: string[]) {
  return runAction(ids, contentIds, (ids) => content.deleteContents(ids), `Deleted ${contentIds.length} item(s)`);
}

/** Deletes one content item and navigates back to the list (used from the workspace page). */
export async function deleteContentAndRedirectAction(contentId: string): Promise<ActionResult> {
  const parsed = id.safeParse(contentId);
  if (!parsed.success) return { ok: false, error: "Invalid content." };
  try {
    await requireActionUser();
    await content.deleteContents([parsed.data]);
  } catch (e) {
    if (e instanceof ServiceError) return { ok: false, error: e.message, code: e.code };
    throw e;
  }
  redirect("/content");
}

export async function bulkCategoryAction(contentIds: string[], categoryId: string | null) {
  return runAction(z.object({ ids, categoryId: optionalId }), { ids: contentIds, categoryId }, ({ ids, categoryId }) => content.bulkSetCategory(ids, categoryId), "Category updated");
}

export async function bulkTagAction(contentIds: string[], tag: string) {
  return runAction(z.object({ ids, tag: z.string().trim().min(1, "Enter a tag.") }), { ids: contentIds, tag }, ({ ids, tag }) => content.bulkAddTag(ids, tag), "Tag added");
}

export async function bulkStatusAction(contentIds: string[], field: content.StatusField, value: string) {
  return runAction(
    z.object({ ids, field: statusField, value: z.string() }),
    { ids: contentIds, field, value },
    ({ ids, field, value }) => content.bulkSetStatus(ids, field, value),
    (r) => (r.errors.length ? `Updated ${r.updated}, skipped ${contentIds.length - r.updated}: ${r.errors[0]}` : `Updated ${r.updated} item(s)`),
  );
}

// ---------- Saved views (UX-02) ----------

/** The signed-in user an action runs as (set by runAction). */
function actingUser() {
  const id = currentUserId();
  if (!id) throw new ServiceError("Sign in again to save views.", undefined, "UNAUTHENTICATED");
  return id;
}

export async function saveViewAction(name: string, query: string) {
  return runAction(
    z.object({ name: z.string().trim().min(1, "Give the view a name.").max(60, "Keep the name under 60 characters."), query: z.string().max(2000) }),
    { name, query },
    ({ name, query }) => views.saveView(actingUser(), name, query),
    (v) => `Saved view “${v.name}”`,
  );
}

export async function deleteViewAction(viewId: string) {
  return runAction(id, viewId, (id) => views.deleteView(actingUser(), id), "View deleted");
}

// ---------- Script ----------

export async function saveScriptAction(contentId: string, body: string, note?: string, source: "MANUAL" | "PASTE" = "MANUAL") {
  return runAction(
    z.object({ id, body: z.string().max(200_000), note: z.string().max(200).optional(), source: z.enum(["MANUAL", "PASTE"]) }),
    { id: contentId, body, note, source },
    ({ id, body, note, source }) => script.saveScriptVersion(id, body, { note, source }),
    (r) => `Saved as version ${r.version}`,
  );
}

export async function restoreScriptVersionAction(versionId: string) {
  return runAction(id, versionId, (id) => script.restoreScriptVersion(id), (r) => `Restored as version ${r.version}`);
}

export async function generateScriptAction(contentId: string, promptId?: string | null) {
  return runAction(
    z.object({ id, promptId: optionalId }),
    { id: contentId, promptId },
    ({ id, promptId }) => script.generateScriptWithClaude(id, promptId),
    (r) => (r.mock ? `Mock draft saved as v${r.version} — add ANTHROPIC_API_KEY for real generation` : `Claude draft saved as v${r.version}`),
  );
}

// ---------- Image prompt ----------

export async function saveImagePromptAction(
  contentId: string,
  input: { prompt: string; negativePrompt?: string; style?: string; aspectRatio?: string; provider?: string },
) {
  return runAction(
    z.object({
      id,
      data: z.object({
        prompt: z.string().max(10000),
        negativePrompt: z.string().max(5000).optional(),
        style: z.string().max(50).optional(),
        aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5", "3:2"]).optional(),
        provider: z.enum(["GOOGLE_AI_STUDIO", "GOOGLE_FLOW", "OTHER"]).optional(),
      }),
    }),
    { id: contentId, data: input },
    ({ id, data }) => imagePrompt.saveImagePrompt(id, data),
    "Image prompt saved",
  );
}
