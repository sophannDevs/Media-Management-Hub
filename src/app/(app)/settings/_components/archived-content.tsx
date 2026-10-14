"use client";

import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/content-bits";
import { ContentThumb, thumbIconFor } from "@/components/app/content-thumb";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";
import { archiveContentAction, deleteContentAction } from "@/server/actions/content";
import type { ArchivedItem } from "@/server/queries/settings";
import { SettingsCard } from "./settings-card";

export function ArchivedContent({ items }: { items: ArchivedItem[] }) {
  const { run, pending } = useServerAction();
  const [target, setTarget] = useState<ArchivedItem | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
                  </p>
                </div>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <Button variant="outline" size="sm" className="bg-white" disabled={pending} onClick={() => run(() => archiveContentAction([c.id], false), { success: `Restored “${c.title}”` })}>
                  <ArchiveRestore />
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                  disabled={pending}
                  onClick={() => {
                    setTarget(c);
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 />
                  Delete permanently
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete “${target?.title ?? ""}” permanently?`}
        description="The script, media files, schedules and analytics of this content are removed too. This can't be undone."
        confirmLabel="Delete permanently"
        onConfirm={() => target && run(() => deleteContentAction([target.id]), { success: `Deleted “${target.title}”` })}
      />
    </SettingsCard>
  );
}
