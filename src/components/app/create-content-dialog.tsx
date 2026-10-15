"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutosaveDraft, useLoadedDraft } from "@/hooks/use-draft";
import { useServerAction } from "@/hooks/use-server-action";
import { browserStore, clearDraft } from "@/lib/drafts";
import { CREATE_CONTENT_EVENT } from "@/lib/shortcuts";
import { createContentAction } from "@/server/actions/content";
import type { ContentFormOptions } from "@/server/queries/shared";
import { type CreateContentValues, DRAFT_KEY, initialForm, NONE } from "./create-content-state";

// The form body is a separate chunk (PERF-10): it downloads when someone points at
// the button or opens the dialog, instead of with every page.
const loadForm = () => import("./create-content-form").then((m) => ({ default: m.CreateContentForm }));
const CreateContentForm = lazy(loadForm);

export function CreateContentDialog({ options, trigger, listen = false }: { options: ContentFormOptions; trigger?: ReactNode; /** Opens when the `c` shortcut is pressed (only the header's instance does) */ listen?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!listen) return;
    const onShortcut = () => setOpen(true);
    window.addEventListener(CREATE_CONTENT_EVENT, onShortcut);
    return () => window.removeEventListener(CREATE_CONTENT_EVENT, onShortcut);
  }, [listen]);
  const router = useRouter();
  const { run, pending } = useServerAction();
  const [form, setForm] = useState(() => initialForm(options));
  const set = <K extends keyof CreateContentValues>(k: K, v: CreateContentValues[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Unfinished input is kept in this browser (UX-03): a reload or a closed tab doesn't lose it, and
  // the next visit offers it back instead of applying it on its own.
  const blank = useMemo(() => JSON.stringify(initialForm(options)), [options]);
  const dirty = JSON.stringify(form) !== blank;
  const local = useLoadedDraft<CreateContentValues>(DRAFT_KEY);
  const [offerResolved, setOfferResolved] = useState(false);
  const offer = local && JSON.stringify(local.value) !== blank && !offerResolved ? local : null;
  useAutosaveDraft(DRAFT_KEY, form, { dirty, paused: !!offer });

  function submit(openWorkspace: boolean) {
    run(
      () =>
        createContentAction({
          ...form,
          categoryId: form.categoryId === NONE ? null : form.categoryId,
          seriesId: form.seriesId === NONE ? null : form.seriesId,
          campaignId: form.campaignId === NONE ? null : form.campaignId,
          targetPublishDate: form.targetPublishDate || null,
        }),
      {
        success: openWorkspace ? "Content created — opening workspace" : "Saved as idea",
        onSuccess: (id) => {
          setOpen(false);
          setForm(initialForm(options));
          if (openWorkspace) router.push(`/content/${id}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Pointing at the button (or tabbing to it, or touching it) is the cue to fetch the form */}
      <DialogTrigger asChild onPointerEnter={() => void loadForm()} onFocus={() => void loadForm()} onTouchStart={() => void loadForm()}>
        {trigger ?? (
          <Button aria-label="Create content">
            <Plus />
            <span className="hidden sm:inline">Create Content</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <Suspense
          fallback={
            <div className="space-y-4 p-6">
              <DialogTitle className="text-lg">Create content</DialogTitle>
              <DialogDescription className="sr-only">Loading the form</DialogDescription>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          }
        >
          <CreateContentForm
            options={options}
            form={form}
            set={set}
            pending={pending}
            dirty={dirty}
            offer={offer}
            onSubmit={submit}
            onCancel={() => setOpen(false)}
            onRestore={() => {
              if (!offer) return;
              setForm({ ...initialForm(options), ...offer.value });
              setOfferResolved(true);
            }}
            onDiscard={() => {
              const store = browserStore();
              if (store) clearDraft(store, DRAFT_KEY);
              setOfferResolved(true);
            }}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
