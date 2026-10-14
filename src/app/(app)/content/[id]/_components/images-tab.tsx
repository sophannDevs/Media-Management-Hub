"use client";

import { BadgeCheck, Check, Copy, Download, Expand, ImagePlus, Library, LoaderCircle, MessageSquareWarning, PanelsTopLeft, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/app/content-bits";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Field } from "@/components/app/create-content-dialog";
import { UploadDropzone } from "@/components/app/media-upload";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { formatBytes } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ImageAssetStage, ImageStatus } from "@/lib/workflow/statuses";
import { saveImagePromptAction, setStatusAction } from "@/server/actions/content";
import { deleteMediaAction, setImageSelectedAction, setThumbnailAction } from "@/server/actions/media";
import type { ContentWorkspace } from "@/server/queries/content";

const STYLES = ["Cinematic", "Photorealistic", "Illustration", "3D render", "Anime", "Watercolor", "Flat vector", "Documentary"];
const RATIOS = ["16:9", "9:16", "1:1", "4:5", "3:2"] as const;
const PROVIDERS = [
  ["GOOGLE_AI_STUDIO", "Google AI Studio"],
  ["GOOGLE_FLOW", "Google Flow"],
  ["OTHER", "Other"],
] as const;
const NO_TEMPLATE = "__none";

type Img = ContentWorkspace["media"]["images"][number];

export function ImagesTab({ data }: { data: ContentWorkspace }) {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <PromptPanel data={data} />
      <Gallery data={data} />
    </div>
  );
}

function PromptPanel({ data }: { data: ContentWorkspace }) {
  const p = data.imagePrompt;
  const [prompt, setPrompt] = useState(p?.prompt ?? "");
  const [negativePrompt, setNegative] = useState(p?.negativePrompt ?? "");
  const [style, setStyle] = useState(p?.style ?? "Cinematic");
  const [aspectRatio, setRatio] = useState(p?.aspectRatio ?? (data.content.contentType === "LONG_FORM" ? "16:9" : "9:16"));
  const [provider, setProvider] = useState(p?.provider ?? "GOOGLE_AI_STUDIO");
  const { run, pending } = useServerAction();
  const templates = data.prompts.filter((t) => t.category === "IMAGE" || t.category === "THUMBNAIL");
  const dirty = prompt !== (p?.prompt ?? "") || negativePrompt !== (p?.negativePrompt ?? "") || style !== (p?.style ?? "Cinematic") || aspectRatio !== (p?.aspectRatio ?? aspectRatio) || provider !== (p?.provider ?? "GOOGLE_AI_STUDIO");

  const fullPrompt = [prompt.trim(), style && `Style: ${style}`, `Aspect ratio ${aspectRatio}`, negativePrompt.trim() && `Avoid: ${negativePrompt.trim()}`].filter(Boolean).join(". ");

  return (
    <Panel
      className="self-start lg:col-span-4"
      title="Image prompt"
      description={p ? `Saved ${p.updatedLabel}` : "Prompt for Google AI Studio / Flow"}
      action={<StatusBadge def={ImageAssetStage} value={data.workflow.imageStage} />}
    >
      <div className="space-y-4 p-5">
        {templates.length > 0 && (
          <Select
            value={NO_TEMPLATE}
            onValueChange={(id) => {
              const t = templates.find((x) => x.id === id);
              if (t) {
                setPrompt(t.content);
                toast.info(`Template "${t.name}" loaded — replace the {variables}`);
              }
            }}
          >
            <SelectTrigger aria-label="Image prompt template" className="w-full"><Library className="text-muted-foreground" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TEMPLATE}>Start from a template…</SelectItem>
              {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Field label="Prompt">
          <Textarea rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="font-mono text-[13px]" placeholder="Describe the scene, subject, lighting and mood…" />
        </Field>
        <Field label="Negative prompt" hint="Optional — what to avoid">
          <Textarea rows={2} value={negativePrompt} onChange={(e) => setNegative(e.target.value)} className="font-mono text-[13px]" placeholder="text, watermark, extra fingers" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Style">
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger aria-label="Style" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from(new Set([...STYLES, style])).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Aspect ratio">
            <Select value={aspectRatio} onValueChange={setRatio}>
              <SelectTrigger aria-label="Aspect ratio" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{RATIOS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Tool">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger aria-label="Tool" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{PROVIDERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={!prompt.trim()}
            onClick={() => navigator.clipboard.writeText(fullPrompt).then(() => toast.success("Image prompt copied — paste it into the image tool"), () => toast.error("Couldn't access the clipboard."))}
          >
            <Copy />Copy prompt
          </Button>
          <Button
            className="flex-1"
            disabled={pending || !dirty}
            onClick={() => run(() => saveImagePromptAction(data.content.id, { prompt, negativePrompt, style, aspectRatio: aspectRatio as (typeof RATIOS)[number], provider: provider as (typeof PROVIDERS)[number][0] }))}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Save />}Save
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function Gallery({ data }: { data: ContentWorkspace }) {
  const c = data.content;
  const images = data.media.images;
  const selectedCount = images.filter((i) => i.isSelected).length;
  const { run, pending } = useServerAction();
  const [preview, setPreview] = useState<Img | null>(null);
  const [toDelete, setToDelete] = useState<Img | null>(null);

  return (
    <Panel
      className="lg:col-span-8"
      title={<span className="flex items-center gap-3">Generated images <StatusBadge def={ImageStatus} value={c.imageStatus} /></span>}
      description={`${images.length} variation${images.length === 1 ? "" : "s"} · ${selectedCount} selected for the video`}
      action={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" disabled={pending || c.imageStatus === "NEEDS_REVISION" || !images.length} onClick={() => run(() => setStatusAction(c.id, "imageStatus", "NEEDS_REVISION"))}>
            <MessageSquareWarning />Needs revision
          </Button>
          <Button size="sm" disabled={pending || !selectedCount || c.imageStatus === "APPROVED"} onClick={() => run(() => setStatusAction(c.id, "imageStatus", "APPROVED"))}>
            <BadgeCheck />Approve images
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {images.length > 0 && selectedCount === 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Select the images you&apos;ll use in the video, then approve them.</p>
        )}
        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {images.map((img) => (
              <div key={img.id} className={cn("group overflow-hidden rounded-xl border bg-white", img.isSelected ? "border-primary ring-2 ring-primary/20" : "border-[#ece9d6]")}>
                <div className="relative aspect-video bg-stone-100">
                  {img.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- user uploads served from /api/files
                    <img src={img.url} alt={img.fileName} className="absolute inset-0 size-full object-cover" loading="lazy" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Linked file</div>
                  )}
                  {img.isSelected && (
                    <span className="absolute top-2 left-2 inline-flex h-[22px] items-center gap-1 rounded-full bg-primary px-2 text-xs font-medium text-white"><Check className="size-3" />Selected</span>
                  )}
                  {data.media.thumbnailId === img.id && (
                    <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">Thumbnail</span>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setImageSelectedAction(img.id, !img.isSelected), { success: img.isSelected ? "Removed from final selection" : "Added to final selection" })}>
                      {img.isSelected ? "Unselect" : "Select"}
                    </Button>
                    <Button size="icon-sm" variant="secondary" aria-label="Preview" onClick={() => setPreview(img)}><Expand /></Button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-1 px-3 py-2 text-xs">
                  <span className="truncate text-muted-foreground" title={img.fileName}>{img.fileName}</span>
                  <span className="flex shrink-0">
                    <Button variant="ghost" size="icon-xs" title="Use as thumbnail" aria-label="Use as thumbnail" disabled={pending || data.media.thumbnailId === img.id} onClick={() => run(() => setThumbnailAction(c.id, img.id))}><PanelsTopLeft /></Button>
                    {img.url && (
                      <Button variant="ghost" size="icon-xs" asChild title="Download">
                        <a href={img.externalUrl ? img.url : `${img.url}?download=1`} target={img.externalUrl ? "_blank" : undefined} rel="noreferrer" aria-label="Download"><Download /></a>
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-xs" title="Delete" aria-label="Delete" onClick={() => setToDelete(img)}><Trash2 /></Button>
                  </span>
                </div>
              </div>
            ))}
            <UploadDropzone type="IMAGE" contentId={c.id} className="aspect-video p-2" title="Add variations" hint="PNG, JPG, WEBP" icon={<ImagePlus />} />
          </div>
        ) : (
          <UploadDropzone
            type="IMAGE"
            contentId={c.id}
            className="py-12"
            icon={<ImagePlus />}
            title="No images yet — drop the generated variations here"
            hint="Copy the prompt into Google AI Studio or Flow, then upload the results (multiple files supported)."
          />
        )}
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.fileName}</DialogTitle>
            <DialogDescription>
              {preview?.width && preview?.height ? `${preview.width} × ${preview.height} · ` : ""}
              {preview ? formatBytes(preview.size) : ""} · uploaded {preview?.createdLabel}
            </DialogDescription>
          </DialogHeader>
          {preview?.url && (
            // eslint-disable-next-line @next/next/no-img-element -- full-size preview of user upload
            <img src={preview.url} alt={preview.fileName} className="max-h-[70vh] w-full rounded-lg object-contain" />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.fileName ?? "image"}?`}
        description={toDelete?.isSelected ? "This image is part of the final selection. Deleting it removes it from the content and the media library." : "The image is removed from this content and the media library."}
        onConfirm={() => toDelete && run(() => deleteMediaAction(toDelete.id))}
      />
    </Panel>
  );
}
