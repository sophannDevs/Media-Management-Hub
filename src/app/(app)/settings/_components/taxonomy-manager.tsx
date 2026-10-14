"use client";

import { Pencil, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useServerAction } from "@/hooks/use-server-action";
import { createTaxonomyAction, deleteTaxonomyAction, renameTaxonomyAction } from "@/server/actions/workspace";
import type { SettingsData, TaxonomyItem } from "@/server/queries/settings";
import type { TaxonomyKind } from "@/server/services/workspace";
import { SettingsCard } from "./settings-card";

const GROUPS: { kind: TaxonomyKind; label: string; singular: string; hint: string }[] = [
  { kind: "category", label: "Categories", singular: "category", hint: "The topic of each video — used for filters and reports." },
  { kind: "series", label: "Series", singular: "series", hint: "Recurring shows or formats." },
  { kind: "campaign", label: "Campaigns", singular: "campaign", hint: "Time-boxed pushes that group several videos." },
];

const usageLabel = (n: number) => (n ? `Used by ${n} content item${n === 1 ? "" : "s"}` : "Not used yet");

export function TaxonomyManager({ taxonomies }: { taxonomies: SettingsData["taxonomies"] }) {
  return (
    <SettingsCard id="labels" title="Categories, series & campaigns" description="Labels used to organise and filter content. The number shows how many content items use each one.">
      <div className="divide-y divide-[#f3f1e4]">
        {GROUPS.map((g) => (
          <TaxonomyGroup key={g.kind} group={g} items={taxonomies[g.kind]} />
        ))}
      </div>
    </SettingsCard>
  );
}

function TaxonomyGroup({ group, items }: { group: (typeof GROUPS)[number]; items: TaxonomyItem[] }) {
  const { run, pending } = useServerAction();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [target, setTarget] = useState<TaxonomyItem | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function add() {
    const name = newName.trim();
    if (!name) return setAdding(false);
    run(() => createTaxonomyAction(group.kind, name), {
      success: `Added “${name}”`,
      onSuccess: () => {
        setNewName("");
        inputRef.current?.focus();
      },
    });
  }

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-sm font-medium">{group.label}</h3>
        <p className="text-xs text-muted-foreground">{group.hint}</p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label={group.label}>
        {items.map((item) => (
          <li key={item.id} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#ece9d6] bg-[#fcfbf3] pr-1 pl-3 text-sm">
            <span className="max-w-[220px] truncate">{item.name}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="ml-0.5 rounded-full bg-white px-1.5 text-xs text-muted-foreground tabular-nums ring-1 ring-[#ece9d6] outline-none focus-visible:ring-ring" aria-label={usageLabel(item.count)}>
                  {item.count}
                </span>
              </TooltipTrigger>
              <TooltipContent>{usageLabel(item.count)}</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Rename ${item.name}`}
              className="text-stone-500"
              onClick={() => {
                setTarget(item);
                setRenameOpen(true);
              }}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${item.name}`}
              className="text-stone-500 hover:bg-rose-50 hover:text-rose-700"
              onClick={() => {
                setTarget(item);
                setRemoveOpen(true);
              }}
            >
              <X />
            </Button>
          </li>
        ))}
        <li>
          {adding ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <Input
                ref={inputRef}
                autoFocus
                maxLength={80}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setNewName("");
                    setAdding(false);
                  }
                }}
                placeholder={`New ${group.singular}`}
                aria-label={`New ${group.singular} name`}
                className="h-8 w-48 bg-white"
              />
              <Button type="submit" size="sm" className="h-8" disabled={pending || !newName.trim()}>
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Cancel"
                onClick={() => {
                  setNewName("");
                  setAdding(false);
                }}
              >
                <X />
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-stone-300 px-3 text-sm text-stone-600 hover:border-olive-300 hover:bg-white hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Add {group.singular}
            </button>
          )}
        </li>
      </ul>
      {items.length === 0 && !adding && <p className="mt-2 text-xs text-muted-foreground">No {group.label.toLowerCase()} yet.</p>}

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        item={target}
        singular={group.singular}
        pending={pending}
        onSave={(name) =>
          target &&
          run(() => renameTaxonomyAction(group.kind, target.id, name), {
            success: `Renamed to “${name}”`,
            onSuccess: () => setRenameOpen(false),
          })
        }
      />
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove “${target?.name ?? ""}”?`}
        description={
          <>
            Content using it keeps working but loses this label.
            {target && target.count > 0 && ` ${target.count} content item${target.count === 1 ? " uses" : "s use"} it.`}
          </>
        }
        confirmLabel="Remove"
        onConfirm={() => target && run(() => deleteTaxonomyAction(group.kind, target.id), { success: `Removed “${target.name}”` })}
      />
    </div>
  );
}

function RenameDialog({
  open,
  onOpenChange,
  item,
  singular,
  pending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: TaxonomyItem | null;
  singular: string;
  pending: boolean;
  onSave: (name: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {item && <RenameForm key={item.id} item={item} singular={singular} pending={pending} onSave={onSave} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ item, singular, pending, onSave, onCancel }: { item: TaxonomyItem; singular: string; pending: boolean; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(item.name);
  const trimmed = name.trim();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && trimmed !== item.name) onSave(trimmed);
        else onCancel();
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename {singular}</DialogTitle>
        <DialogDescription>{usageLabel(item.count)} — the new name shows everywhere right away.</DialogDescription>
      </DialogHeader>
      <Input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-label={`${singular} name`} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !trimmed}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
