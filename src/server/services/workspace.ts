import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ActivityType, AiProvider, PromptCategory } from "@/lib/workflow/statuses";
import { ServiceError } from "../errors";
import { logActivity } from "./activity";
import { syncAllPublishingStatuses } from "./content";
import { markNotificationsRead } from "./notifications";
import { notifyBlockedPosts } from "./publishing";
import { clearAccountTokens, sealTokens } from "./tokens";

// ---------- Social accounts ----------
// OAuth is phase 2: "connect" currently registers the account directly and
// "reconnect" simulates a token refresh. The provider modules are the place to
// add the real OAuth redirect / callback.

const TOKEN_LIFETIME_DAYS = 60;
const tokenExpiry = () => new Date(Date.now() + TOKEN_LIFETIME_DAYS * 86_400_000);
// Stored encrypted like a real one would be (SEC-04); the simulated platforms never read it
const mockToken = () => `mock_${Math.random().toString(36).slice(2)}`;

export async function connectAccount(input: { platformId: string; name: string; handle?: string; followers?: number }) {
  const platform = await db.platform.findUnique({ where: { id: input.platformId } });
  if (!platform?.enabled) throw new ServiceError("This platform is not available yet.");
  const isFirst = (await db.socialAccount.count({ where: { platformId: input.platformId } })) === 0;
  const create = (isDefault: boolean) =>
    db.socialAccount.create({
      data: {
        platformId: input.platformId,
        name: input.name.trim(),
        handle: input.handle?.trim() ?? "",
        followers: input.followers ?? 0,
        status: "CONNECTED",
        ...sealTokens({ accessToken: mockToken() }),
        tokenExpiresAt: tokenExpiry(),
        lastSyncAt: new Date(),
        isDefault,
      },
    });
  let account;
  try {
    account = await create(isFirst);
  } catch (e) {
    // Two accounts connected at once both saw "none yet": the database allows one default per platform, the other becomes a normal account
    if (isFirst && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") account = await create(false);
    else throw e;
  }
  await logActivity({ type: ActivityType.ACCOUNT_CONNECTED, message: `${platform.name} account connected: ${account.name}`, entity: { type: "ACCOUNT", id: account.id } });
  return account;
}

export async function reconnectAccount(id: string) {
  const a = await db.socialAccount.update({
    where: { id },
    data: { status: "CONNECTED", lastError: null, tokenExpiresAt: tokenExpiry(), lastSyncAt: new Date(), ...sealTokens({ accessToken: mockToken() }) },
    include: { platform: { select: { name: true } } },
  });
  await logActivity({ type: ActivityType.ACCOUNT_RECONNECTED, message: `${a.platform.name} account reconnected: ${a.name}`, entity: { type: "ACCOUNT", id: a.id } });
  // Failed posts blocked by the expired token can now be retried by the user
  return a;
}

export async function disconnectAccount(id: string) {
  const a = await db.socialAccount.update({ where: { id }, data: { status: "DISCONNECTED" }, include: { platform: { select: { name: true } } } });
  await clearAccountTokens(id);
  await logActivity({ type: ActivityType.ACCOUNT_DISCONNECTED, message: `${a.platform.name} account disconnected: ${a.name}`, entity: { type: "ACCOUNT", id } });
  await notifyBlockedPosts(id);
}

export async function syncAccount(id: string) {
  const a = await db.socialAccount.findUnique({ where: { id } });
  if (!a) throw new ServiceError("Account not found.");
  if (a.status !== "CONNECTED") throw new ServiceError("Reconnect the account first.");
  await db.socialAccount.update({ where: { id }, data: { lastSyncAt: new Date() } });
  await logActivity({ type: ActivityType.ACCOUNT_UPDATED, message: `Account synced: ${a.name}`, entity: { type: "ACCOUNT", id } });
}

export async function setDefaultAccount(id: string) {
  const a = await db.socialAccount.findUniqueOrThrow({ where: { id }, include: { platform: { select: { name: true } } } });
  await db.$transaction([
    db.socialAccount.updateMany({ where: { platformId: a.platformId }, data: { isDefault: false } }),
    db.socialAccount.update({ where: { id }, data: { isDefault: true } }),
  ]);
  await logActivity({ type: ActivityType.ACCOUNT_UPDATED, message: `${a.name} is now the default ${a.platform.name} account`, entity: { type: "ACCOUNT", id } });
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
  const a = await db.socialAccount.delete({ where: { id }, include: { platform: { select: { name: true } } } });
  await logActivity({ type: ActivityType.ACCOUNT_DELETED, message: `${a.platform.name} account removed: ${a.name}`, entity: { type: "ACCOUNT", id } });
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

const promptLog = (action: string, p: { id: string; name: string }) => logActivity({ type: ActivityType.PROMPT_CHANGED, message: `Prompt ${action}: ${p.name}`, entity: { type: "PROMPT", id: p.id }, meta: { action } });

export async function createPrompt(input: PromptInput) {
  checkPrompt(input);
  const p = await db.aiPrompt.create({ data: input });
  await promptLog("created", p);
  return p;
}

export async function updatePrompt(id: string, input: PromptInput) {
  checkPrompt(input);
  const p = await db.aiPrompt.update({ where: { id }, data: input });
  await promptLog("updated", p);
  return p;
}

export async function duplicatePrompt(id: string) {
  const p = await db.aiPrompt.findUnique({ where: { id } });
  if (!p) throw new ServiceError("Prompt not found.");
  const copy = await db.aiPrompt.create({ data: { name: `${p.name} (copy)`, category: p.category, provider: p.provider, content: p.content } });
  await promptLog("duplicated", copy);
  return copy;
}

export async function deletePrompt(id: string) {
  const p = await db.aiPrompt.delete({ where: { id } });
  await promptLog("deleted", p);
}

// ---------- Taxonomies ----------

export type TaxonomyKind = "category" | "series" | "campaign";

const KIND_LABEL: Record<TaxonomyKind, string> = { category: "Category", series: "Series", campaign: "Campaign" };
const taxonomyLog = (kind: TaxonomyKind, id: string, message: string) => logActivity({ type: ActivityType.TAXONOMY_CHANGED, message, entity: { type: "TAXONOMY", id }, meta: { kind } });

export async function createTaxonomy(kind: TaxonomyKind, name: string) {
  const n = name.trim();
  if (!n) throw new ServiceError("Name is required.");
  let row: { id: string; name: string };
  try {
    if (kind === "category") row = await db.category.create({ data: { name: n } });
    else if (kind === "series") row = await db.series.create({ data: { name: n } });
    else row = await db.campaign.create({ data: { name: n } });
  } catch {
    throw new ServiceError(`"${n}" already exists.`);
  }
  await taxonomyLog(kind, row.id, `${KIND_LABEL[kind]} created: ${n}`);
  return row;
}

export async function renameTaxonomy(kind: TaxonomyKind, id: string, name: string) {
  const n = name.trim();
  if (!n) throw new ServiceError("Name is required.");
  const before = kind === "category" ? await db.category.findUnique({ where: { id } }) : kind === "series" ? await db.series.findUnique({ where: { id } }) : await db.campaign.findUnique({ where: { id } });
  let row: { id: string; name: string };
  try {
    if (kind === "category") row = await db.category.update({ where: { id }, data: { name: n } });
    else if (kind === "series") row = await db.series.update({ where: { id }, data: { name: n } });
    else row = await db.campaign.update({ where: { id }, data: { name: n } });
  } catch {
    throw new ServiceError(`"${n}" already exists.`);
  }
  if (before && before.name !== n) await taxonomyLog(kind, id, `${KIND_LABEL[kind]} renamed: ${before.name} → ${n}`);
  return row;
}

export async function deleteTaxonomy(kind: TaxonomyKind, id: string) {
  let gone: { name: string };
  if (kind === "category") gone = await db.category.delete({ where: { id } });
  else if (kind === "series") gone = await db.series.delete({ where: { id } });
  else gone = await db.campaign.delete({ where: { id } });
  await taxonomyLog(kind, id, `${KIND_LABEL[kind]} deleted: ${gone.name}`);
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

const SETTING_LABEL: Record<keyof SettingsInput, string> = {
  workspaceName: "Workspace name",
  timezone: "Timezone",
  defaultLanguage: "Default language",
  requireScriptApproved: "Require script approved",
  requireImagesApproved: "Require images approved",
  requireFinalVideo: "Require final video",
  requireReview: "Require review",
  requireThumbnail: "Require thumbnail",
  autoRetry: "Auto-retry",
  maxRetries: "Max retries",
  retryDelayMinutes: "Retry delay (minutes)",
  notificationPrefs: "Notification preferences",
};
const show = (v: unknown) => (typeof v === "boolean" ? (v ? "on" : "off") : typeof v === "object" ? "changed" : String(v));

export async function updateSettings(input: SettingsInput) {
  const { notificationPrefs, ...rest } = input;
  const before = await db.workspaceSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await db.workspaceSettings.update({
    where: { id: 1 },
    data: { ...rest, ...(notificationPrefs ? { notificationPrefs } : {}) },
  });
  // What actually changed, for the log (DB-05): a save that changes nothing leaves no row
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(rest) as (keyof typeof rest)[]) {
    if (rest[k] !== undefined && rest[k] !== before[k]) changed[k] = { from: before[k], to: rest[k] };
  }
  if (notificationPrefs && JSON.stringify(notificationPrefs) !== JSON.stringify(before.notificationPrefs)) changed.notificationPrefs = { from: before.notificationPrefs, to: notificationPrefs };
  const keys = Object.keys(changed) as (keyof SettingsInput)[];
  if (keys.length) {
    await logActivity({
      type: ActivityType.SETTINGS_UPDATED,
      message: `Settings changed: ${keys.map((k) => `${SETTING_LABEL[k]} ${show(changed[k].to)}`).join("; ")}`,
      entity: { type: "SETTINGS", id: "1" },
      meta: { changed },
    });
  }
  const rulesChanged = (["requireScriptApproved", "requireImagesApproved", "requireFinalVideo", "requireReview", "requireThumbnail"] as const).some((k) => k in changed);
  // Readiness depends on the rules, so recompute every content status
  if (rulesChanged) await syncAllPublishingStatuses();
}

export { markNotificationsRead };
