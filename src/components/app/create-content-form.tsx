"use client";

import { ArrowRight, Lightbulb } from "lucide-react";
import { Field } from "@/components/app/field";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { ContentType, Priority } from "@/lib/workflow/statuses";
import type { ContentFormOptions } from "@/server/queries/shared";
import { type CreateContentValues, NONE } from "./create-content-state";

/**
 * The body of the Create Content dialog. It loads the first time the dialog
 * opens (PERF-10), so the selects, checkboxes and text areas it needs are not
 * part of every page; the dialog keeps the state.
 */
export function CreateContentForm({
  options,
  form,
  set,
  pending,
  dirty,
  offer,
  onSubmit,
  onCancel,
  onRestore,
  onDiscard,
}: {
  options: ContentFormOptions;
  form: CreateContentValues;
  set: <K extends keyof CreateContentValues>(key: K, value: CreateContentValues[K]) => void;
  pending: boolean;
  dirty: boolean;
  /** An unfinished form from an earlier visit, offered back */
  offer: { at: number } | null;
  onSubmit: (openWorkspace: boolean) => void;
  onCancel: () => void;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(true);
      }}
    >
      <DialogHeader className="border-b border-[#f1eedf] p-6 pb-4">
        <DialogTitle className="text-lg">Create content</DialogTitle>
        <DialogDescription>Start with an idea — add the script, images and video later.</DialogDescription>
      </DialogHeader>

      <div className="thin-scroll max-h-[62vh] space-y-7 overflow-y-auto p-6">
        {offer && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="min-w-0 flex-1">
              You started an idea on {new Date(offer.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} and didn&apos;t finish it.
              {dirty && " Restoring it replaces what is in the form now."}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="bg-white"
              onClick={onRestore}
            >
              Restore it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onDiscard}
            >
              Discard
            </Button>
          </div>
        )}
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
        <Button type="button" variant="outline" onClick={() => onCancel()}>Cancel</Button>
        <Button type="button" variant="outline" disabled={pending || !form.title.trim()} onClick={() => onSubmit(false)}>
          <Lightbulb />Save as idea
        </Button>
        <Button type="submit" disabled={pending || !form.title.trim()}>
          <ArrowRight />{pending ? "Creating…" : "Create & open workspace"}
        </Button>
      </DialogFooter>
    </form>
  );
}
