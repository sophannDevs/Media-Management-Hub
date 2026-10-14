"use client";

import { Bookmark, BookmarkPlus, Check, ChevronDown, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerAction } from "@/hooks/use-server-action";
import { type ContentListParams, viewQuery } from "@/lib/content-list";
import { cn } from "@/lib/utils";
import { deleteViewAction, saveViewAction } from "@/server/actions/content";

export type SavedViewItem = { id: string; name: string; query: string };

/**
 * Named sets of tab, filters, search and sort, kept per user (UX-02). The view
 * the list is showing right now is ticked and can be deleted from here.
 */
export function SavedViews({ views, params }: { views: SavedViewItem[]; params: ContentListParams }) {
  const current = viewQuery(params);
  const active = views.find((v) => v.query === current) ?? null;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const { run, pending } = useServerAction();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-10 max-w-56 bg-white" aria-label={active ? `Saved views, showing ${active.name}` : "Saved views"}>
            <Bookmark />
            <span className="truncate">{active ? active.name : "Views"}</span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {views.length === 0 && <p className="px-2 pb-2 text-xs text-muted-foreground">None yet. Pick a tab, filters and a sort, then save them here.</p>}
          {views.map((v) => (
            <DropdownMenuItem key={v.id} asChild>
              <Link href={v.query ? `/content?${v.query}` : "/content"}>
                <Check className={cn(v.id === active?.id ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{v.name}</span>
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setName(active?.name ?? "");
              setSaving(true);
            }}
          >
            <BookmarkPlus />
            Save current view…
          </DropdownMenuItem>
          {active && (
            <DropdownMenuItem variant="destructive" disabled={pending} onSelect={() => run(() => deleteViewAction(active.id))}>
              <Trash2 />
              <span className="truncate">Delete “{active.name}”</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>Keeps the current tab, filters, search and sort under a name. Saving under an existing name replaces that view.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveViewAction(name, current), { onSuccess: () => setSaving(false) });
            }}
          >
            <Label htmlFor="saved-view-name">Name</Label>
            <Input id="saved-view-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ready for YouTube" />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setSaving(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || pending}>
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
