"use client";

import { CloudUpload, Info, Link2, Upload } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ContentPicker, type PickerChoice } from "@/components/app/content-picker";
import { Field } from "@/components/app/field";
import { UploadDropzone } from "@/components/app/media-upload";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useServerAction } from "@/hooks/use-server-action";
import { MediaType } from "@/lib/workflow/statuses";
import { linkMediaAction } from "@/server/actions/media";
import type { MediaContentOption } from "@/server/queries/media";

const UNASSIGNED = "__none";

const ACCEPT_HINTS: Record<string, string> = {
  IMAGE: "PNG, JPG, WEBP or SVG · up to 2 GB each",
  THUMBNAIL: "PNG, JPG or WEBP · 1280×720 recommended",
  VIDEO: "MP4, MOV or WEBM · up to 2 GB",
  AUDIO: "MP3, WAV or M4A · up to 2 GB each",
  MUSIC: "MP3, WAV or M4A · up to 2 GB each",
  OTHER: "Any file type · up to 2 GB each",
};

/** What attaching a file of this type does to the content's workflow (mirrors services/media.ts). */
const EFFECT_HINTS: Record<string, string> = {
  IMAGE: "Images are added to the content's image set for review.",
  THUMBNAIL: "Becomes the content's thumbnail if it doesn't have one yet.",
  VIDEO: "Becomes the content's final video — it still needs to be marked Final.",
  AUDIO: "Attached to the content for the video edit.",
  MUSIC: "Attached to the content for the video edit.",
  OTHER: "Attached to the content as a reference file.",
};

/** "9:42", "1:02:03" or "45" → seconds; "" → null; anything else → undefined (invalid). */
function parseDuration(value: string): number | null | undefined {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(v)) return undefined;
  const sec = v.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return sec > 0 ? sec : undefined;
}

export function UploadMediaDialog({
  defaultType = "IMAGE",
  defaultContent = null,
  trigger,
}: {
  defaultType?: string;
  /** Preselected owner, e.g. the content the library is filtered on */
  defaultContent?: MediaContentOption | null;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="lg">
            <Upload />
            Upload media
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {/* Mounted per opening, so every upload starts from the page's current filters */}
        <UploadForm defaultType={MediaType.is(defaultType) ? defaultType : "IMAGE"} defaultContent={defaultContent} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

const UNASSIGNED_CHOICE = { id: UNASSIGNED, title: "Unassigned" };

function UploadForm({ defaultType, defaultContent, onDone }: { defaultType: string; defaultContent: MediaContentOption | null; onDone: () => void }) {
  const [type, setType] = useState(defaultType);
  const [owner, setOwner] = useState<PickerChoice>(defaultContent ?? UNASSIGNED_CHOICE);
  const [mode, setMode] = useState("upload");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [duration, setDuration] = useState("");
  const { run, pending } = useServerAction();

  const target = owner.id === UNASSIGNED ? null : owner.id;
  const timed = type === "VIDEO" || type === "AUDIO" || type === "MUSIC";
  const durationSec = timed ? parseDuration(duration) : null;

  function link(e: { preventDefault(): void }) {
    e.preventDefault();
    if (durationSec === undefined) return;
    run(
      () =>
        linkMediaAction({
          contentId: target,
          type,
          url: url.trim(),
          fileName: fileName.trim() || undefined,
          durationSec,
        }),
      { onSuccess: onDone },
    );
  }

  return (
    <>
      <DialogHeader className="border-b border-[#f1eedf] p-6 pr-12 pb-4">
        <DialogTitle className="text-lg font-semibold">Upload media</DialogTitle>
        <DialogDescription>Attach files to a content item so they show up in its workspace.</DialogDescription>
      </DialogHeader>

      <div className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="um-media-type" label="Media type">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="um-media-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* OTHER accepts nothing: it was a way around every check (SEC-05) */}
                {MediaType.options.filter((o) => o.value !== "OTHER").map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Belongs to content">
            <ContentPicker label="Belongs to content" readiness={false} value={owner} fixed={[UNASSIGNED_CHOICE]} onChange={setOwner} />
          </Field>
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          {target ? EFFECT_HINTS[type] : "Unassigned files stay in the library — move them to a content item later."}
        </p>

        <Tabs value={mode} onValueChange={setMode} className="gap-3">
          <TabsList className="w-full">
            <TabsTrigger value="upload">
              <CloudUpload />
              Upload files
            </TabsTrigger>
            <TabsTrigger value="link">
              <Link2 />
              Link external file
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <UploadDropzone
              type={type}
              contentId={target}
              // Several videos for one content would replace each other as its final video
              multiple={!(type === "VIDEO" && target)}
              hint={ACCEPT_HINTS[type]}
              className="p-8"
              onUploaded={(r) => {
                if (r.ok) onDone();
              }}
            />
          </TabsContent>
          <TabsContent value="link">
            <form id="link-media-form" onSubmit={link} className="grid gap-4 sm:grid-cols-2">
              <Field label="File URL" required className="sm:col-span-2" hint="A direct https link to the file, e.g. on Google Drive, Dropbox or a CDN. Only https links are allowed.">
                <Input type="url" required aria-label="File URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
              </Field>
              <Field label="File name" hint="Optional — taken from the URL when empty." className={timed ? undefined : "sm:col-span-2"}>
                <Input aria-label="File name" value={fileName} onChange={(e) => setFileName(e.target.value)} maxLength={200} placeholder="e.g. final-cut-v2.mp4" />
              </Field>
              {timed && (
                <Field label="Duration" hint={durationSec === undefined ? "Use m:ss, e.g. 9:42." : "Optional, e.g. 9:42."}>
                  <Input aria-label="Duration" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="m:ss" inputMode="numeric" aria-invalid={durationSec === undefined} />
                </Field>
              )}
            </form>
          </TabsContent>
        </Tabs>
      </div>

      <DialogFooter className="mx-0 mb-0 border-t border-[#f1eedf] bg-[#fcfbf3] px-6 py-4">
        <Button type="button" variant="outline" className="bg-white" onClick={onDone}>
          {mode === "upload" ? "Close" : "Cancel"}
        </Button>
        {mode === "link" && (
          <Button type="submit" form="link-media-form" disabled={pending || !url.trim() || durationSec === undefined}>
            <Link2 />
            {pending ? "Linking…" : "Link file"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
