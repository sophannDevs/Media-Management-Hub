"use client";

import {
  CalendarDays,
  ChartColumn,
  Clapperboard,
  Images,
  LayoutDashboard,
  Menu,
  Send,
  Settings,
  Share2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface NavCounts {
  content: number;
  failed: number;
  accountIssues: number;
  workspaceName?: string;
}

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/content", label: "Content", icon: Clapperboard, count: "content" },
  { href: "/calendar", label: "Content Calendar", icon: CalendarDays },
  { href: "/schedule", label: "Schedule", icon: Send, alert: "failed" },
  { href: "/media", label: "Media Library", icon: Images },
  { href: "/accounts", label: "Social Accounts", icon: Share2, alert: "accountIssues" },
  { href: "/analytics", label: "Analytics", icon: ChartColumn },
  { href: "/prompts", label: "AI Prompts", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/** Nav list. The active-route lookup reads the URL, so it streams in its own Suspense boundary. */
function NavLinks({ counts, onNavigate }: { counts?: NavCounts; onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList counts={counts} pathname={null} onNavigate={onNavigate} />}>
      <ActiveNavLinks counts={counts} onNavigate={onNavigate} />
    </Suspense>
  );
}

function ActiveNavLinks({ counts, onNavigate }: { counts?: NavCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <NavList counts={counts} pathname={pathname} onNavigate={onNavigate} />;
}

function NavList({ counts, pathname, onNavigate }: { counts?: NavCounts; pathname: string | null; onNavigate?: () => void }) {
  return (
    <nav className="thin-scroll flex-1 space-y-0.5 overflow-y-auto p-3">
      <p className="px-3 pt-2 pb-1.5 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">Workspace</p>
      {NAV.map((n) => {
        const active = pathname !== null && (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href));
        const count = "count" in n && counts ? counts[n.count] : null;
        const alert = "alert" in n && counts ? counts[n.alert] : 0;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            className={cn(
              "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-stone-700 hover:bg-olive-50 hover:text-foreground",
            )}
          >
            <n.icon className={cn("size-[18px]", active ? "text-white" : "text-stone-500")} />
            <span>{n.label}</span>
            {alert ? (
              <span className={cn("ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold", active ? "bg-white text-rose-700" : "bg-rose-100 text-rose-700")}>{alert}</span>
            ) : count !== null ? (
              <span className={cn("ml-auto text-xs", active ? "text-olive-100" : "text-stone-400")}>{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ workspaceName }: { workspaceName?: string }) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white">
        <Clapperboard className="size-5" />
      </span>
      <div className="leading-tight">
        <p className="font-semibold">MediaFlow</p>
        <p className="max-w-40 truncate text-[11px] text-muted-foreground">{workspaceName && workspaceName !== "MediaFlow" ? workspaceName : "AI content studio"}</p>
      </div>
    </div>
  );
}

export function Sidebar({ counts, footer }: { counts?: NavCounts; footer?: React.ReactNode }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <Brand workspaceName={counts?.workspaceName} />
      <NavLinks counts={counts} />
      {footer}
    </aside>
  );
}

export function MobileNav({ counts }: { counts?: NavCounts }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="lg:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <Brand workspaceName={counts?.workspaceName} />
        <NavLinks counts={counts} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
