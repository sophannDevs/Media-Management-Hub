"use client";

import { BadgeCheck, ClipboardPaste, Copy, Eye, GitCommitHorizontal, History, LoaderCircle, MessageSquareWarning, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/app/content-bits";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { wordCount } from "@/lib/workflow/rules";
import { ScriptStatus } from "@/lib/workflow/statuses";
import { generateScriptAction, restoreScriptVersionAction, saveScriptAction, setStatusAction } from "@/server/actions/content";
import type { ContentWorkspace } from "@/server/queries/content";

const NO_TEMPLATE = "__default";
const SOURCE_LABEL: Record<string, string> = { CLAUDE: "Claude", PASTE: "Pasted", MANUAL: "Manual" };

export function ScriptTab({ data }: { data: ContentWorkspace }) {
  const c = data.content;
  const saved = data.script.body;
  const [body, setBody] = useState(saved);
  const [note, setNote] = useState("");
  const [source, setSource] = useState<"MANUAL" | "PASTE">("MANUAL");
  const [templateId, setTemplateId] = useState(NO_TEMPLATE);
  const [viewing, setViewing] = useState<(typeof data.script.versions)[number] | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const { run, pending } = useServerAction();
  const gen = useServerAction();

  const dirty = body !== saved;
  const words = wordCount(body);
  const minutes = Math.max(1, Math.round(words / 150));
  const scriptTemplates = data.prompts.filter((p) => p.category === "SCRIPT");
  const template = scriptTemplates.find((p) => p.id === templateId);

  function generate() {
    gen.run(() => generateScriptAction(c.id, templateId === NO_TEMPLATE ? null : templateId));
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return toast.info("Clipboard is empty.");
      setBody(text);
      setSource("PASTE");
      toast.success("Pasted from clipboard — save it as a new version");
    } catch {
      toast.error("Clipboard access was blocked — paste with Ctrl+V instead.");
    }
  }

  function copy(text: string, label = "Script copied") {
    navigator.clipboard.writeText(text).then(
      () => toast.success(label),
      () => toast.error("Couldn't access the clipboard."),
    );
  }

  const approveButton = (
    <Button disabled={pending || dirty || !saved.trim() || c.scriptStatus === "APPROVED"} onClick={() => run(() => setStatusAction(c.id, "scriptStatus", "APPROVED"))}>
      <BadgeCheck />Approve script
    </Button>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <Panel
        className="lg:col-span-8"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Script <StatusBadge def={ScriptStatus} value={c.scriptStatus} />
            {data.script.currentVersion > 0 && <span className="text-xs font-normal text-muted-foreground">v{data.script.currentVersion} · saved {data.script.updatedLabel}</span>}
          </span>
        }
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={paste}><ClipboardPaste />Paste</Button>
            <Button variant="outline" size="sm" disabled={!body.trim()} onClick={() => copy(body)}><Copy />Copy</Button>
          </div>
        }
      >
        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-2 rounded-xl border border-[#f1eedf] bg-[#fcfbf3] p-3 sm:flex-row sm:items-center">
            <Sparkles className="hidden size-4 shrink-0 text-primary sm:block" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">Generate with Claude</p>
              <p className="text-xs text-muted-foreground">
                {data.claudeConfigured ? "Uses the title, idea, description and audience as the brief." : "Mock mode — add ANTHROPIC_API_KEY to .env for real Claude drafts."}
              </p>
            </div>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="w-full bg-white sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEMPLATE}>Default script brief</SelectItem>
                {scriptTemplates.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              disabled={gen.pending || pending}
              onClick={() => (dirty ? setConfirmGenerate(true) : generate())}
            >
              {gen.pending ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              {gen.pending ? "Writing…" : "Generate"}
            </Button>
          </div>

          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"Write the script here, or paste the draft from Claude.\n\n[HOOK — 0:00]\n…"}
            className={cn("min-h-[440px] font-mono text-[13px] leading-relaxed", gen.pending && "animate-pulse")}
            disabled={gen.pending}
            aria-label="Script text"
          />

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <p className="text-xs text-muted-foreground">
              {words.toLocaleString("en-US")} words · ~{minutes} min narration
              {dirty && <span className="ml-2 font-medium text-amber-700">· Unsaved changes</span>}
            </p>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Version note (optional)" className="h-8 w-full sm:w-52" maxLength={200} />
              <Button
                variant="outline"
                disabled={pending || !dirty || !body.trim()}
                onClick={() => run(() => saveScriptAction(c.id, body, note || undefined, source), { onSuccess: () => setNote("") })}
              >
                <GitCommitHorizontal />Save version
              </Button>
              <Button variant="outline" disabled={pending || !saved.trim() || c.scriptStatus === "NEEDS_REVISION"} onClick={() => run(() => setStatusAction(c.id, "scriptStatus", "NEEDS_REVISION"))}>
                <MessageSquareWarning />Needs revision
              </Button>
              {dirty ? (
                <Tooltip>
                  <TooltipTrigger asChild><span tabIndex={0}>{approveButton}</span></TooltipTrigger>
                  <TooltipContent>Save your changes as a version first</TooltipContent>
                </Tooltip>
              ) : (
                approveButton
              )}
            </div>
          </div>
        </div>
      </Panel>

      <div className="space-y-6 lg:col-span-4">
        <Panel title="Versions" action={<span className="text-xs text-muted-foreground">{data.script.versions.length} saved</span>}>
          {data.script.versions.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No versions yet. Saving or generating a script creates version 1.</p>
          ) : (
            <ul className="thin-scroll max-h-[520px] space-y-1 overflow-y-auto p-2">
              {data.script.versions.map((v, i) => (
                <li key={v.id} className={cn("flex items-start gap-3 rounded-xl p-3", i === 0 ? "bg-olive-50" : "hover:bg-[#fcfbf3]")}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-white text-xs font-semibold">v{v.version}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge def={ScriptStatus} value={v.status} size="sm" />
                      <span className="text-[11px] text-muted-foreground">{SOURCE_LABEL[v.source] ?? v.source}</span>
                      {i === 0 && <span className="text-[11px] font-medium text-primary">Current</span>}
                    </div>
                    {v.note && <p className="mt-1 text-sm">{v.note}</p>}
                    <p className="text-xs text-muted-foreground">{v.createdLabel} · {v.words.toLocaleString("en-US")} words</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`View version ${v.version}`} onClick={() => setViewing(v)}><Eye /></Button>
                    {i > 0 && (
                      <Button variant="ghost" size="icon-sm" aria-label={`Restore version ${v.version}`} disabled={pending} onClick={() => run(() => restoreScriptVersionAction(v.id))}><History /></Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Prompt template" action={<Link href="/prompts" className="text-xs font-medium text-primary hover:underline">Library</Link>}>
          <div className="p-5">
            {template ? (
              <>
                <p className="flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4 text-primary" />{template.name}</p>
                <p className="mt-2 rounded-lg border border-[#f1eedf] bg-[#fcfbf3] p-3 font-mono text-xs leading-relaxed text-stone-600">{template.content}</p>
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => copy(template.content, "Prompt copied")}><Copy />Copy prompt</Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Pick a script template above to steer Claude, or copy one from the prompt library to use in Claude directly.</p>
            )}
          </div>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirmGenerate}
        onOpenChange={setConfirmGenerate}
        title="Discard unsaved edits?"
        description="Generating creates a new version from Claude and replaces the text you haven't saved yet."
        confirmLabel="Generate anyway"
        destructive={false}
        onConfirm={generate}
      />

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Version {viewing?.version}</DialogTitle>
            <DialogDescription>{viewing?.createdLabel}{viewing?.note ? ` · ${viewing.note}` : ""}</DialogDescription>
          </DialogHeader>
          <pre className="thin-scroll max-h-[60vh] overflow-y-auto rounded-lg border bg-[#fcfbf3] p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{viewing?.body}</pre>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => viewing && copy(viewing.body)}><Copy />Copy</Button>
            {viewing && viewing.version !== data.script.currentVersion && (
              <Button onClick={() => { run(() => restoreScriptVersionAction(viewing.id)); setViewing(null); }}><History />Restore this version</Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
