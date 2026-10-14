"use client";

import {
  AlignLeft,
  Copy,
  CopyPlus,
  FileText,
  Hash,
  Heading,
  ImageIcon,
  Lightbulb,
  type LucideIcon,
  PanelsTopLeft,
  Pencil,
  Plus,
  Search,
  SearchX,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/content-bits";
import { TONE_CLASSES } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { AiProvider, PromptCategory, type PromptCategoryCode, type Tone } from "@/lib/workflow/statuses";
import { deletePromptAction, duplicatePromptAction } from "@/server/actions/workspace";
import type { PromptItem } from "@/server/queries/prompts";
import { PromptEditorDialog, splitVariables } from "./prompt-editor";

export const CATEGORY_ICONS: Record<PromptCategoryCode, LucideIcon> = {
  VIDEO_IDEA: Lightbulb,
  SCRIPT: FileText,
  IMAGE: ImageIcon,
  THUMBNAIL: PanelsTopLeft,
  TITLE: Heading,
  DESCRIPTION: AlignLeft,
  HASHTAGS: Hash,
};

const ALL = "ALL";
type Filter = PromptCategoryCode | typeof ALL;

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex h-[22px] shrink-0 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap", TONE_CLASSES[tone])}>{children}</span>;
}

function matches(p: PromptItem, q: string) {
  if (!q) return true;
  return `${p.name}\n${p.content}\n${PromptCategory.label(p.category)}\n${AiProvider.label(p.provider)}`.toLowerCase().includes(q);
}

export function PromptLibrary({ prompts, initialCategory }: { prompts: PromptItem[]; initialCategory: PromptCategoryCode | null }) {
  const [category, setCategory] = useState<Filter>(initialCategory ?? ALL);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PromptItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const q = query.trim().toLowerCase();

  const searched = useMemo(() => prompts.filter((p) => matches(p, q)), [prompts, q]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { [ALL]: searched.length };
    for (const p of searched) c[p.category] = (c[p.category] ?? 0) + 1;
    return c;
  }, [searched]);
  const visible = category === ALL ? searched : searched.filter((p) => p.category === category);

  function selectCategory(next: Filter) {
    setCategory(next);
    // Keep the tab in the URL (shareable, survives refresh) without a server round trip
    const url = new URL(window.location.href);
    if (next === ALL) url.searchParams.delete("category");
    else url.searchParams.set("category", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  const tabs: { value: Filter; label: string; icon?: LucideIcon }[] = [
    { value: ALL, label: "All" },
    ...PromptCategory.options.map((o) => ({ value: o.value, label: o.label, icon: CATEGORY_ICONS[o.value] })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="thin-scroll -mx-1 max-w-[calc(100%+0.5rem)] overflow-x-auto px-1 pb-0.5">
          <div role="group" aria-label="Filter by category" className="inline-flex gap-1 rounded-xl border border-[#ebe7c6] bg-secondary p-1">
            {tabs.map((t) => {
              const active = category === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectCategory(t.value)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                    active ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.icon && <t.icon className="size-3.5" aria-hidden />}
                  {t.label}
                  <span className="text-xs text-muted-foreground tabular-nums">{counts[t.value] ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 bg-white pr-9 pl-9" placeholder="Search prompts" aria-label="Search prompts" />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Clear search">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {visible.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <PromptCard
              key={p.id}
              prompt={p}
              onEdit={() => {
                setEditing(p);
                setEditorOpen(true);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border bg-card shadow-card">
          {q ? (
            <EmptyState
              icon={<SearchX />}
              title={`No prompts match “${query.trim()}”`}
              description={category === ALL ? "Try another word, or clear the search." : `Nothing in ${PromptCategory.label(category)} matches — try All or clear the search.`}
              action={
                <Button variant="outline" className="bg-white" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Sparkles />}
              title={category === ALL ? "No prompts yet" : `No ${PromptCategory.label(category).toLowerCase()} prompts yet`}
              description="Save the prompts you reuse so every video starts from a proven template."
              action={
                <PromptEditorDialog
                  defaultCategory={category === ALL ? "VIDEO_IDEA" : category}
                  trigger={
                    <Button>
                      <Plus />
                      New prompt
                    </Button>
                  }
                />
              }
            />
          )}
        </div>
      )}

      {editing && <PromptEditorDialog prompt={editing} open={editorOpen} onOpenChange={setEditorOpen} />}
    </div>
  );
}

function IconAction({ label, onClick, disabled, className, children }: { label: string; onClick: () => void; disabled?: boolean; className?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick} className={className}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function PromptCard({ prompt: p, onEdit }: { prompt: PromptItem; onEdit: () => void }) {
  const { run, pending } = useServerAction();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const Icon = CATEGORY_ICONS[p.category as PromptCategoryCode] ?? Sparkles;

  async function copy() {
    try {
      await navigator.clipboard.writeText(p.content);
      toast.success("Prompt copied");
    } catch {
      toast.error("Couldn't copy the prompt", { description: "Your browser blocked clipboard access — select the text and copy it manually." });
    }
  }

  return (
    <article className="flex flex-col rounded-2xl border bg-card shadow-card transition-colors hover:border-olive-200">
      <div className="flex-1 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-olive-50 text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="leading-snug font-medium">
              <button type="button" onClick={onEdit} className="text-left hover:text-primary focus-visible:underline focus-visible:outline-none">
                {p.name}
              </button>
            </h2>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Pill tone="neutral">{PromptCategory.label(p.category)}</Pill>
              <Pill tone={AiProvider.tone(p.provider)}>{AiProvider.label(p.provider)}</Pill>
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-[#f1eedf] bg-[#fcfbf3] p-3">
          <p className="line-clamp-5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-stone-700">
            {splitVariables(p.content).map((part, i) =>
              i % 2 === 1 ? (
                <span key={i} className="rounded bg-olive-50 px-0.5 text-olive-700 ring-1 ring-olive-100">
                  {part}
                </span>
              ) : (
                part
              ),
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[#f3f1e4] py-2 pr-3 pl-5">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          Updated {p.updatedLabel} · created {p.createdLabel}
        </span>
        <div className="flex shrink-0 gap-0.5">
          <IconAction label="Copy prompt" onClick={copy}>
            <Copy />
          </IconAction>
          <IconAction label="Edit" onClick={onEdit}>
            <Pencil />
          </IconAction>
          <IconAction label="Duplicate" disabled={pending} onClick={() => run(() => duplicatePromptAction(p.id), { success: `Duplicated “${p.name}”` })}>
            <CopyPlus />
          </IconAction>
          <IconAction label="Delete" disabled={pending} onClick={() => setConfirmOpen(true)} className="text-rose-700 hover:bg-rose-50 hover:text-rose-800">
            <Trash2 />
          </IconAction>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete “${p.name}”?`}
        description="Scripts and image prompts already created from it keep their own copy."
        onConfirm={() => run(() => deletePromptAction(p.id), { success: "Prompt deleted" })}
      />
    </article>
  );
}
