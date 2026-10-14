"use client";

import { AudioLines, BadgeCheck, Download, Film, Link2, MessageSquareWarning, Music, PanelsTopLeft, Replace, Scissors, Trash2, Upload, X } from "lucide-react";
import { useState } from "react";
import { EmptyState, Panel } from "@/components/app/content-bits";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ContentThumb } from "@/components/app/content-thumb";
import { UploadDropzone } from "@/components/app/media-upload";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/hooks/use-server-action";
import { formatBytes, formatDuration } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { MediaType, VideoStatus } from "@/lib/workflow/statuses";
import { setStatusAction } from "@/server/actions/content";
import { deleteMediaAction, linkMediaAction, setFinalVideoAction, setThumbnailAction } from "@/server/actions/media";
import type { ContentWorkspace } from "@/server/queries/content";

type Asset = ContentWorkspace["media"]["videos"][number];

export function VideoTab({ data }: { data: ContentWorkspace }) {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-8">
        <FinalVideo data={data} />
        <AudioPanel data={data} />
      </div>
      <div className="lg:col-span-4">
        <Thumbnails data={data} />
      </div>
    </div>
  );
}

function FinalVideo({ data }: { data: ContentWorkspace }) {
  const c = data.content;
  const v = data.media.finalVideo;
  const others = data.media.videos.filter((x) => x.id !== v?.id);
  const { run, pending } = useServerAction();
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Asset | null>(null);

  return (
    <Panel
      title={<span className="flex items-center gap-3">Final video <StatusBadge def={VideoStatus} value={c.videoStatus} /></span>}
      action={
        v ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setReplaceOpen(true)}><Replace />Replace</Button>
            {v.url && (
              <Button variant="outline" size="sm" asChild>
                <a href={v.externalUrl ? v.url : `${v.url}?download=1`} target={v.externalUrl ? "_blank" : undefined} rel="noreferrer"><Download />Download</a>
              </Button>
            )}
          </div>
        ) : null
      }
    >
      <div className="p-5">
        {v ? (
          <>
            <div className="relative aspect-video overflow-hidden rounded-xl bg-stone-900">
              {v.url ? (
                <video key={v.id} src={v.url} poster={c.thumbUrl ?? undefined} controls preload="metadata" className="size-full bg-black object-contain" />
              ) : (
                <>
                  <ContentThumb src={c.thumbUrl} seed={c.id} icon="play" className="size-full rounded-none opacity-70" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 text-sm text-white">
                    Demo record — no video file is stored for this item. Upload the rendered file to replace it.
                  </div>
                </>
              )}
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Meta label="Duration">{formatDuration(v.durationSec) || "—"}</Meta>
              <Meta label="Resolution">{v.width && v.height ? `${v.width} × ${v.height}` : "—"}</Meta>
              <Meta label="File size">{v.size ? formatBytes(v.size) : v.externalUrl ? "Linked" : "—"}</Meta>
              <Meta label="Added">{v.createdLabel}</Meta>
            </dl>
            <p className="mt-3 truncate text-xs text-muted-foreground" title={v.fileName}>{v.fileName}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#f3f1e4] pt-5">
              <Button variant="outline" disabled={pending || c.videoStatus === "EDITING"} onClick={() => run(() => setStatusAction(c.id, "videoStatus", "EDITING"))}><Scissors />Editing</Button>
              <Button variant="outline" disabled={pending || c.videoStatus === "NEEDS_REVISION"} onClick={() => run(() => setStatusAction(c.id, "videoStatus", "NEEDS_REVISION"))}><MessageSquareWarning />Needs revision</Button>
              <Button disabled={pending || c.videoStatus === "FINAL"} onClick={() => run(() => setStatusAction(c.id, "videoStatus", "FINAL"))}><BadgeCheck />Mark as Final</Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <UploadDropzone
              type="VIDEO"
              contentId={c.id}
              multiple={false}
              className="py-12"
              icon={<Film />}
              title={c.videoStatus === "EDITING" ? "Video is being edited — upload it when it's rendered" : "Upload the final video"}
              hint="MP4 / MOV up to 2 GB. Duration and resolution are read automatically."
            />
            <LinkVideoForm contentId={c.id} />
            {c.videoStatus === "NOT_STARTED" && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setStatusAction(c.id, "videoStatus", "EDITING"))}><Scissors />Mark as editing</Button>
              </div>
            )}
          </div>
        )}

        {others.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Other versions</p>
            <ul className="divide-y rounded-xl border">
              {others.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Film className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{o.fileName}</span>
                  <span className="text-xs text-muted-foreground">{formatDuration(o.durationSec)} · {o.createdLabel}</span>
                  <Button variant="outline" size="xs" disabled={pending} onClick={() => run(() => setFinalVideoAction(c.id, o.id))}>Use as final</Button>
                  <Button variant="ghost" size="icon-xs" aria-label="Delete" onClick={() => setToDelete(o)}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Replace final video</DialogTitle>
            <DialogDescription>The previous file stays under “Other versions”. The new video must be marked Final again.</DialogDescription>
          </DialogHeader>
          <UploadDropzone type="VIDEO" contentId={c.id} multiple={false} className="py-10" icon={<Upload />} onUploaded={(r) => r.ok && setReplaceOpen(false)} />
          <LinkVideoForm contentId={c.id} onDone={() => setReplaceOpen(false)} />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.fileName ?? "video"}?`}
        description="The file is removed from this content and the media library."
        onConfirm={() => toDelete && run(() => deleteMediaAction(toDelete.id))}
      />
    </Panel>
  );
}

function LinkVideoForm({ contentId, onDone }: { contentId: string; onDone?: () => void }) {
  const [url, setUrl] = useState("");
  const { run, pending } = useServerAction();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => linkMediaAction({ contentId, type: "VIDEO", url }), { onSuccess: () => { setUrl(""); onDone?.(); } });
      }}
    >
      <Input value={url} onChange={(e) => setUrl(e.target.value)} type="url" placeholder="…or paste a video URL (Google Drive, Dropbox, S3)" aria-label="Video URL" />
      <Button type="submit" variant="outline" disabled={pending || !url.trim()}><Link2 />Link</Button>
    </form>
  );
}

function Thumbnails({ data }: { data: ContentWorkspace }) {
  const c = data.content;
  const { run, pending } = useServerAction();
  const candidates = [...data.media.thumbnails, ...data.media.images.filter((i) => i.isSelected)];
  const current = data.media.thumbnailId;

  return (
    <Panel title="Thumbnail" description="Default for every platform; you can override it per schedule.">
      <div className="space-y-3 p-4">
        {candidates.length === 0 && <EmptyState icon={<PanelsTopLeft />} title="No thumbnail yet" description="Upload a thumbnail, or select images in the Images tab to use one of them." className="py-6" />}
        {candidates.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={pending}
            onClick={() => current !== t.id && run(() => setThumbnailAction(c.id, t.id))}
            className={cn("flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors", current === t.id ? "border-primary bg-olive-50" : "hover:border-olive-300")}
          >
            <ContentThumb src={t.url} seed={t.id} icon="image" className="aspect-video w-28" />
            <div className="min-w-0 flex-1 text-xs">
              <p className="truncate font-medium">{t.fileName}</p>
              <p className="text-muted-foreground">{MediaType.label(t.type)}{t.width && t.height ? ` · ${t.width}×${t.height}` : ""}</p>
              {current === t.id && <p className="mt-1 font-medium text-primary">Selected</p>}
            </div>
          </button>
        ))}
        {current && (
          <Button variant="ghost" size="sm" className="w-full" disabled={pending} onClick={() => run(() => setThumbnailAction(c.id, null))}><X />Remove thumbnail</Button>
        )}
        <UploadDropzone type="THUMBNAIL" contentId={c.id} multiple={false} className="py-6" title="Upload thumbnail" hint="1280 × 720 JPG or PNG" icon={<Upload />} />
      </div>
    </Panel>
  );
}

function AudioPanel({ data }: { data: ContentWorkspace }) {
  const c = data.content;
  const { run } = useServerAction();
  const [kind, setKind] = useState<"AUDIO" | "MUSIC">("AUDIO");
  const [toDelete, setToDelete] = useState<Asset | null>(null);
  return (
    <Panel title="Audio & music" description="Voice-over, music beds and other sound files">
      <div className="space-y-4 p-5">
        {data.media.audio.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {data.media.audio.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 px-3 py-2.5 text-sm sm:flex-row sm:items-center">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {a.type === "MUSIC" ? <Music className="size-4 shrink-0 text-muted-foreground" /> : <AudioLines className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{a.fileName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{MediaType.label(a.type)} · {formatDuration(a.durationSec) || "—"}</span>
                </span>
                {a.url ? <audio src={a.url} controls preload="none" className="h-8 w-full sm:w-64" /> : <span className="text-xs text-muted-foreground">No file stored</span>}
                <Button variant="ghost" size="icon-xs" aria-label="Delete" onClick={() => setToDelete(a)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <div className="flex shrink-0 gap-1 self-start rounded-xl border border-[#ebe7c6] bg-secondary p-1">
            {(["AUDIO", "MUSIC"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={cn("h-8 rounded-lg px-3 text-[13px] font-medium", kind === k ? "bg-white shadow-sm" : "text-muted-foreground")}>
                {k === "AUDIO" ? "Voice-over" : "Music"}
              </button>
            ))}
          </div>
          <UploadDropzone type={kind} contentId={c.id} className="flex-1 py-5" title={`Upload ${kind === "AUDIO" ? "voice-over" : "music"}`} hint="MP3, WAV, M4A" icon={kind === "AUDIO" ? <AudioLines /> : <Music />} />
        </div>
      </div>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.fileName ?? "file"}?`}
        description="The file is removed from this content and the media library."
        onConfirm={() => toDelete && run(() => deleteMediaAction(toDelete.id))}
      />
    </Panel>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

