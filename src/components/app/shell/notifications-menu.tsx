"use client";

import { Bell, CalendarClock, CircleCheck, CircleDashed, KeyRound, Rocket, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { markNotificationsReadAction } from "@/server/actions/workspace";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  href: string | null;
  read: boolean;
  ago: string;
}

const ICONS: Record<string, [typeof Bell, string]> = {
  failed: [TriangleAlert, "bg-rose-50 text-rose-700"],
  token_expired: [KeyRound, "bg-orange-50 text-orange-700"],
  ready: [Rocket, "bg-olive-100 text-olive-800"],
  scheduled_tomorrow: [CalendarClock, "bg-violet-50 text-violet-700"],
  published: [CircleCheck, "bg-olive-100 text-olive-800"],
  incomplete: [CircleDashed, "bg-amber-50 text-amber-700"],
};

export function NotificationIcon({ type }: { type: string }) {
  const [Icon, cls] = ICONS[type] ?? [Bell, "bg-stone-100 text-stone-600"];
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", cls)}>
      <Icon className="size-4" />
    </span>
  );
}

export function NotificationsMenu({ items, unread }: { items: NotificationItem[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const { run } = useServerAction();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-lg" className="relative bg-white" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">{unread}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b border-[#f1eedf] px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button className="text-xs font-medium text-primary hover:underline" onClick={() => run(() => markNotificationsReadAction(), { success: "All caught up" })}>
              Mark all read
            </button>
          )}
        </div>
        <div className="thin-scroll max-h-[60vh] overflow-y-auto p-1.5">
          {items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</p>}
          {items.map((n) => (
            <Link
              key={n.id}
              href={n.href ?? "#"}
              onClick={() => {
                setOpen(false);
                if (!n.read) run(() => markNotificationsReadAction([n.id]), { success: false });
              }}
              className={cn("flex gap-3 rounded-lg p-3 hover:bg-[#f7f5e6]", n.read && "opacity-70")}
            >
              <NotificationIcon type={n.type} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{n.title}</p>
                  {!n.read && <span className="size-1.5 rounded-full bg-primary" />}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
                <p className="mt-1 text-[11px] text-stone-400">{n.ago}</p>
              </div>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
