import { io } from "next/cache";
import { cache } from "react";
import { db } from "@/lib/db";
import { compactNumber, dayDiff, fmtDate, fmtDateTime, timeAgo } from "@/lib/dates";
import { providerMeta } from "@/lib/platforms/registry";
import type { ScheduleStatusCode } from "@/lib/workflow/statuses";
import { getPageContext } from "./shared";

/** Posts that will go out on an account unless something changes. */
const SCHEDULED_STATUSES: ScheduleStatusCode[] = ["WAITING", "RETRY_SCHEDULED"];
const TOKEN_WARNING_DAYS = 7;

/** UI copy per platform; unknown platforms fall back to their provider module / generic wording. */
const PLATFORM_COPY: Record<string, { description: string; accountNoun: string; audienceNoun: string }> = {
  youtube: { description: "Upload videos, set visibility and thumbnails, and read analytics.", accountNoun: "channel", audienceNoun: "subscribers" },
  facebook: { description: "Publish videos and reels to Facebook Pages you manage.", accountNoun: "Page", audienceNoun: "followers" },
};

function platformCopy(platformId: string) {
  return (
    PLATFORM_COPY[platformId] ?? {
      description: "",
      accountNoun: providerMeta(platformId)?.accountNoun.toLowerCase() ?? "account",
      audienceNoun: "followers",
    }
  );
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const last = words.length > 1 ? words[words.length - 1][0] : (words[0][1] ?? "");
  return `${words[0][0]}${last}`.toUpperCase();
}

/** Platforms for the connect dialog (enabled ones can be connected; the rest are "coming soon"). */
export const getConnectPlatforms = cache(async () => {
  await io();
  const platforms = await db.platform.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, enabled: true } });
  return platforms.map((p) => ({ ...p, ...platformCopy(p.id) }));
});
export type ConnectPlatform = Awaited<ReturnType<typeof getConnectPlatforms>>[number];

export async function getAccountsData() {
  const { now, tz } = await getPageContext();
  const [platforms, accounts, scheduled] = await Promise.all([
    getConnectPlatforms(),
    db.socialAccount.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        platformId: true,
        name: true,
        handle: true,
        status: true,
        followers: true,
        isDefault: true,
        tokenExpiresAt: true,
        lastSyncAt: true,
        lastError: true,
      },
    }),
    db.publishingSchedule.groupBy({ by: ["accountId"], where: { status: { in: SCHEDULED_STATUSES } }, _count: { _all: true } }),
  ]);
  const scheduledBy = new Map(scheduled.map((s) => [s.accountId, s._count._all]));

  const cards = accounts.map((a) => {
    const copy = platformCopy(a.platformId);
    const connected = a.status === "CONNECTED";
    const hasToken = a.status !== "DISCONNECTED" && !!a.tokenExpiresAt;
    const expired = hasToken && a.tokenExpiresAt! <= now;
    const daysLeft = hasToken && !expired ? dayDiff(a.tokenExpiresAt!, now, tz) : null;
    let tokenNote: string | null = null;
    if (expired) tokenNote = "Expired";
    else if (daysLeft !== null && daysLeft < TOKEN_WARNING_DAYS) tokenNote = daysLeft <= 0 ? "Expires today" : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;

    return {
      id: a.id,
      platformId: a.platformId,
      name: a.name,
      handle: a.handle,
      initials: initials(a.name),
      status: a.status,
      connected,
      isDefault: a.isDefault,
      accountNoun: copy.accountNoun,
      audience: `${compactNumber(a.followers)} ${copy.audienceNoun}`,
      scheduled: scheduledBy.get(a.id) ?? 0,
      lastSync: a.lastSyncAt ? timeAgo(a.lastSyncAt, now) : "Never",
      lastSyncAt: a.lastSyncAt ? fmtDateTime(a.lastSyncAt, tz) : null,
      tokenExpires: hasToken ? fmtDate(a.tokenExpiresAt!, tz) : "—",
      tokenNote,
      lastError: a.lastError,
    };
  });

  return {
    sections: platforms
      // Enabled platforms, plus any disabled one that still has accounts attached
      .filter((p) => p.enabled || cards.some((a) => a.platformId === p.id))
      .map((p) => ({ ...p, accounts: cards.filter((a) => a.platformId === p.id) })),
    comingSoon: platforms.filter((p) => !p.enabled),
    platforms,
  };
}
export type AccountsData = Awaited<ReturnType<typeof getAccountsData>>;
export type AccountCardData = AccountsData["sections"][number]["accounts"][number];
