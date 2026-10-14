"use client";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Copy,
  Ellipsis,
  Folder,
  SearchX,
  SquareArrowOutUpRight,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { CompletionBar, EmptyState, MiniSteps, PriorityBadge } from "@/components/app/content-bits";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ContentThumb, thumbIconFor } from "@/components/app/content-thumb";
import { PlatformIcon, PlatformStack } from "@/components/app/platform-icon";
import { useScheduleDialog } from "@/components/app/schedule-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useServerAction } from "@/hooks/use-server-action";
import { buildHref, CONTENT_SORTS, type ContentListParams, type ContentSort, type ContentView, type SortDir } from "@/lib/content-list";
import { cn } from "@/lib/utils";
import { ContentType, ImageStatus, ReviewStatus, ScriptStatus, Stage, stageLabel, VideoStatus } from "@/lib/workflow/statuses";
import {
  archiveContentAction,
  bulkCategoryAction,
  bulkStatusAction,
  bulkTagAction,
  deleteContentAction,
  duplicateContentAction,
} from "@/server/actions/content";
import type { ContentListData, ContentListItem } from "@/server/queries/content";

const STATUS_FIELDS = [
  ["scriptStatus", "Script", ScriptStatus],
  ["imageStatus", "Images", ImageStatus],
  ["videoStatus", "Video", VideoStatus],
  ["reviewStatus", "Review", ReviewStatus],
] as const;

type Confirm = { kind: "archive" | "delete"; ids: string[]; title: string } | null;

type Sorting = { params: ContentListParams; sort: ContentSort; dir: SortDir };

/** Column header that sorts the list (server-side) by that column; a second click reverses it. */
function SortHead({ col, children, params, sort, dir, className }: Sorting & { col: ContentSort; children: string; className?: string }) {
  const active = sort === col;
  const next = active ? (dir === "asc" ? "desc" : "asc") : CONTENT_SORTS[col].dir;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={buildHref(params, { sort: col, dir: next })} scroll={false} className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground">
        {children}
        <Icon className={cn("size-3.5", !active && "text-muted-foreground")} />
      </Link>
    </TableHead>
  );
}

function Pager({ page, params, className }: { page: ContentListData["page"]; params: ContentListParams; className?: string }) {
  const step = (cursor: string | null, patch: Partial<ContentListParams>, label: string, icon: ReactNode, after?: boolean) =>
    cursor ? (
      <Button variant="outline" size="sm" className="bg-white" asChild>
        <Link href={buildHref(params, patch)} scroll={false}>{!after && icon}{label}{after && icon}</Link>
      </Button>
    ) : (
      <Button variant="outline" size="sm" className="bg-white" disabled>{!after && icon}{label}{after && icon}</Button>
    );
  return (
    <nav aria-label="Pages" className={cn("flex flex-wrap items-center justify-between gap-2 border-t border-[#f1eedf] px-4 py-3 text-sm text-muted-foreground", className)}>
      <span className="tabular-nums">Showing {page.from}–{page.to} of {page.matching}</span>
      <div className="flex gap-2">
        {step(page.prev, { before: page.prev ?? undefined, after: undefined }, "Previous", <ChevronLeft />)}
        {step(page.next, { after: page.next ?? undefined, before: undefined }, "Next", <ChevronRight />, true)}
      </div>
    </nav>
  );
}

export function ContentBrowser({
  items,
  page,
  params,
  sort,
  dir,
  view,
  categories,
  hasFilters,
}: Sorting & {
  items: ContentListItem[];
  page: ContentListData["page"];
  view: ContentView;
  categories: { id: string; name: string }[];
  hasFilters: boolean;
}) {
  const router = useRouter();
  const { openSchedule } = useScheduleDialog();
  const { run, pending } = useServerAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [tag, setTag] = useState("");

  // Drop selections that are no longer visible after filtering
  const visibleIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const ids = [...selected].filter((id) => visibleIds.has(id));
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const clear = () => setSelected(new Set());

  function scheduleSelected() {
    const chosen = items.filter((i) => ids.includes(i.id));
    const ready = chosen.filter((c) => c.missing.length === 0);
    if (!ready.length) {
      toast.error("None of the selected items are Ready to Post yet.");
      return;
    }
    if (ready.length < chosen.length) toast.info(`${chosen.length - ready.length} item(s) skipped — not ready to post.`);
    openSchedule({ contentId: ready[0].id });
  }

  if (!items.length) {
    return (
      <div className="rounded-2xl border bg-card shadow-card">
        {hasFilters ? (
          <EmptyState icon={<SearchX />} title="No content matches these filters" description="Try a different search or clear the filters." action={<Button variant="outline" asChild><Link href="/content">Clear filters</Link></Button>} />
        ) : (
          <EmptyState icon={<CircleDashed />} title="No content yet" description="Create your first video idea with the Create Content button." />
        )}
      </div>
    );
  }

  const rowMenu = (c: ContentListItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Actions" onClick={(e) => e.stopPropagation()}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem asChild>
          <Link href={`/content/${c.id}`}><SquareArrowOutUpRight />Open workspace</Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={c.missing.length > 0} onSelect={() => openSchedule({ contentId: c.id })}>
          <CalendarPlus />Schedule post
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(() => duplicateContentAction(c.id), { onSuccess: (id) => router.push(`/content/${id}`) })}>
          <Copy />Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setConfirm({ kind: "archive", ids: [c.id], title: `Archive "${c.title}"?` })}>
          <Archive />Archive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ kind: "delete", ids: [c.id], title: `Delete "${c.title}"?` })}>
          <Trash2 />Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const nextCell = (c: ContentListItem) =>
    c.next ? (
      <div className="whitespace-nowrap">
        <div className="text-sm">{c.next.day}</div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground"><PlatformIcon platform={c.next.platformId} size={12} />{c.next.time}</div>
      </div>
    ) : c.stage === "READY" ? (
      <Button variant="outline" size="sm" className="bg-white" onClick={(e) => { e.stopPropagation(); openSchedule({ contentId: c.id }); }}>
        <CalendarPlus />Schedule
      </Button>
    ) : (
      <span className="text-xs whitespace-nowrap text-muted-foreground">{c.targetLabel ? `Target ${c.targetLabel}` : "—"}</span>
    );

  const sorting = { params, sort, dir };

  return (
    <>
      {ids.length > 0 && (
        <div className="sticky top-20 z-20">
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-stone-900 px-3 py-2 text-white shadow-lg">
            <span className="mr-2 px-1 text-sm font-medium">{ids.length} selected</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" disabled={pending}><CircleDot />Change status<ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-52">
                {STATUS_FIELDS.map(([field, label, def]) => (
                  <DropdownMenuSub key={field}>
                    <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {def.options.map((o) => (
                        <DropdownMenuItem key={o.value} onSelect={() => run(() => bulkStatusAction(ids, field, o.value))}>
                          <StatusBadge def={def} value={o.value} size="sm" />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" disabled={pending}><Folder />Category<ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-52">
                <DropdownMenuLabel>Assign category</DropdownMenuLabel>
                {categories.map((c) => (
                  <DropdownMenuItem key={c.id} onSelect={() => run(() => bulkCategoryAction(ids, c.id))}>{c.name}</DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => run(() => bulkCategoryAction(ids, null))}>No category</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setTagOpen(true)}><Tag />Add tag</Button>
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={scheduleSelected}><CalendarPlus />Schedule</Button>
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setConfirm({ kind: "archive", ids, title: `Archive ${ids.length} item(s)?` })}><Archive />Archive</Button>
            <Button size="sm" variant="ghost" className="text-rose-300 hover:bg-white/10 hover:text-rose-200" onClick={() => setConfirm({ kind: "delete", ids, title: `Delete ${ids.length} item(s)?` })}><Trash2 />Delete</Button>
            <Button size="icon-sm" variant="ghost" className="ml-auto text-white hover:bg-white/10 hover:text-white" onClick={clear} aria-label="Clear selection"><X /></Button>
          </div>
        </div>
      )}

      {view === "table" ? (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
          <div className="thin-scroll overflow-x-auto">
            <Table className="min-w-[1000px]">
              <TableHeader>
                <TableRow className="bg-[#fcfbf3] hover:bg-[#fcfbf3]">
                  <TableHead className="w-10 pl-4">
                    <Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v ? new Set(items.map((i) => i.id)) : new Set())} aria-label="Select all on this page" />
                  </TableHead>
                  <SortHead col="title" {...sorting}>Content</SortHead>
                  <TableHead>Platforms</TableHead>
                  <TableHead>Production</TableHead>
                  <SortHead col="completion" {...sorting}>Checklist</SortHead>
                  <SortHead col="stage" {...sorting}>Status</SortHead>
                  <SortHead col="priority" {...sorting}>Priority</SortHead>
                  <SortHead col="next" {...sorting}>Next post</SortHead>
                  <SortHead col="created" {...sorting}>Created</SortHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined} className="cursor-pointer hover:bg-[#fdfcf4]" onClick={() => router.push(`/content/${c.id}`)}>
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(c.id)} onCheckedChange={(v) => toggle(c.id, !!v)} aria-label={`Select ${c.title}`} />
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[340px] items-center gap-3">
                        <ContentThumb src={c.thumbUrl} seed={c.id} icon={thumbIconFor(c)} durationSec={c.durationSec} className="h-12 w-20" />
                        <div className="min-w-0">
                          <Link href={`/content/${c.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{c.title}</Link>
                          <p className="truncate text-xs text-muted-foreground">{c.description || "No description"}</p>
                          <div className="mt-1 flex items-center gap-1">
                            <span className="mr-1 text-xs text-stone-600">{c.category?.name ?? "Uncategorized"} · {ContentType.label(c.contentType)}</span>
                            {c.tags.slice(0, 2).map((t) => <span key={t} className="rounded bg-[#f5f3e3] px-1.5 py-0.5 text-xs text-stone-600">#{t}</span>)}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><PlatformStack platforms={c.platforms} /></TableCell>
                    <TableCell><MiniSteps {...c} /></TableCell>
                    <TableCell className="w-32"><CompletionBar value={c.completion} /></TableCell>
                    <TableCell><StatusBadge def={Stage} value={c.stage} label={stageLabel(c.stage, c.simulated)} /></TableCell>
                    <TableCell><PriorityBadge priority={c.priority} /></TableCell>
                    <TableCell>{nextCell(c)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{c.createdLabel}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>{rowMenu(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={page} params={params} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {items.map((c) => (
              <div key={c.id} className="group overflow-hidden rounded-2xl border bg-card shadow-card transition-colors hover:border-olive-300">
                <div className="relative">
                  <Link href={`/content/${c.id}`} className="block" aria-label={c.title}>
                    <ContentThumb src={c.thumbUrl} seed={c.id} icon={thumbIconFor(c)} durationSec={c.durationSec} className="aspect-video w-full rounded-none" />
                  </Link>
                  {/* 24px target (WCAG 2.5.8): it sits on top of the card's image link */}
                  <div className="absolute top-2 left-2 rounded-md bg-white/90 p-0.5">
                    <Checkbox className="size-6" checked={selected.has(c.id)} onCheckedChange={(v) => toggle(c.id, !!v)} aria-label={`Select ${c.title}`} />
                  </div>
                  <div className="absolute top-2.5 right-2.5"><StatusBadge def={Stage} value={c.stage} label={stageLabel(c.stage, c.simulated)} className="shadow-sm" /></div>
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{c.category?.name ?? "Uncategorized"} · {ContentType.label(c.contentType)}</span>
                    <PlatformStack platforms={c.platforms} />
                  </div>
                  <Link href={`/content/${c.id}`} className="mt-1.5 line-clamp-2 min-h-10 font-medium hover:underline">{c.title}</Link>
                  <div className="mt-3 flex items-center justify-between">
                    <MiniSteps {...c} />
                    <PriorityBadge priority={c.priority} />
                  </div>
                  <CompletionBar value={c.completion} className="mt-3" />
                  <div className="mt-3 flex min-h-9 items-center justify-between gap-2 border-t border-[#f3f1e4] pt-3 text-xs">
                    {c.missing.length ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-amber-800"><CircleAlert className="size-3.5 shrink-0" /><span className="truncate">{c.missing[0].label}{c.missing.length > 1 ? ` +${c.missing.length - 1}` : ""}</span></span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-olive-700"><CircleCheck className="size-3.5" />All assets ready</span>
                    )}
                    <div className="flex shrink-0 items-center gap-1">
                      {nextCell(c)}
                      {rowMenu(c)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
            <Pager page={page} params={params} className="border-t-0" />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        destructive={confirm?.kind === "delete"}
        confirmLabel={confirm?.kind === "delete" ? "Delete" : "Archive"}
        description={
          confirm?.kind === "delete"
            ? "This permanently removes the content, its script versions, uploaded media and schedules. This cannot be undone."
            : "Archived content is hidden from lists and its pending posts are cancelled. You can restore it from Settings."
        }
        onConfirm={() => {
          if (!confirm) return;
          const target = confirm.ids;
          run(() => (confirm.kind === "delete" ? deleteContentAction(target) : archiveContentAction(target)), { onSuccess: clear });
        }}
      />

      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a tag</DialogTitle>
            <DialogDescription>The tag is added to {ids.length} selected item(s).</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => bulkTagAction(ids, tag), { onSuccess: () => { setTag(""); setTagOpen(false); } });
            }}
          >
            <Input autoFocus value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. evergreen" />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setTagOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!tag.trim() || pending}><Tag />Add tag</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
