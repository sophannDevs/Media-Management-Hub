import { db } from "@/lib/db";
import { AiProvider, PromptCategory } from "@/lib/workflow/statuses";
import { ServiceError } from "../errors";
import { syncAllPublishingStatuses } from "./content";
import { markNotificationsRead } from "./notifications";

// ---------- Social accounts ----------
// OAuth is phase 2: "connect" currently registers the account directly and
// "reconnect" simulates a token refresh. The provider modules are the place to
// add the real OAuth redirect / callback.

const TOKEN_LIFETIME_DAYS = 60;
const tokenExpiry = () => new Date(Date.now() + TOKEN_LIFETIME_DAYS * 86_400_000);

export async function connectAccount(input: { platformId: string; name: string; handle?: string; followers?: number }) {
  const platform = await db.platform.findUnique({ where: { id: input.platformId } });
  if (!platform?.enabled) throw new ServiceError("This platform is not available yet.");
  const isFirst = (await db.socialAccount.count({ where: { platformId: input.platformId } })) === 0;
  return db.socialAccount.create({
    data: {
      platformId: input.platformId,
      name: input.name.trim(),
      handle: input.handle?.trim() ?? "",
      followers: input.followers ?? 0,
      status: "CONNECTED",
      accessToken: `mock_${Math.random().toString(36).slice(2)}`,
      tokenExpiresAt: tokenExpiry(),
      lastSyncAt: new Date(),
      isDefault: isFirst,
    },
  });
}

export async function reconnectAccount(id: string) {
  const a = await db.socialAccount.update({
    where: { id },
    data: { status: "CONNECTED", lastError: null, tokenExpiresAt: tokenExpiry(), lastSyncAt: new Date(), accessToken: `mock_${Math.random().toString(36).slice(2)}` },
  });
  // Failed posts blocked by the expired token can now be retried by the user
  return a;
}

export async function disconnectAccount(id: string) {
  await db.socialAccount.update({ where: { id }, data: { status: "DISCONNECTED", accessToken: null, refreshToken: null } });
}

export async function syncAccount(id: string) {
  const a = await db.socialAccount.findUnique({ where: { id } });
  if (!a) throw new ServiceError("Account not found.");
  if (a.status !== "CONNECTED") throw new ServiceError("Reconnect the account first.");
  await db.socialAccount.update({ where: { id }, data: { lastSyncAt: new Date() } });
}

export async function setDefaultAccount(id: string) {
  const a = await db.socialAccount.findUniqueOrThrow({ where: { id } });
  await db.$transaction([
    db.socialAccount.updateMany({ where: { platformId: a.platformId }, data: { isDefault: false } }),
    db.socialAccount.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

export async function deleteAccount(id: string) {
  const active = await db.publishingSchedule.count({ where: { accountId: id, status: { in: ["WAITING", "RETRY_SCHEDULED", "PROCESSING"] } } });
  if (active) throw new ServiceError(`This account has ${active} scheduled post(s). Move or cancel them first.`);
  const history = await db.publishingSchedule.count({ where: { accountId: id } });
  if (history) {
    // Keep publishing history intact
    await disconnectAccount(id);
    return { removed: false };
  }
  await db.socialAccount.delete({ where: { id } });
  return { removed: true };
}

// ---------- AI prompt library ----------

export interface PromptInput {
  name: string;
  category: string;
  provider: string;
  content: string;
}

function checkPrompt(input: PromptInput) {
  if (!PromptCategory.is(input.category)) throw new ServiceError("Unknown prompt category.");
  if (!AiProvider.is(input.provider)) throw new ServiceError("Unknown AI provider.");
}

export async function createPrompt(input: PromptInput) {
  checkPrompt(input);
  return db.aiPrompt.create({ data: input });
}

export async function updatePrompt(id: string, input: PromptInput) {
  checkPrompt(input);
  return db.aiPrompt.update({ where: { id }, data: input });
}

export async function duplicatePrompt(id: string) {
  const p = await db.aiPrompt.findUnique({ where: { id } });
  if (!p) throw new ServiceError("Prompt not found.");
  return db.aiPrompt.create({ data: { name: `${p.name} (copy)`, category: p.category, provider: p.provider, content: p.content } });
}

export async function deletePrompt(id: string) {
  await db.aiPrompt.delete({ where: { id } });
}

// ---------- Taxonomies ----------

export type TaxonomyKind = "category" | "series" | "campaign";

export async function createTaxonomy(kind: TaxonomyKind, name: string) {
  const n = name.trim();
  if (!n) throw new ServiceError("Name is required.");
  try {
    if (kind === "category") return await db.category.create({ data: { name: n } });
    if (kind === "series") return await db.series.create({ data: { name: n } });
    return await db.campaign.create({ data: { name: n } });
  } catch {
    throw new ServiceError(`"${n}" already exists.`);
  }
}

export async function renameTaxonomy(kind: TaxonomyKind, id: string, name: string) {
  const n = name.trim();
  if (!n) throw new ServiceError("Name is required.");
  try {
    if (kind === "category") return await db.category.update({ where: { id }, data: { name: n } });
    if (kind === "series") return await db.series.update({ where: { id }, data: { name: n } });
    return await db.campaign.update({ where: { id }, data: { name: n } });
  } catch {
    throw new ServiceError(`"${n}" already exists.`);
  }
}

export async function deleteTaxonomy(kind: TaxonomyKind, id: string) {
  if (kind === "category") await db.category.delete({ where: { id } });
  else if (kind === "series") await db.series.delete({ where: { id } });
  else await db.campaign.delete({ where: { id } });
}

// ---------- Settings ----------

export interface SettingsInput {
  workspaceName?: string;
  timezone?: string;
  defaultLanguage?: string;
  requireScriptApproved?: boolean;
  requireImagesApproved?: boolean;
  requireFinalVideo?: boolean;
  requireReview?: boolean;
  requireThumbnail?: boolean;
  autoRetry?: boolean;
  maxRetries?: number;
  retryDelayMinutes?: number;
  notificationPrefs?: Record<string, boolean>;
}

export async function updateSettings(input: SettingsInput) {
  const { notificationPrefs, ...rest } = input;
  const before = await db.workspaceSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await db.workspaceSettings.update({
    where: { id: 1 },
    data: { ...rest, ...(notificationPrefs ? { notificationPrefs } : {}) },
  });
  const rulesChanged = (["requireScriptApproved", "requireImagesApproved", "requireFinalVideo", "requireReview", "requireThumbnail"] as const).some(
    (k) => rest[k] !== undefined && rest[k] !== before[k],
  );
  // Readiness depends on the rules, so recompute every content status
  if (rulesChanged) await syncAllPublishingStatuses();
}

export { markNotificationsRead };
