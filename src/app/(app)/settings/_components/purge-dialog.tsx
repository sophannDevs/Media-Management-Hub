"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface PurgeTarget {
  id: string;
  title: string;
  /** Posts of it that went live: their history goes with it, so the title has to be typed back */
  publishedPosts: number;
}

/**
 * "Delete permanently" (WF-05). Content none of whose posts went live is
 * removed on a plain confirmation; content that was published somewhere is
 * only removed once its title is typed back, because that publishing history
 * (post links, attempts, analytics) can't be recovered.
 */
export function PurgeDialog({ item, pending, onClose, onConfirm }: { item: PurgeTarget | null; pending: boolean; onClose: () => void; onConfirm: (item: PurgeTarget, typedTitle: string) => void }) {
  const [typed, setTyped] = useState("");
  const needsTitle = (item?.publishedPosts ?? 0) > 0;
  const matches = !needsTitle || typed.trim() === item?.title;
  const close = () => {
    setTyped("");
    onClose();
  };
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{item?.title}” permanently?</DialogTitle>
          <DialogDescription>
            {needsTitle
              ? `${item!.publishedPosts} post${item!.publishedPosts === 1 ? "" : "s"} of it went live. Removing it also removes that publishing history: the post links, the attempts and the analytics. Type the title to confirm.`
              : "The script, media files, schedules and analytics of this content are removed too. This can't be undone."}
          </DialogDescription>
        </DialogHeader>
        {needsTitle && (
          <div className="space-y-1.5">
            <label htmlFor="purge-title" className="text-sm font-medium">
              Type the title to confirm
            </label>
            <Input id="purge-title" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={item?.title} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending || !matches} onClick={() => item && onConfirm(item, typed)}>
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
