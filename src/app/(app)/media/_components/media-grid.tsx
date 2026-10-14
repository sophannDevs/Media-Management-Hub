"use client";

import { Download, Ellipsis, ExternalLink, Eye, File, FileX, FolderInput, Link2, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ComponentProps, type ReactNode, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Field } from "@/components/app/create-content-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDuration } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { assignMediaAction, deleteMediaAction } from "@/server/actions/media";
import type { MediaContentOption, MediaItem } from "@/server/queries/media";
import { AssetVisual } from "./asset-visual";
import { MEDIA_TYPE_ICONS } from "./media-types";

type Action = "preview" | "move" | "delete";
const UNASSIGNED = "__none";

export function MediaGrid({ items, contents }: { items: MediaItem[]; contents: MediaContentOption[] }) {
  // One instance of each dialog for the whole grid; `active` is kept while a dialog animates out
  const [active, setActive] = useState<{ action: Action; asset: MediaItem } | null>(null);
  const [open, setOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { run, pending } = useServerAction();

  function show(action: Action, asset: MediaItem) {
    setActive({ action, asset });
    setOpen(true);
  }
  const controlled = (action: Action) => ({
    open: open && active?.action === action,
    onOpenChange: (o: boolean) => {
      if (!o) setOpen(false);
    },
  });
  const asset = active?.asset;

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-6">
        {items.map((a) => (
          <li key={a.id} className="min-w-0">
            <AssetCard asset={a} busy={pending && deletingId === a.id} onAction={(action) => show(action, a)} />
          </li>
        ))}
      </ul>

      <Dialog {...controlled("preview")}>
        <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
          {asset && <PreviewBody asset={asset} onAction={(action) => show(action, asset)} />}
        </DialogContent>
      </Dialog>

      <Dialog {...controlled("move")}>
        <DialogContent className="gap-0 p-0 sm:max-w-md">
          {asset && <MoveForm key={asset.id} asset={asset} contents={contents} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        {...controlled("delete")}
        title={asset ? `Delete ${asset.fileName}?` : "Delete file?"}
        confirmLabel={asset?.inUse ? "Delete anyway" : "Delete"}
        description={
          asset && (
            <>
              {asset.inUse ? <span className="font-medium text-foreground">{asset.deleteWarning}</span> : asset.deleteWarning}
              {asset.deleteNote && ` ${asset.deleteNote}`}
              {" This can't be undone."}
            </>
          )
        }
        onConfirm={() => {
          if (!asset) return;
          setDeletingId(asset.id);
          run(() => deleteMediaAction(asset.id));
        }}
      />
    </>
  );
}

function AssetCard({ asset: a, busy, onAction }: { asset: MediaItem; busy: boolean; onAction: (action: Action) => void }) {
  const TypeIcon = MEDIA_TYPE_ICONS[a.type] ?? File;
  const timed = ["VIDEO", "AUDIO", "MUSIC"].includes(a.type) && !!a.durationSec;
  return (
    <article
      aria-busy={busy}
      className={cn("group overflow-hidden rounded-2xl border bg-card shadow-card transition-[border-color,opacity] hover:border-olive-300", busy && "pointer-events-none opacity-50")}
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => onAction("preview")}
          aria-label={`Preview ${a.fileName}`}
          // An outline (unlike a ring) is painted above the image
          className="block w-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <AssetVisual asset={a} className="aspect-video w-full" />
        </button>
        <span className="pointer-events-none absolute top-2 left-2 inline-flex h-[22px] items-center gap-1 rounded-full border border-white bg-white/90 px-2 text-[11px] font-medium text-stone-700">
          <TypeIcon className="size-3" />
          {a.typeLabel}
        </span>
        {a.external && (
          <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-black/65 px-1.5 text-[10px] font-medium text-white">
            <Link2 className="size-3" />
            Link
          </span>
        )}
        {timed && (
          <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/65 px-1.5 text-[10px] font-medium text-white tabular-nums">
            {formatDuration(a.durationSec)}
          </span>
        )}
        <AssetMenu asset={a} onAction={onAction} />
      </div>
      <div className="p-3">
        <p className="truncate text-xs font-medium" title={a.fileName}>
          {a.fileName}
        </p>
        {a.content ? (
          <Link href={a.content.href} title={a.content.title} className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">
            <Link2 className="size-3 shrink-0" />
            <span className="truncate">{a.content.title}</span>
          </Link>
        ) : (
          <p className="mt-0.5 text-[11px] text-stone-400">Unassigned</p>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">
            {a.size} · {a.date}
          </span>
          <span title={a.usageLabel} className={cn("shrink-0", a.inUse && "font-medium text-olive-700")}>
            {a.inUse ? "In use" : "Unused"}
          </span>
        </div>
      </div>
    </article>
  );
}

function AssetMenu({ asset: a, onAction }: { asset: MediaItem; onAction: (action: Action) => void }) {
  return (
    // Non-modal: its items open dialogs, and two modal layers handing off focus can leave the page inert
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Actions for ${a.fileName}`}
          className="absolute top-2 right-2 border-white bg-white/95 shadow-sm hover:bg-white focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => onAction("preview")}>
          <Eye />
          Preview
        </DropdownMenuItem>
        {a.downloadUrl ? (
          <DropdownMenuItem asChild>
            <DownloadLink asset={a} />
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <Download />
            No file to download
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onAction("move")}>
          <FolderInput />
          Move to content
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete")}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Uploaded files download through the files route; external links open in a new tab. */
function DownloadLink({ asset: a, className, ...props }: { asset: MediaItem } & ComponentProps<"a">) {
  if (!a.downloadUrl) return null;
  return (
    <a
      {...props}
      href={a.downloadUrl}
      className={className}
      {...(a.external ? { target: "_blank", rel: "noopener noreferrer" } : { download: a.fileName })}
    >
      {a.external ? <ExternalLink /> : <Download />}
      {a.external ? "Open link" : "Download"}
    </a>
  );
}

function hostname(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function PreviewBody({ asset: a, onAction }: { asset: MediaItem; onAction: (action: Action) => void }) {
  const facts = [a.typeLabel, a.size, a.dimensions, a.durationSec ? formatDuration(a.durationSec) : null].filter(Boolean).join(" · ");
  return (
    <>
      <DialogHeader className="border-b border-[#f1eedf] px-5 py-4 pr-12">
        <DialogTitle className="truncate text-base font-semibold" title={a.fileName}>
          {a.fileName}
        </DialogTitle>
        <DialogDescription>{facts}</DialogDescription>
      </DialogHeader>

      <PreviewMedia asset={a} />

      <dl className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-2">
        <Meta label="Content">
          {a.content ? (
            <Link href={a.content.href} className="font-medium hover:text-primary">
              {a.content.title}
            </Link>
          ) : (
            "Unassigned"
          )}
        </Meta>
        <Meta label="Usage">
          <span className={cn(a.inUse && "font-medium text-olive-700")}>{a.inUse ? a.usageLabel : "Not in use"}</span>
        </Meta>
        <Meta label={a.external ? "Linked" : "Added"}>{a.createdAt}</Meta>
        <Meta label="Source">{a.external ? `External link · ${hostname(a.url)}` : a.url ? `Uploaded file · ${a.mimeType}` : "Metadata only (demo data)"}</Meta>
      </dl>

      <DialogFooter className="mx-0 mb-0 border-t border-[#f1eedf] bg-[#fcfbf3] px-5 py-3">
        <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto" onClick={() => onAction("delete")}>
          <Trash2 />
          Delete
        </Button>
        <Button variant="outline" className="bg-white" onClick={() => onAction("move")}>
          <FolderInput />
          Move to content
        </Button>
        {a.downloadUrl ? (
          <Button asChild>
            <DownloadLink asset={a} />
          </Button>
        ) : (
          <Button disabled>
            <Download />
            Download
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function PreviewMedia({ asset: a }: { asset: MediaItem }) {
  if (!a.url) {
    return (
      <div className="relative">
        <AssetVisual asset={a} large className="aspect-video w-full" />
        <p className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-4 py-2.5 text-sm text-white">
          <FileX className="size-4 shrink-0" />
          No file stored for this demo asset
        </p>
      </div>
    );
  }
  switch (a.type) {
    case "IMAGE":
    case "THUMBNAIL":
      return (
        <div className="flex justify-center bg-stone-100">
          {/* eslint-disable-next-line @next/next/no-img-element -- user media served from /api/files, sizes vary */}
          <img src={a.url} alt={a.fileName} className="max-h-[65vh] w-auto max-w-full object-contain" />
        </div>
      );
    case "VIDEO":
      return <video controls preload="metadata" poster={a.posterUrl ?? undefined} src={a.url} className="aspect-video max-h-[65vh] w-full bg-black" />;
    case "AUDIO":
    case "MUSIC":
      return (
        <div className="space-y-3 bg-[#f7f5e6] p-5">
          <AssetVisual asset={a} large className="h-28 w-full" />
          <audio controls preload="metadata" src={a.url} className="w-full" />
        </div>
      );
    default:
      return <AssetVisual asset={a} large className="aspect-[3/1] w-full" />;
  }
}

function MoveForm({ asset: a, contents, onDone }: { asset: MediaItem; contents: MediaContentOption[]; onDone: () => void }) {
  const current = a.content?.id ?? UNASSIGNED;
  const [target, setTarget] = useState(current);
  const { run, pending } = useServerAction();
  // An archived owner isn't in the picker, but it is the current value
  const options = a.content && !contents.some((c) => c.id === a.content?.id) ? [{ id: a.content.id, title: a.content.title }, ...contents] : contents;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => assignMediaAction(a.id, target === UNASSIGNED ? null : target), { onSuccess: onDone });
      }}
    >
      <DialogHeader className="border-b border-[#f1eedf] px-5 py-4 pr-12">
        <DialogTitle className="text-base font-semibold">Move to content</DialogTitle>
        <DialogDescription className="truncate" title={a.fileName}>
          {a.fileName}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 p-5">
        <Field label="Belongs to content">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="w-full" aria-label="Belongs to content">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-[min(18rem,var(--radix-select-content-available-height))]">
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {options.length > 0 && <SelectSeparator />}
              {options.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {a.moveWarning && (
          <p className="flex gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-[13px] text-orange-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {a.moveWarning}
          </p>
        )}
        {(a.type === "VIDEO" || a.type === "THUMBNAIL") && (
          <p className="text-xs text-muted-foreground">
            Moving doesn&apos;t make it the new content&apos;s {a.type === "VIDEO" ? "final video" : "thumbnail"} — choose it in that content&apos;s Video tab.
          </p>
        )}
      </div>
      <DialogFooter className="mx-0 mb-0 border-t border-[#f1eedf] bg-[#fcfbf3] px-5 py-3">
        <Button type="button" variant="outline" className="bg-white" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || target === current}>
          <FolderInput />
          {pending ? "Moving…" : "Move file"}
        </Button>
      </DialogFooter>
    </form>
  );
}
