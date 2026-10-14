"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { PLATFORM_NAMES, PlatformIcon } from "@/components/app/platform-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { type QueueParams, queueHref } from "./queue-shared";

interface Props {
  params: QueueParams;
  platforms: { id: string; name: string }[];
  accounts: { id: string; name: string; platformId: string; connected: boolean }[];
  className?: string;
}

/** Platform + account filters for the queue table (URL state). */
export function QueueFilters({ params, platforms, accounts, className }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (next: QueueParams) => startTransition(() => router.push(queueHref(next), { scroll: false }));
  const visibleAccounts = accounts.filter((a) => !params.platform || a.platformId === params.platform);
  const platform = platforms.find((p) => p.id === params.platform);
  const account = accounts.find((a) => a.id === params.account);

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60", className)}>
      <Select value={params.platform ?? "all"} onValueChange={(v) => go({ ...params, platform: v === "all" ? undefined : v, account: undefined })}>
        <SelectTrigger className="h-9 min-w-[150px] bg-white data-[size=default]:h-9" aria-label="Filter by platform">
          {/* Explicit label so the value is part of the server-rendered HTML */}
          <SelectValue>
            {platform ? (
              <>
                <PlatformIcon platform={platform.id} size={14} />
                {platform.name}
              </>
            ) : (
              "All platforms"
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All platforms</SelectItem>
          {platforms.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <PlatformIcon platform={p.id} size={14} />
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.account ?? "all"} onValueChange={(v) => go({ ...params, account: v === "all" ? undefined : v })}>
        <SelectTrigger className="h-9 max-w-[260px] min-w-[170px] bg-white data-[size=default]:h-9" aria-label="Filter by account">
          <SelectValue>
            {account ? (
              <>
                <PlatformIcon platform={account.platformId} size={14} />
                <span className="truncate">{account.name}</span>
              </>
            ) : (
              "All accounts"
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All accounts</SelectItem>
          {visibleAccounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              <PlatformIcon platform={a.platformId} size={14} />
              <span className="truncate">
                {params.platform ? "" : `${PLATFORM_NAMES[a.platformId] ?? a.platformId} · `}
                {a.name}
              </span>
              {!a.connected && <span className="text-xs text-orange-700">· reconnect</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
