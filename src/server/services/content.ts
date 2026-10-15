import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { variantKeysOf } from "./derivatives";
import { type DerivedContentState, deriveContentState, isReadyToPost, missingRequirements, normalizeHashtags, parseTags, scheduleActiveKey, type WorkflowRules } from "@/lib/workflow/rules";
import { ActivityType, ImageStatus, NotificationType, type PublishingStatusCode, ReviewStatus, ScriptStatus, VideoStatus } from "@/lib/workflow/statuses";
import { ServiceError } from "../errors";
import { logActivity, resolveActor } from "./activity";
import { contentStateSelect, coverAssetId, toContentState } from "./content-state";
import { notify } from "./notifications";
import { getRules } from "./settings";

export const STATUS_FIELDS = {
  scriptStatus: { def: ScriptStatus, label: "Script" },
  imageStatus: { def: ImageStatus, label: "Images" },
  videoStatus: { def: VideoStatus, label: "Video" },
  reviewStatus: { def: ReviewStatus, label: "Review" },
} as const;
export type StatusField = keyof typeof STATUS_FIELDS;

/** What one content row needs, to recompute what is derived from it. */
const SYNC_SELECT = { ...contentStateSelect, id: true, title: true, stage: true, missingMask: true, completion: true, coverAssetId: true } satisfies Prisma.ContentSelect;
type SyncRow = Prisma.ContentGetPayload<{ select: typeof SYNC_SELECT }>;

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

export interface SyncSummary {
  /** Rows looked at */
  count: number;
  /** Rows whose stored values changed */
  updated: number;
  /** Items that just passed every check */
  ready: { id: string; title: string }[];
  /** The publishing status of each row after the pass */
  status: Map<string, PublishingStatusCode>;
}

/**
 * Recomputes what is derived from the production statuses, assets and
 * schedules (publishing status, stage, missing requirements, completion, cover
 * image) for the given rows — or every row — and stores it (WF-04). One
 * transaction: the rows are locked (sorted, so two passes can't deadlock), read
 * in one query, compared, and only the ones that changed are written, 500 per
 * statement. A change to a schedule or a file that lands meanwhile waits for
 * the lock and recomputes after us, so the stored values never go stale.
 */
async function recompute(ids: string[] | null, rules: WorkflowRules): Promise<SyncSummary> {
  const sorted = ids ? [...new Set(ids)].sort() : null;
  if (sorted && sorted.length === 0) return { count: 0, updated: 0, ready: [], status: new Map() };
  return db.$transaction(
    async (tx) => {
      if (sorted) await tx.$queryRaw`SELECT "id" FROM "Content" WHERE "id" IN (${Prisma.join(sorted)}) FOR UPDATE`;
      const rows: SyncRow[] = await tx.content.findMany({ where: sorted ? { id: { in: sorted } } : {}, select: SYNC_SELECT, relationLoadStrategy: "join" });
      const updates: { id: string; next: DerivedContentState; cover: string | null }[] = [];
      const ready: SyncSummary["ready"] = [];
      const status = new Map<string, PublishingStatusCode>();
      for (const row of rows) {
        const next = deriveContentState(toContentState(row), rules);
        const cover = coverAssetId(row);
        status.set(row.id, next.publishingStatus);
        if (next.publishingStatus !== row.publishingStatus || next.stage !== row.stage || next.missingMask !== row.missingMask || next.completion !== row.completion || cover !== row.coverAssetId) {
          updates.push({ id: row.id, next, cover });
        }
        if (next.publishingStatus === "READY" && ["DRAFT", "NOT_READY"].includes(row.publishingStatus)) ready.push({ id: row.id, title: row.title });
      }
      // Raw SQL leaves updatedAt alone: refreshing derived values is not an edit
      // (a rule change in Settings must not make every item "recently updated").
      for (const part of chunk(updates, 500)) {
        await tx.$executeRaw`
          UPDATE "Content" AS c SET "publishingStatus" = v.ps, "stage" = v.st, "missingMask" = v.mm, "completion" = v.cp, "coverAssetId" = v.cv
          FROM (VALUES ${Prisma.join(part.map((u) => Prisma.sql`(${u.id}::text, ${u.next.publishingStatus}::text, ${u.next.stage}::text, ${u.next.missingMask}::int, ${u.next.completion}::int, ${u.cover}::text)`))}) AS v("id", ps, st, mm, cp, cv)
          WHERE c."id" = v."id"`;
      }
      return { count: rows.length, updated: updates.length, ready, status };
    },
    { timeout: 60_000 },
  );
}

async function announceReady(ready: SyncSummary["ready"]) {
  for (const { id, title } of ready) {
    await logActivity({ contentId: id, type: ActivityType.STATUS_CHANGED, message: "All checks passed — Ready to Post" });
    await notify({
      type: NotificationType.READY_FOR_SCHEDULING,
      title: "Ready for scheduling",
      message: `"${title}" passed all checks and can be scheduled.`,
      href: `/content/${id}?tab=publishing`,
      dedupeKey: `ready:${id}:${new Date().toISOString().slice(0, 13)}`,
    });
  }
}

/** Recomputes one item after a change. Returns its publishing status, or null when it doesn't exist. */
export async function syncPublishingStatus(contentId: string) {
  const r = await recompute([contentId], await getRules());
  await announceReady(r.ready);
  return r.status.get(contentId) ?? null;
}

/** Recomputes several items in one pass (bulk actions): one transaction, one read, one write per 500 changed rows. */
export async function syncPublishingStatuses(contentIds: string[]) {
  const r = await recompute(contentIds, await getRules());
  await announceReady(r.ready);
  return r;
}

/**
 * Recomputes every item, after a workflow rule changed. One summary row in the
 * log and one notification stand in for the per-item ones: a rule change can
 * make hundreds of items Ready at once, and that is one event, not hundreds.
 */
export async function syncAllPublishingStatuses() {
  const r = await recompute(null, await getRules());
  const n = r.ready.length;
  if (n) {
    await logActivity({
      type: ActivityType.STATUS_CHANGED,
      message: `Workflow rules changed: ${n} item${n === 1 ? "" : "s"} now Ready to Post`,
      entity: { type: "SETTINGS", id: "1" },
      meta: { recomputed: r.count, updated: r.updated, ready: n },
    });
    await notify({
      type: NotificationType.READY_FOR_SCHEDULING,
      title: "Ready for scheduling",
      message: n === 1 ? `"${r.ready[0].title}" passed all checks after the rule change and can be scheduled.` : `${n} items passed all checks after the rule change and can be scheduled.`,
      href: n === 1 ? `/content/${r.ready[0].id}?tab=publishing` : "/content?stage=READY",
      dedupeKey: `ready:rules:${new Date().toISOString().slice(0, 13)}`,
    });
  }
  return { count: r.count, updated: r.updated, ready: n };
}

export interface ContentInput {
  title: string;
  idea?: string;
  description?: string;
  contentType?: string;
  categoryId?: string | null;
  tags?: string;
  targetAudience?: string;
  language?: string;
  platforms?: string[];
  priority?: string;
  targetPublishDate?: Date | null;
  seriesId?: string | null;
  campaignId?: string | null;
  hashtags?: string;
}

function tagWrites(tags: string) {
  return parseTags(tags).map((name) => ({ where: { name }, create: { name } }));
}

export async function createContent(input: ContentInput) {
  const platforms = await db.platform.findMany({
    where: { id: { in: input.platforms ?? [] }, enabled: true },
    select: { id: true },
  });
  const content = await db.content.create({
    data: {
      title: input.title.trim(),
      idea: input.idea ?? "",
      description: input.description ?? "",
      contentType: input.contentType ?? "LONG_FORM",
      categoryId: input.categoryId || null,
      targetAudience: input.targetAudience ?? "",
      language: input.language ?? "English",
      priority: input.priority ?? "MEDIUM",
      targetPublishDate: input.targetPublishDate ?? null,
      seriesId: input.seriesId || null,
      campaignId: input.campaignId || null,
      hashtags: input.hashtags ? normalizeHashtags(input.hashtags) : "",
      tags: input.tags ? { connectOrCreate: tagWrites(input.tags) } : undefined,
      platforms: { create: platforms.map((p) => ({ platformId: p.id })) },
      script: { create: {} },
    },
  });
  await logActivity({ contentId: content.id, type: ActivityType.CONTENT_CREATED, message: "Content created" });
  await syncPublishingStatus(content.id);
  return content;
}

export async function updateContent(id: string, input: Partial<ContentInput>) {
  const existing = await db.content.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ServiceError("Content not found.");

  const data: Prisma.ContentUpdateInput = {
    title: input.title?.trim(),
    idea: input.idea,
    description: input.description,
    contentType: input.contentType,
    targetAudience: input.targetAudience,
    language: input.language,
    priority: input.priority,
    hashtags: input.hashtags === undefined ? undefined : normalizeHashtags(input.hashtags),
  };
  if (input.targetPublishDate !== undefined) data.targetPublishDate = input.targetPublishDate;
  if (input.categoryId !== undefined) data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
  if (input.seriesId !== undefined) data.series = input.seriesId ? { connect: { id: input.seriesId } } : { disconnect: true };
  if (input.campaignId !== undefined) data.campaign = input.campaignId ? { connect: { id: input.campaignId } } : { disconnect: true };
  if (input.tags !== undefined) data.tags = { set: [], connectOrCreate: tagWrites(input.tags) };
  if (input.platforms !== undefined) {
    const valid = await db.platform.findMany({ where: { id: { in: input.platforms } }, select: { id: true } });
    data.platforms = { deleteMany: {}, create: valid.map((p) => ({ platformId: p.id })) };
  }

  await db.content.update({ where: { id }, data });
  await logActivity({ contentId: id, type: ActivityType.CONTENT_UPDATED, message: "Details updated" });
  await syncPublishingStatus(id);
}

export async function setProductionStatus(id: string, field: StatusField, value: string) {
  const meta = STATUS_FIELDS[field];
  if (!meta || !meta.def.is(value)) throw new ServiceError("Invalid status.");
  // Review decisions carry who and why (WF-06)
  if (field === "reviewStatus") {
    await reviewContent(id, value);
    return;
  }
  const row = await db.content.findUnique({ where: { id }, select: contentStateSelect });
  if (!row) throw new ServiceError("Content not found.");
  if (row[field] === value) return;

  // Guard rails: approvals need the underlying asset to exist
  if (field === "scriptStatus" && value === "APPROVED" && !row.script?.body.trim()) {
    throw new ServiceError("Write or generate a script before approving it.");
  }
  if (field === "imageStatus" && value === "APPROVED" && row.media.length === 0) {
    throw new ServiceError("Upload at least one image before approving.");
  }
  if (field === "imageStatus" && value === "APPROVED" && !row.media.some((m) => m.isSelected)) {
    throw new ServiceError("Select the final images before approving.");
  }
  if (field === "videoStatus" && value === "FINAL" && !row.videoAssetId) {
    throw new ServiceError("Upload or link the final video before marking it Final.");
  }

  await db.content.update({ where: { id }, data: { [field]: value } });
  await logActivity({
    contentId: id,
    type: ActivityType.STATUS_CHANGED,
    message: `${meta.label} marked ${meta.def.label(value)}`,
    meta: { field, from: row[field], to: value },
  });
  await syncPublishingStatus(id);
}

export type ReviewDecision = "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED";
const DECISIONS: ReviewDecision[] = ["IN_REVIEW", "CHANGES_REQUESTED", "APPROVED"];
const DECISION_WORD: Record<ReviewDecision, string> = { IN_REVIEW: "Sent to review", CHANGES_REQUESTED: "Changes requested", APPROVED: "Approved" };

/**
 * A review decision (WF-06): the status changes, and a Review row and a log
 * row say who decided, when and what they said. Requesting changes needs a
 * comment. The same decision again, without a word, records nothing. The
 * resets stay as they were: editing an approved script, changing the selected
 * images or replacing the video sends the item back on its own.
 */
export async function reviewContent(id: string, decision: string, comment = "") {
  if (!DECISIONS.includes(decision as ReviewDecision)) throw new ServiceError("Invalid review decision.");
  const text = comment.trim();
  if (decision === "CHANGES_REQUESTED" && !text) throw new ServiceError("Say what needs to change.");
  if (text.length > 2000) throw new ServiceError("Keep the comment under 2,000 characters.");
  const row = await db.content.findUnique({ where: { id }, select: { reviewStatus: true } });
  if (!row) throw new ServiceError("Content not found.");
  if (row.reviewStatus === decision && !text) return { changed: false as const };
  const actor = await resolveActor();
  const review = await db.$transaction(async (tx) => {
    await tx.content.update({ where: { id }, data: { reviewStatus: decision } });
    return tx.review.create({ data: { contentId: id, decision, comment: text, actorId: actor.userId } });
  });
  await logActivity({
    contentId: id,
    type: ActivityType.REVIEW_DECIDED,
    message: `${DECISION_WORD[decision as ReviewDecision]}${text ? `: “${text}”` : ""}`,
    meta: { field: "reviewStatus", from: row.reviewStatus, to: decision, comment: text, reviewId: review.id },
  });
  await syncPublishingStatus(id);
  return { changed: true as const, reviewId: review.id };
}

export async function setChecklistFlag(id: string, key: "titleFinalized" | "descriptionFinalized", value: boolean) {
  await db.content.update({ where: { id }, data: { [key]: value } });
  await logActivity({
    contentId: id,
    type: ActivityType.CONTENT_UPDATED,
    message: `${key === "titleFinalized" ? "Title" : "Description"} ${value ? "finalized" : "reopened"}`,
  });
  // Part of the checklist, so of the stored completion
  await syncPublishingStatus(id);
}

export async function duplicateContent(id: string) {
  const src = await db.content.findUnique({
    where: { id },
    include: { tags: true, platforms: true, script: true, imagePrompt: true },
  });
  if (!src) throw new ServiceError("Content not found.");
  const copy = await db.content.create({
    data: {
      title: `${src.title} (copy)`,
      idea: src.idea,
      description: src.description,
      contentType: src.contentType,
      targetAudience: src.targetAudience,
      language: src.language,
      priority: src.priority,
      hashtags: src.hashtags,
      categoryId: src.categoryId,
      seriesId: src.seriesId,
      campaignId: src.campaignId,
      scriptStatus: src.script?.body.trim() ? "GENERATED" : "NOT_STARTED",
      tags: { connect: src.tags.map((t) => ({ id: t.id })) },
      platforms: { create: src.platforms.map((p) => ({ platformId: p.platformId })) },
      script: { create: { body: src.script?.body ?? "" } },
      imagePrompt: src.imagePrompt
        ? {
            create: {
              prompt: src.imagePrompt.prompt,
              negativePrompt: src.imagePrompt.negativePrompt,
              style: src.imagePrompt.style,
              aspectRatio: src.imagePrompt.aspectRatio,
              provider: src.imagePrompt.provider,
            },
          }
        : undefined,
    },
  });
  await logActivity({ contentId: copy.id, type: ActivityType.CONTENT_CREATED, message: `Duplicated from "${src.title}"` });
  await syncPublishingStatus(copy.id);
  return copy;
}

/** Statuses of the posts archiving takes out of the queue (and restoring can bring back). */
const PAUSABLE = ["WAITING", "RETRY_SCHEDULED"] as const;

/**
 * Archived content must never publish: its waiting posts are cancelled, each
 * remembering the status it had (archivedStatus), so restoring can bring them
 * back (WF-07). A post that is publishing right now is left to finish.
 */
export async function archiveContents(ids: string[], opts: { log?: boolean } = {}) {
  const cancelled = await db.$transaction(async (tx) => {
    await tx.content.updateMany({ where: { id: { in: ids }, archivedAt: null }, data: { archivedAt: new Date() } });
    let n = 0;
    for (const status of PAUSABLE) {
      n += (await tx.publishingSchedule.updateMany({ where: { contentId: { in: ids }, status }, data: { status: "CANCELLED", activeKey: null, archivedStatus: status } })).count;
    }
    return n;
  });
  if (opts.log !== false) {
    for (const id of ids) await logActivity({ contentId: id, type: ActivityType.CONTENT_UPDATED, message: "Archived" });
  }
  await syncPublishingStatuses(ids);
  return { cancelled };
}

export interface RestoreResult {
  /** Posts back in the queue */
  restored: number;
  /** Posts whose time passed while archived: they stay cancelled */
  expired: number;
  /** Posts whose account got another active post in the meantime: they stay cancelled */
  conflicts: number;
}

/**
 * Takes content out of the archive. With `withPosts`, the posts archiving
 * cancelled return to the queue as they were, unless their time has passed
 * (they would go out at once) or the account already has another active post
 * for this content. Without it they stay cancelled.
 */
export async function restoreContents(ids: string[], withPosts = true, opts: { from?: string } = {}): Promise<RestoreResult> {
  const now = new Date();
  await db.content.updateMany({ where: { id: { in: ids } }, data: { archivedAt: null } });
  const paused = await db.publishingSchedule.findMany({
    where: { contentId: { in: ids }, status: "CANCELLED", archivedStatus: { not: null } },
    select: { id: true, contentId: true, accountId: true, archivedStatus: true, scheduledAt: true, nextAttemptAt: true },
  });
  const result: RestoreResult = { restored: 0, expired: 0, conflicts: 0 };
  const perContent = new Map<string, RestoreResult>();
  for (const p of paused) {
    const status = p.archivedStatus as (typeof PAUSABLE)[number];
    const due = status === "RETRY_SCHEDULED" ? (p.nextAttemptAt ?? p.scheduledAt) : p.scheduledAt;
    const tally = perContent.get(p.contentId) ?? { restored: 0, expired: 0, conflicts: 0 };
    perContent.set(p.contentId, tally);
    const forget = () => db.publishingSchedule.updateMany({ where: { id: p.id, status: "CANCELLED" }, data: { archivedStatus: null } });
    if (!withPosts) {
      await forget();
      continue;
    }
    if (due <= now) {
      await forget();
      tally.expired++;
      continue;
    }
    try {
      // Only if nobody changed the post since (it is still the one archiving cancelled)
      const { count } = await db.publishingSchedule.updateMany({
        where: { id: p.id, status: "CANCELLED", archivedStatus: status },
        data: { status, activeKey: scheduleActiveKey(status, p.contentId, p.accountId), archivedStatus: null },
      });
      tally.restored += count;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      await forget();
      tally.conflicts++;
    }
  }
  for (const id of ids) {
    const t = perContent.get(id);
    const posts = t
      ? [t.restored && `${t.restored} post${t.restored === 1 ? "" : "s"} back in the queue`, t.expired && `${t.expired} past their time stay cancelled`, t.conflicts && `${t.conflicts} replaced by newer posts stay cancelled`]
          .filter(Boolean)
          .join(", ")
      : "";
    await logActivity({ contentId: id, type: ActivityType.CONTENT_UPDATED, message: `Restored from ${opts.from ?? "archive"}${posts ? ` — ${posts}` : ""}` });
    if (t) {
      result.restored += t.restored;
      result.expired += t.expired;
      result.conflicts += t.conflicts;
    }
  }
  await syncPublishingStatuses(ids);
  return result;
}

/** How long trashed content is kept before the worker removes it for good (days). Content with a post that went live is never removed automatically. */
export const TRASH_DAYS = Math.max(1, Number(process.env.CONTENT_TRASH_DAYS) || 30);

/**
 * Moves content to the trash (WF-05). It is archived first — hidden
 * everywhere, its waiting posts taken out of the queue and remembered — then
 * marked deleted, so nothing is lost: it can be restored for TRASH_DAYS, after
 * which the worker removes it for good, unless a post of it went live, which
 * only a person can remove, by typing the title (purgeContents).
 */
export async function trashContents(ids: string[]) {
  const rows = await db.content.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, archivedAt: true } });
  const fresh = rows.filter((r) => !r.archivedAt).map((r) => r.id);
  const shelved = rows.filter((r) => r.archivedAt).map((r) => r.id);
  const { cancelled } = fresh.length ? await archiveContents(fresh, { log: false }) : { cancelled: 0 };
  const now = new Date();
  if (fresh.length) await db.content.updateMany({ where: { id: { in: fresh } }, data: { deletedAt: now, trashedFromArchive: false } });
  if (shelved.length) await db.content.updateMany({ where: { id: { in: shelved } }, data: { deletedAt: now, trashedFromArchive: true } });
  for (const r of rows) await logActivity({ contentId: r.id, type: ActivityType.CONTENT_UPDATED, message: "Moved to the trash" });
  return { trashed: rows.length, cancelled };
}

/** Takes content out of the trash, back to where it was: active with its posts as archiving left them, or still archived. */
export async function restoreFromTrash(ids: string[], withPosts = true) {
  const rows = await db.content.findMany({ where: { id: { in: ids }, deletedAt: { not: null } }, select: { id: true, trashedFromArchive: true } });
  await db.content.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deletedAt: null, trashedFromArchive: false } });
  const active = rows.filter((r) => !r.trashedFromArchive).map((r) => r.id);
  const result: RestoreResult = active.length ? await restoreContents(active, withPosts, { from: "the trash" }) : { restored: 0, expired: 0, conflicts: 0 };
  for (const r of rows) {
    if (r.trashedFromArchive) await logActivity({ contentId: r.id, type: ActivityType.CONTENT_UPDATED, message: "Restored from the trash (still archived)" });
  }
  return { ...result, count: rows.length };
}

/**
 * Removes content for good: the rows, the script versions, the files, the
 * schedules with their history, the analytics. Refused while a post of it is
 * being published, and — when a post of it went live — unless its title is
 * typed back, because that history can't be recovered.
 */
export async function purgeContents(ids: string[], opts: { confirmTitle?: string } = {}) {
  const rows = await db.content.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, schedules: { where: { status: { in: ["PUBLISHED", "PROCESSING"] } }, select: { status: true } } },
  });
  const liveCount = (r: (typeof rows)[number]) => r.schedules.filter((s) => s.status === "PUBLISHED").length;
  for (const r of rows) {
    if (r.schedules.some((s) => s.status === "PROCESSING")) throw new ServiceError(`A post of “${r.title}” is being published right now. Try again in a minute.`);
    const live = liveCount(r);
    if (live && opts.confirmTitle?.trim() !== r.title) {
      throw new ServiceError(`“${r.title}” has ${live} published post${live === 1 ? "" : "s"}. Type its title to remove it and that history for good.`, undefined, "CONFLICT", { requiresTitle: r.title });
    }
  }
  const assets = await db.mediaAsset.findMany({ where: { contentId: { in: ids } }, select: { id: true, storageKey: true, variants: true } });
  await db.$transaction([
    db.content.updateMany({ where: { id: { in: ids } }, data: { videoAssetId: null, thumbnailAssetId: null } }),
    db.mediaAsset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } }),
    db.content.deleteMany({ where: { id: { in: ids } } }),
  ]);
  await Promise.all(assets.flatMap((a) => [...(a.storageKey ? [a.storageKey] : []), ...variantKeysOf(a.variants)].map((k) => storage.remove(k).catch(() => {}))));
  for (const r of rows) {
    const live = liveCount(r);
    await logActivity({
      type: ActivityType.CONTENT_DELETED,
      message: `Removed for good: “${r.title}”${live ? ` (with ${live} published post${live === 1 ? "" : "s"} of history)` : ""}`,
      entity: { type: "CONTENT", id: r.id },
    });
  }
  return { removed: rows.length };
}

/** The worker's daily pass (WF-05): trashed content past its retention goes; what has a post that went live stays for a person to decide. */
export async function purgeExpiredTrash(now = new Date(), days = TRASH_DAYS) {
  const before = new Date(now.getTime() - days * 86_400_000);
  const due = await db.content.findMany({ where: { deletedAt: { lt: before }, schedules: { none: { status: { in: ["PUBLISHED", "PROCESSING"] } } } }, select: { id: true } });
  const kept = await db.content.count({ where: { deletedAt: { lt: before }, schedules: { some: { status: "PUBLISHED" } } } });
  if (due.length) await purgeContents(due.map((d) => d.id));
  return { purged: due.length, kept };
}

export async function bulkSetCategory(ids: string[], categoryId: string | null) {
  await db.content.updateMany({ where: { id: { in: ids } }, data: { categoryId } });
}

export async function bulkAddTag(ids: string[], tag: string) {
  const [name] = parseTags(tag);
  if (!name) throw new ServiceError("Enter a tag.");
  const t = await db.tag.upsert({ where: { name }, update: {}, create: { name } });
  for (const id of ids) await db.content.update({ where: { id }, data: { tags: { connect: { id: t.id } } } });
}

export async function bulkSetStatus(ids: string[], field: StatusField, value: string) {
  const errors: string[] = [];
  for (const id of ids) {
    try {
      await setProductionStatus(id, field, value);
    } catch (e) {
      if (e instanceof ServiceError) errors.push(e.message);
      else throw e;
    }
  }
  return { updated: ids.length - errors.length, errors: Array.from(new Set(errors)) };
}

/** Readiness for scheduling, with the reasons when not ready. */
export async function getReadiness(contentId: string) {
  const row = await db.content.findUnique({ where: { id: contentId }, select: contentStateSelect });
  if (!row) throw new ServiceError("Content not found.");
  const rules = await getRules();
  const state = toContentState(row);
  return { ready: isReadyToPost(state, rules), missing: missingRequirements(state, rules) };
}
