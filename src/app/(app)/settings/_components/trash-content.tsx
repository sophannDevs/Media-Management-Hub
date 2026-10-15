"use client";

import { ArchiveRestore, CalendarClock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/app/content-bits";
import { ContentThumb, thumbIconFor } from "@/components/app/content-thumb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useServerAction } from "@/hooks/use-server-action";
import { purgeContentAction, restoreFromTrashAction } from "@/server/actions/content";
import type { TrashItem } from "@/server/queries/settings";
import { PurgeDialog, type PurgeTarget } from "./purge-dialog";
import { SettingsCard } from "./settings-card";

/**
 * The trash (WF-05): deleted content, kept for the retention period and
 * restorable until the worker removes it for good. Content that went live is
 * never removed automatically; only a person can, by typing its title.
 */
export function TrashContent({ items, days }: { items: TrashItem[]; days: number }) {
  const { run, pending } = useServerAction();
  const [purging, setPurging] = useState<PurgeTarget | null>(null);
  // Restoring content whose posts were taken out of the queue asks whether they go back (as the archive does)
  const [restoring, setRestoring] = useState<TrashItem | null>(null);

  const restore = (c: TrashItem, withPosts: boolean) => run(() => restoreFromTrashAction([c.id], withPosts), { onSuccess: () => setRestoring(null) });

  return (
    <SettingsCard
      id="trash"
      title="Trash"
      description={
        items.length
          ? `${items.length} deleted item${items.length === 1 ? "" : "s"} — hidden everywhere, kept for ${days} days, then removed for good. Content that was published somewhere stays until you remove it yourself.`
          : `Deleted content stays here for ${days} days before it is removed for good. Content that was published somewhere stays until you remove it yourself.`
      }
    >
      {items.length === 0 ? (
        <EmptyState icon={<Trash2 />} title="The trash is empty" description="When you delete a video from the content list it comes here first, ready to restore." className="py-10" />
      ) : (
        <ul className="divide-y divide-[#f3f1e4]" aria-label="Trash">
          {items.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <ContentThumb src={c.thumbUrl} seed={c.id} icon={thumbIconFor(c)} className="h-10 w-16" />
                <div className="min-w-0">
                  <Link href={`/content/${c.id}`} className="block truncate text-sm font-medium hover:text-primary">
                    {c.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    Deleted {c.deletedLabel}
                    {c.category && ` · ${c.category}`}
                    {c.publishedPosts > 0 ? ` · ${c.publishedPosts} published post${c.publishedPosts === 1 ? "" : "s"}: kept until you remove it` : c.purgeLabel ? ` · removed for good on ${c.purgeLabel}` : ""}
                    {c.pausedPosts > 0 && !c.fromArchive && ` · ${c.pausedPosts} post${c.pausedPosts === 1 ? "" : "s"} taken out of the queue`}
                    {c.fromArchive && " · was archived"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <Button variant="outline" size="sm" className="bg-white" disabled={pending} onClick={() => (c.pausedPosts > 0 && !c.fromArchive ? setRestoring(c) : restore(c, true))}>
                  <ArchiveRestore />
                  Restore
                </Button>
                <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800" disabled={pending} onClick={() => setPurging(c)}>
                  <Trash2 />
                  Delete permanently
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!restoring} onOpenChange={(o) => !o && setRestoring(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restore “{restoring?.title}”?</DialogTitle>
            <DialogDescription>
              Deleting took {restoring?.pausedPosts} post{restoring?.pausedPosts === 1 ? "" : "s"} out of the queue. Put them back as they were? Posts whose time has passed stay cancelled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => restoring && restore(restoring, false)}>
              Restore without posts
            </Button>
            <Button disabled={pending} onClick={() => restoring && restore(restoring, true)}>
              <CalendarClock />
              Restore with posts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PurgeDialog item={purging} pending={pending} onClose={() => setPurging(null)} onConfirm={(item, typed) => run(() => purgeContentAction([item.id], typed), { success: `Deleted “${item.title}” permanently`, onSuccess: () => setPurging(null) })} />
    </SettingsCard>
  );
}
