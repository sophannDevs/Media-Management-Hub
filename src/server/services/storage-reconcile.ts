import { db } from "@/lib/db";
import { logger } from "@/lib/log";
import { storage } from "@/lib/storage";
import { variantKeysOf } from "./derivatives";

// Storage and the database drift apart over time (MEDIA-03): an upload whose
// registration failed, a bucket object a browser left behind, a file deleted
// by hand. The reconcile pass lists what storage holds, keeps everything an
// asset references, removes the rest once it is older than the grace period
// (an upload in progress is never touched), and reports assets whose file is
// gone so a person can decide about them.

export interface ReconcileReport {
  /** Objects in storage */
  listed: number;
  /** Referenced by an asset */
  referenced: number;
  /** Not referenced, older than the grace period: removed (or would be, in a dry run) */
  orphans: string[];
  /** Not referenced but too young to touch (an upload still being registered) */
  pending: number;
  /** Assets whose stored file is missing; left as they are */
  missing: { id: string; fileName: string; storageKey: string }[];
  dryRun: boolean;
}

/** Files younger than this are never removed: a direct upload is registered minutes after it lands, not days. */
export const RECONCILE_GRACE_MS = 24 * 3_600_000;

const log = logger.child({ component: "storage-reconcile" });

/**
 * One pass over storage. `dryRun` lists what would go without removing it;
 * `prefix` limits the pass (the default covers every upload).
 */
export async function reconcileStorage({ dryRun = false, graceMs = RECONCILE_GRACE_MS, prefix = "media/", now = new Date() }: { dryRun?: boolean; graceMs?: number; prefix?: string; now?: Date } = {}): Promise<ReconcileReport> {
  const objects = await storage.list(prefix);
  const assets = await db.mediaAsset.findMany({ where: { storageKey: { not: null } }, select: { id: true, fileName: true, storageKey: true, variants: true } });
  // The originals and their smaller copies (PERF-08) are all spoken for
  const referenced = new Set(assets.flatMap((a) => [a.storageKey!, ...variantKeysOf(a.variants)]));
  const present = new Set(objects.map((o) => o.key));

  const orphans: string[] = [];
  let pending = 0;
  let kept = 0;
  for (const o of objects) {
    if (referenced.has(o.key)) {
      kept++;
      continue;
    }
    if (now.getTime() - o.modifiedAt.getTime() < graceMs) {
      pending++;
      continue;
    }
    orphans.push(o.key);
  }
  // An asset under the listed prefix is missing when the listing lacks it; one stored elsewhere
  // (the seed's files, an older layout) is asked for directly rather than reported on no evidence
  const missing: ReconcileReport["missing"] = [];
  for (const a of assets) {
    const key = a.storageKey!;
    const gone = key.startsWith(prefix) ? !present.has(key) : (await storage.stat(key)) === null;
    if (gone) missing.push({ id: a.id, fileName: a.fileName, storageKey: key });
  }

  if (!dryRun) {
    for (const key of orphans) {
      try {
        await storage.remove(key);
      } catch (e) {
        log.warn("orphaned file could not be removed", { key, err: e });
      }
    }
  }
  const report: ReconcileReport = { listed: objects.length, referenced: kept, orphans, pending, missing, dryRun };
  log.info(dryRun ? "storage reconcile (dry run)" : "storage reconciled", { listed: report.listed, referenced: kept, removed: dryRun ? 0 : orphans.length, pending, missing: missing.length });
  if (missing.length) log.warn("assets whose stored file is missing", { count: missing.length, first: missing.slice(0, 5).map((m) => m.storageKey) });
  return report;
}
