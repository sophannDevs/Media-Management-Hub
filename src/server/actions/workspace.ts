"use server";

import { z } from "zod";
import { AiProvider, PromptCategory } from "@/lib/workflow/statuses";
import * as ws from "../services/workspace";
import { id, runAction } from "./_run";

// ---------- Social accounts ----------

export async function connectAccountAction(input: { platformId: string; name: string; handle?: string; followers?: number }) {
  return runAction(
    z.object({
      platformId: z.string().min(1),
      name: z.string().trim().min(1, "Name is required.").max(100),
      handle: z.string().max(100).optional(),
      followers: z.number().int().min(0).optional(),
    }),
    input,
    async (d) => (await ws.connectAccount(d)).id,
    "Account connected",
  );
}

export async function reconnectAccountAction(accountId: string) {
  return runAction(id, accountId, (id) => ws.reconnectAccount(id).then(() => undefined), "Account reconnected");
}

export async function disconnectAccountAction(accountId: string) {
  return runAction(id, accountId, (id) => ws.disconnectAccount(id), "Account disconnected");
}

export async function syncAccountAction(accountId: string) {
  return runAction(id, accountId, (id) => ws.syncAccount(id), "Account synced");
}

export async function setDefaultAccountAction(accountId: string) {
  return runAction(id, accountId, (id) => ws.setDefaultAccount(id), "Default account updated");
}

export async function deleteAccountAction(accountId: string) {
  return runAction(id, accountId, (id) => ws.deleteAccount(id), (r) => (r.removed ? "Account removed" : "Account disconnected (kept for publishing history)"));
}

// ---------- Prompts ----------

const promptSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  category: z.enum(PromptCategory.codes as [string, ...string[]]),
  provider: z.enum(AiProvider.codes as [string, ...string[]]),
  content: z.string().trim().min(1, "Prompt content is required.").max(20000),
});
export type PromptFormValues = z.input<typeof promptSchema>;

export async function savePromptAction(promptId: string | null, input: PromptFormValues) {
  return runAction(
    z.object({ id: z.string().nullable(), data: promptSchema }),
    { id: promptId, data: input },
    async ({ id, data }) => (id ? ws.updatePrompt(id, data) : ws.createPrompt(data)).then((p) => p.id),
    "Prompt saved",
  );
}

export async function duplicatePromptAction(promptId: string) {
  return runAction(id, promptId, (id) => ws.duplicatePrompt(id).then((p) => p.id), "Prompt duplicated");
}

export async function deletePromptAction(promptId: string) {
  return runAction(id, promptId, (id) => ws.deletePrompt(id), "Prompt deleted");
}

// ---------- Taxonomies ----------

const kind = z.enum(["category", "series", "campaign"]);

export async function createTaxonomyAction(k: ws.TaxonomyKind, name: string) {
  return runAction(z.object({ k: kind, name: z.string() }), { k, name }, ({ k, name }) => ws.createTaxonomy(k, name).then((r) => r.id), "Added");
}

export async function renameTaxonomyAction(k: ws.TaxonomyKind, itemId: string, name: string) {
  return runAction(z.object({ k: kind, id, name: z.string() }), { k, id: itemId, name }, ({ k, id, name }) => ws.renameTaxonomy(k, id, name).then(() => undefined), "Renamed");
}

export async function deleteTaxonomyAction(k: ws.TaxonomyKind, itemId: string) {
  return runAction(z.object({ k: kind, id }), { k, id: itemId }, ({ k, id }) => ws.deleteTaxonomy(k, id), "Removed");
}

// ---------- Settings & notifications ----------

export async function updateSettingsAction(input: ws.SettingsInput) {
  return runAction(
    z.object({
      workspaceName: z.string().trim().min(1).max(80).optional(),
      timezone: z.string().min(1).optional(),
      defaultLanguage: z.string().max(50).optional(),
      requireScriptApproved: z.boolean().optional(),
      requireImagesApproved: z.boolean().optional(),
      requireFinalVideo: z.boolean().optional(),
      requireReview: z.boolean().optional(),
      requireThumbnail: z.boolean().optional(),
      autoRetry: z.boolean().optional(),
      maxRetries: z.number().int().min(0).max(10).optional(),
      retryDelayMinutes: z.number().int().min(1).max(1440).optional(),
      notificationPrefs: z.record(z.string(), z.boolean()).optional(),
    }),
    input,
    (d) => ws.updateSettings(d),
    "Settings saved",
  );
}

export async function markNotificationsReadAction(notificationIds?: string[]) {
  return runAction(z.array(z.string()).optional(), notificationIds, (ids) => ws.markNotificationsRead(ids));
}
