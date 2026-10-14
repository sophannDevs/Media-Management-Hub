// Pure helpers shared by the publishing queue's Server and Client Components.
// Keep this file free of server-only imports (db, services).

export const QUEUE_TABS = ["upcoming", "failed", "published", "cancelled", "all"] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

export interface QueueParams {
  status: QueueTab;
  platform?: string;
  account?: string;
}

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseQueueParams(sp: RawParams): QueueParams {
  const status = first(sp.status)?.toLowerCase();
  const platform = first(sp.platform)?.toLowerCase();
  const account = first(sp.account);
  return {
    status: QUEUE_TABS.find((t) => t === status) ?? "upcoming",
    platform: platform && /^[a-z_]{1,32}$/.test(platform) ? platform : undefined,
    account: account && /^[\w-]{1,64}$/.test(account) ? account : undefined,
  };
}

/** Shareable queue URL; defaults (Upcoming tab, no filters) are left out. */
export function queueHref(p: Partial<QueueParams>) {
  const q = new URLSearchParams();
  if (p.status && p.status !== "upcoming") q.set("status", p.status);
  if (p.platform) q.set("platform", p.platform);
  if (p.account) q.set("account", p.account);
  const s = q.toString();
  return s ? `/schedule?${s}` : "/schedule";
}
