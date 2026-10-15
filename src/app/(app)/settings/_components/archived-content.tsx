"use client";

import { Archive, ArchiveRestore, CalendarClock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/app/content-bits";
import { ContentThumb, thumbIconFor } from "@/components/app/content-thumb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useServerAction } from "@/hooks/use-server-action";
import { purgeContentAction, restoreContentAction } from "@/server/actions/content";
import type { ArchivedItem } from "@/server/queries/settings";
import { PurgeDialog, type PurgeTarget } from "./purge-dialog";
import { SettingsCard } from "./settings-card";

export function ArchivedContent({ items }: { items: ArchivedItem[] }) {
  const { run, pending } = useServerAction();
  const [purging, setPurging] = useState<PurgeTarget | null>(null);
  // Restoring content whose posts archiving cancelled asks whether they go back in the queue (WF-07)
  const [restoring, setRestoring] = useState<ArchivedItem | null>(null);

  const restore = (c: ArchivedItem, withPosts: boolean) => run(() => restoreContentAction([c.id], withPosts), { onSuccess: () => setRestoring(null) });

  return (
    <SettingsCard
      id="archive"
      title="Archived content"
      description={items.length ? `${items.length} archived item${items.length === 1 ? "" : "s"} — hidden from lists and never published. Restore or delete permanently.` : "Archived content is hidden from lists and never published."}
    >
      {items.length === 0 ? (
        <EmptyState icon={<Archive />} title="Nothing archived" description="When you archive a video from the content list it appears here, ready to restore." className="py-10" />
      ) : (
        <ul className="divide-y divide-[#f3f1e4]">
          {items.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <ContentThumb src={c.thumbUrl} seed={c.id} icon={thumbIconFor(c)} className="h-10 w-16" />
                <div className="min-w-0">
                  <Link href={`/content/${c.id}`} className="block truncate text-sm font-medium hover:text-primary">
                    {c.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    Archived {c.archivedLabel}
                    {c.category && ` · ${c.category}`}
                    {c.pausedPosts > 0 && ` · ${c.pausedPosts} post${c.pausedPosts === 1 ? "" : "s"} taken out of the queue`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <Button variant="outline" size="sm" className="bg-white" disabled={pending} onClick={() => (c.pausedPosts > 0 ? setRestoring(c) : restore(c, true))}>
                  <ArchiveRestore />
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                  disabled={pending}
                  onClick={() => setPurging(c)}
                >
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
              Archiving took {restoring?.pausedPosts} post{restoring?.pausedPosts === 1 ? "" : "s"} out of the queue. Put them back as they were? Posts whose time has passed
              stay cancelled.
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
