"use client";

import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  Copy,
  Ellipsis,
  FileText,
  Film,
  Flag,
  History,
  ImageIcon,
  LayoutPanelLeft,
  Library,
  ListTodo,
  Rocket,
  Send,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { PriorityBadge } from "@/components/app/content-bits";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ContentThumb } from "@/components/app/content-thumb";
import { PlatformStack } from "@/components/app/platform-icon";
import { useScheduleDialog } from "@/components/app/schedule-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useServerAction } from "@/hooks/use-server-action";
import type { Requirement } from "@/lib/workflow/rules";
import { ContentType, Stage } from "@/lib/workflow/statuses";
import { archiveContentAction, deleteContentAndRedirectAction, duplicateContentAction } from "@/server/actions/content";
import type { ContentWorkspace } from "@/server/queries/content";

export type TabKey = "overview" | "script" | "images" | "video" | "publishing" | "activity";

const Ctx = createContext<{ tab: TabKey; setTab: (t: TabKey) => void } | null>(null);

export function useWorkspaceTab() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspaceTab must be used inside <WorkspaceProvider>");
  return ctx;
}

/** Holds the active tab; keeps it in the URL (?tab=) without a server round trip. */
export function WorkspaceProvider({ initialTab, children }: { initialTab: TabKey; children: ReactNode }) {
  const [tab, setTabState] = useState<TabKey>(initialTab);
  const setTab = useCallback((t: TabKey) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  }, []);
  const value = useMemo(() => ({ tab, setTab }), [tab, setTab]);
  return (
    <Ctx.Provider value={value}>
      <div className="space-y-6">{children}</div>
    </Ctx.Provider>
  );
}

const TAB_META: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: "overview", label: "Overview", icon: LayoutPanelLeft },
  { key: "script", label: "Script", icon: FileText },
  { key: "images", label: "Images", icon: ImageIcon },
  { key: "video", label: "Video", icon: Film },
  { key: "publishing", label: "Publishing", icon: Send },
  { key: "activity", label: "Activity", icon: History },
];

export function WorkspaceTabs({ panels, counts }: { panels: Record<TabKey, ReactNode>; counts: Partial<Record<TabKey, number>> }) {
  const { tab, setTab } = useWorkspaceTab();
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="gap-6">
      <div className="thin-scroll overflow-x-auto border-b border-[#e8e4c8]">
        <TabsList variant="line" className="h-auto gap-4 bg-transparent p-0">
          {TAB_META.map((t) => (
            <TabsTrigger
              key={t.key}
              value={t.key}
              className="h-auto flex-none gap-1.5 rounded-none px-0.5 pt-2 pb-3 text-sm after:bottom-0! after:bg-primary! data-active:text-primary!"
            >
              <t.icon className="size-4" />
              {t.label}
              {counts[t.key] ? <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground tabular-nums">{counts[t.key]}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {TAB_META.map((t) => (
        <TabsContent key={t.key} value={t.key} className="mt-0">
          {panels[t.key]}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function WorkspaceHeader({ data }: { data: ContentWorkspace }) {
  const c = data.content;
  const router = useRouter();
  const { openSchedule } = useScheduleDialog();
  const { run, pending } = useServerAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const scheduleButton = (
    <Button size="lg" disabled={!data.workflow.ready || c.archived} onClick={() => openSchedule({ contentId: c.id })}>
      <CalendarPlus />Schedule post
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <ContentThumb src={c.thumbUrl} seed={c.id} durationSec={c.durationSec} className="aspect-video w-full sm:w-64 lg:w-44" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge def={Stage} value={data.workflow.stage} />
          {c.archived && <StatusBadge tone="neutral" label="Archived" />}
          <PriorityBadge priority={c.priority} />
          {c.seriesName && (
            <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-stone-200 bg-stone-100 px-2 text-[11.5px] text-stone-600"><Library className="size-3" />{c.seriesName}</span>
          )}
          {c.campaignName && (
            <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-stone-200 bg-stone-100 px-2 text-[11.5px] text-stone-600"><Flag className="size-3" />{c.campaignName}</span>
          )}
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight md:text-2xl">{c.title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{c.categoryName ?? "Uncategorized"} · {ContentType.label(c.contentType)}</span>
          <PlatformStack platforms={c.platforms} />
          <span>Created {c.createdLabel}</span>
          {c.targetLabel && <span>Target {c.targetLabel}</span>}
          <span>Updated {c.updatedLabel}</span>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {data.workflow.ready ? (
          scheduleButton
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{scheduleButton}</span>
            </TooltipTrigger>
            <TooltipContent>Complete the missing items first</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-lg" className="bg-white" aria-label="More actions" disabled={pending}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => run(() => duplicateContentAction(c.id), { onSuccess: (id) => router.push(`/content/${id}`) })}>
              <Copy />Duplicate
            </DropdownMenuItem>
            {c.archived ? (
              <DropdownMenuItem onSelect={() => run(() => archiveContentAction([c.id], false))}><ArchiveRestore />Restore</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => run(() => archiveContentAction([c.id]))}><Archive />Archive</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
              <Trash2 />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this content?"
        description="The script versions, uploaded images and videos, and every schedule for this item are removed permanently."
        onConfirm={() => run(() => deleteContentAndRedirectAction(c.id), { success: "Content deleted" })}
      />
    </div>
  );
}

export function ReadinessBanner({ missing, ready, hasSchedules, contentId }: { missing: Requirement[]; ready: boolean; hasSchedules: boolean; contentId: string }) {
  const { setTab } = useWorkspaceTab();
  const { openSchedule } = useScheduleDialog();
  if (ready) {
    if (hasSchedules) return null;
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-olive-200 bg-olive-50 p-4 md:flex-row md:items-center">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white"><Rocket className="size-4" /></span>
        <p className="flex-1 text-sm"><span className="font-medium">Ready to post.</span> Every requirement is met — schedule it for each platform.</p>
        <Button onClick={() => openSchedule({ contentId })}><CalendarPlus />Schedule post</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 md:flex-row md:items-center">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800"><ListTodo className="size-4" /></span>
      <div className="flex-1">
        <p className="text-sm font-medium text-amber-950">Not ready to post — {missing.length} item{missing.length > 1 ? "s" : ""} missing</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {missing.map((m) => (
            <button key={m.key + m.label} type="button" onClick={() => setTab(m.tab)} className="rounded-md border border-amber-200 bg-white px-2 py-1 text-xs text-amber-900 hover:border-amber-400">
              {m.label} →
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
