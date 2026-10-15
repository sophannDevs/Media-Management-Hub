"use client";

import { ArrowRight, Lightbulb, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useState } from "react";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { ContentType, Priority } from "@/lib/workflow/statuses";
import { createContentAction } from "@/server/actions/content";
import type { ContentFormOptions } from "@/server/queries/shared";

const NONE = "__none";
export const LANGUAGES = ["English", "Khmer", "Korean", "Thai", "Vietnamese", "Japanese"];

export function CreateContentDialog({ options, trigger }: { options: ContentFormOptions; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { run, pending } = useServerAction();
  const [form, setForm] = useState(() => initial(options));
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

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
          setForm(initial(options));
          if (openWorkspace) router.push(`/content/${id}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button aria-label="Create content">
            <Plus />
            <span className="hidden sm:inline">Create Content</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(true);
          }}
        >
          <DialogHeader className="border-b border-[#f1eedf] p-6 pb-4">
            <DialogTitle className="text-lg">Create content</DialogTitle>
            <DialogDescription>Start with an idea — add the script, images and video later.</DialogDescription>
          </DialogHeader>

          <div className="thin-scroll max-h-[62vh] space-y-7 overflow-y-auto p-6">
            <section>
              <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Basic information</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title" required className="sm:col-span-2" htmlFor="cc-title">
                  <Input id="cc-title" required value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. 10 AI Tools That Will Replace Your Workflow" />
                </Field>
                <Field label="Content idea" className="sm:col-span-2" htmlFor="cc-idea">
                  <Textarea id="cc-idea" rows={2} value={form.idea} onChange={(e) => set("idea", e.target.value)} placeholder="What's the hook? What format?" />
                </Field>
                <Field label="Description" className="sm:col-span-2" htmlFor="cc-desc">
                  <Textarea id="cc-desc" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Short summary for the team and later for the post" />
                </Field>
                <Field htmlFor="cc-category" label="Category">
                  <Select value={form.categoryId} onValueChange={(v) => set("categoryId", v)}>
                    <SelectTrigger id="cc-category" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No category</SelectItem>
                      {options.categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field htmlFor="cc-content-type" label="Content type">
                  <Select value={form.contentType} onValueChange={(v) => set("contentType", v)}>
                    <SelectTrigger id="cc-content-type" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{ContentType.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Tags" hint="Separate with commas" htmlFor="cc-tags">
                  <Input id="cc-tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="ai tools, productivity" />
                </Field>
                <Field label="Target audience" htmlFor="cc-audience">
                  <Input id="cc-audience" value={form.targetAudience} onChange={(e) => set("targetAudience", e.target.value)} placeholder="e.g. YouTube creators" />
                </Field>
                <Field htmlFor="cc-language" label="Language">
                  <Select value={form.language} onValueChange={(v) => set("language", v)}>
                    <SelectTrigger id="cc-language" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Target platforms</h3>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {options.platforms.map((p) => {
                  const checked = form.platforms.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border p-3",
                        p.enabled ? "cursor-pointer hover:border-olive-300" : "cursor-not-allowed opacity-55",
                        checked && "border-primary bg-olive-50",
                      )}
                    >
                      <Checkbox
                        disabled={!p.enabled}
                        checked={checked}
                        onCheckedChange={(v) => set("platforms", v ? [...form.platforms, p.id] : form.platforms.filter((x) => x !== p.id))}
                      />
                      <PlatformIcon platform={p.id} size={20} />
                      <span className="text-sm font-medium">{p.name}</span>
                      {!p.enabled && <span className="ml-auto rounded bg-stone-100 px-1.5 py-0.5 text-xs font-semibold text-stone-500 uppercase">Soon</span>}
                    </label>
                  );
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Planning</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Priority" group>
                  <div className="flex gap-1 rounded-xl border border-[#ebe7c6] bg-secondary p-1">
                    {Priority.options.map((p) => (
                      <button key={p.value} type="button" aria-pressed={form.priority === p.value} onClick={() => set("priority", p.value)} className={cn("h-8 flex-1 rounded-lg text-[13px] font-medium", form.priority === p.value ? "bg-white shadow-sm" : "text-muted-foreground")}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Target publish date" htmlFor="cc-target">
                  <Input id="cc-target" type="date" value={form.targetPublishDate} onChange={(e) => set("targetPublishDate", e.target.value)} />
                </Field>
                <Field htmlFor="cc-series" label="Series">
                  <Select value={form.seriesId} onValueChange={(v) => set("seriesId", v)}>
                    <SelectTrigger id="cc-series" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {options.series.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field htmlFor="cc-campaign" label="Campaign">
                  <Select value={form.campaignId} onValueChange={(v) => set("campaignId", v)}>
                    <SelectTrigger id="cc-campaign" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {options.campaigns.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </section>
          </div>

          <DialogFooter className="mx-0 mb-0 flex-col-reverse gap-2 rounded-b-xl border-t border-[#f1eedf] bg-[#fcfbf3] px-6 py-4 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant="outline" disabled={pending || !form.title.trim()} onClick={() => submit(false)}>
              <Lightbulb />Save as idea
            </Button>
            <Button type="submit" disabled={pending || !form.title.trim()}>
              <ArrowRight />{pending ? "Creating…" : "Create & open workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function initial(options: ContentFormOptions) {
  return {
    title: "",
    idea: "",
    description: "",
    categoryId: NONE,
    contentType: "LONG_FORM",
    tags: "",
    targetAudience: "",
    language: options.defaultLanguage,
    platforms: options.platforms.filter((p) => p.enabled && p.id === "youtube").map((p) => p.id),
    priority: "MEDIUM",
    targetPublishDate: "",
    seriesId: NONE,
    campaignId: NONE,
  };
}

/**
 * A label above a control. Pass `htmlFor` (the control's id) for a single input
 * or select; pass `group` when the field is a set of buttons, so the label
 * names the whole set for screen readers instead of pointing at nothing.
 */
export function Field({ label, hint, required, className, htmlFor, group, children }: { label: string; hint?: string; required?: boolean; className?: string; htmlFor?: string; group?: boolean; children: ReactNode }) {
  const labelId = useId();
  return (
    <div className={className}>
      <Label id={group ? labelId : undefined} className="mb-1.5" htmlFor={group ? undefined : htmlFor}>
        {label}
        {required && <span className="text-rose-600">*</span>}
      </Label>
      {group ? (
        <div role="group" aria-labelledby={labelId}>
          {children}
        </div>
      ) : (
        children
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
