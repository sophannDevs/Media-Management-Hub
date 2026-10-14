"use client";

import { ArrowRight, Check, Eye, MessageSquareWarning, Pencil, Send, WandSparkles, X } from "lucide-react";
import { useState } from "react";
import { Panel } from "@/components/app/content-bits";
import { Field, LANGUAGES } from "@/components/app/create-content-dialog";
import { PlatformIcon, PlatformLabel } from "@/components/app/platform-icon";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { ContentType, ImageStatus, Priority, PublishingStatus, ReviewStatus, ScriptStatus, VideoStatus } from "@/lib/workflow/statuses";
import { setChecklistFlagAction, setStatusAction, updateContentAction } from "@/server/actions/content";
import type { ContentWorkspace } from "@/server/queries/content";
import { useWorkspaceTab } from "./workspace";

const NONE = "__none";

export function OverviewTab({ data }: { data: ContentWorkspace }) {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-8">
        <BasicInfo data={data} />
        <ProductionStatus data={data} />
      </div>
      <div className="space-y-6 lg:col-span-4">
        <Checklist data={data} />
        <Planning data={data} />
      </div>
    </div>
  );
}

function BasicInfo({ data }: { data: ContentWorkspace }) {
  const c = data.content;
  const [editing, setEditing] = useState(false);
  const { run, pending } = useServerAction();
  const initial = () => ({
    title: c.title,
    idea: c.idea,
    description: c.description,
    categoryId: c.categoryId ?? NONE,
    contentType: c.contentType,
    tags: c.tags.join(", "),
    targetAudience: c.targetAudience,
    language: c.language,
    platforms: c.platforms,
    hashtags: c.hashtags,
  });
  const [form, setForm] = useState(initial);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (!editing) {
    return (
      <Panel title="Basic information" action={<Button variant="ghost" size="sm" onClick={() => { setForm(initial()); setEditing(true); }}><Pencil />Edit</Button>}>
        <dl className="grid gap-x-6 gap-y-4 p-5 text-sm sm:grid-cols-2">
          <Item label="Description" wide>{c.description || <Muted>No description yet</Muted>}</Item>
          <Item label="Content idea" wide>{c.idea || <Muted>No idea notes</Muted>}</Item>
          <Item label="Category">{c.categoryName ?? <Muted>Uncategorized</Muted>}</Item>
          <Item label="Content type">{ContentType.label(c.contentType)}</Item>
          <Item label="Target audience">{c.targetAudience || <Muted>Not set</Muted>}</Item>
          <Item label="Language">{c.language}</Item>
          <Item label="Target platforms">
            {c.platforms.length ? <div className="flex flex-wrap gap-3">{c.platforms.map((p) => <PlatformLabel key={p} platform={p} />)}</div> : <Muted>None selected</Muted>}
          </Item>
          <Item label="Tags">
            {c.tags.length ? <div className="flex flex-wrap gap-1">{c.tags.map((t) => <span key={t} className="rounded-md bg-[#f5f3e3] px-2 py-0.5 text-xs text-stone-700">#{t}</span>)}</div> : <Muted>No tags</Muted>}
          </Item>
          <Item label="Default hashtags" wide>{c.hashtags || <Muted>No hashtags — used as defaults when scheduling</Muted>}</Item>
        </dl>
      </Panel>
    );
  }

  return (
    <Panel title="Edit basic information">
      <form
        className="grid gap-4 p-5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateContentAction(c.id, { ...form, categoryId: form.categoryId === NONE ? null : form.categoryId }), { onSuccess: () => setEditing(false) });
        }}
      >
        <Field label="Title" required className="sm:col-span-2"><Input required value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="Content idea" className="sm:col-span-2"><Textarea rows={2} value={form.idea} onChange={(e) => set("idea", e.target.value)} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label="Category">
          <Select value={form.categoryId} onValueChange={(v) => set("categoryId", v)}>
            <SelectTrigger aria-label="Category" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No category</SelectItem>
              {data.options.categories.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Content type">
          <Select value={form.contentType} onValueChange={(v) => set("contentType", v)}>
            <SelectTrigger aria-label="Content type" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{ContentType.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Tags" hint="Separate with commas"><Input value={form.tags} onChange={(e) => set("tags", e.target.value)} /></Field>
        <Field label="Target audience"><Input value={form.targetAudience} onChange={(e) => set("targetAudience", e.target.value)} /></Field>
        <Field label="Language">
          <Select value={form.language} onValueChange={(v) => set("language", v)}>
            <SelectTrigger aria-label="Language" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from(new Set([...LANGUAGES, form.language])).map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Default hashtags" hint="Prefilled when you schedule a post"><Input value={form.hashtags} onChange={(e) => set("hashtags", e.target.value)} placeholder="#ai #tools" /></Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium">Target platforms</p>
          <div className="flex flex-wrap gap-2">
            {data.options.platforms.map((p) => {
              const on = form.platforms.includes(p.id);
              return (
                <label key={p.id} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm", p.enabled ? "cursor-pointer" : "cursor-not-allowed opacity-50", on && "border-primary bg-olive-50")}>
                  <Checkbox disabled={!p.enabled} checked={on} onCheckedChange={(v) => set("platforms", v ? [...form.platforms, p.id] : form.platforms.filter((x) => x !== p.id))} />
                  <PlatformIcon platform={p.id} />
                  {p.name}
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="outline" onClick={() => setEditing(false)}><X />Cancel</Button>
          <Button type="submit" disabled={pending || !form.title.trim()}><Check />{pending ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </Panel>
  );
}

const STATUS_ROWS = [
  { field: "scriptStatus", label: "Script", def: ScriptStatus, icon: "file" },
  { field: "imageStatus", label: "Images", def: ImageStatus, icon: "image" },
  { field: "videoStatus", label: "Video", def: VideoStatus, icon: "film" },
  { field: "reviewStatus", label: "Review", def: ReviewStatus, icon: "eye" },
] as const;

function ProductionStatus({ data }: { data: ContentWorkspace }) {
  const c = data.content;
  const { run, pending } = useServerAction();
  const r = data.workflow.rules;
  const required = [r.requireScriptApproved && "Script = Approved", r.requireImagesApproved && "Images = Approved", r.requireFinalVideo && "Video = Final", r.requireReview && "Review = Approved", r.requireThumbnail && "Thumbnail selected"].filter(Boolean);

  return (
    <Panel title="Production status" description="The publishing status is calculated automatically from these.">
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {STATUS_ROWS.map((row) => (
          <div key={row.field} className="rounded-xl border border-[#f1eedf] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{row.label}</span>
              <StatusBadge def={row.def} value={c[row.field]} />
            </div>
            <Select value={c[row.field]} disabled={pending} onValueChange={(v) => run(() => setStatusAction(c.id, row.field, v))}>
              <SelectTrigger aria-label={`${row.label} status`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{row.def.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}

        <div className="rounded-xl border border-[#f1eedf] p-3 sm:col-span-2">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Eye className="size-4 text-muted-foreground" />Review</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={pending || c.reviewStatus === "IN_REVIEW"} onClick={() => run(() => setStatusAction(c.id, "reviewStatus", "IN_REVIEW"))}><Send />Send to review</Button>
            <Button variant="outline" size="sm" disabled={pending || c.reviewStatus === "CHANGES_REQUESTED"} onClick={() => run(() => setStatusAction(c.id, "reviewStatus", "CHANGES_REQUESTED"))}><MessageSquareWarning />Request changes</Button>
            <Button size="sm" disabled={pending || c.reviewStatus === "APPROVED"} onClick={() => run(() => setStatusAction(c.id, "reviewStatus", "APPROVED"))}><Check />Approve content</Button>
          </div>
        </div>

        <div className="space-y-1.5 rounded-xl border border-[#f1eedf] bg-[#fcfbf3] p-3 sm:col-span-2">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <WandSparkles className="size-4 text-primary" />Publishing status{" "}
            <StatusBadge def={PublishingStatus} value={c.publishingStatus} label={c.publishingStatus === "PUBLISHED" && data.workflow.simulated ? "Simulated" : undefined} />
          </p>
          <p className="text-xs text-muted-foreground">{required.length ? `${required.join(" + ")} → Ready to Post` : "No requirements enabled — content is Ready to Post as soon as it's created (Settings → Workflow rules)."}</p>
        </div>
      </div>
    </Panel>
  );
}

function Checklist({ data }: { data: ContentWorkspace }) {
  const { setTab } = useWorkspaceTab();
  const { run, pending } = useServerAction();
  const items = data.workflow.checklist;
  const done = items.filter((i) => i.done).length;
  return (
    <Panel title="Checklist" action={<span className="text-sm font-semibold text-primary">{data.workflow.completion}% complete</span>}>
      <div className="px-5 pt-4">
        <Progress value={data.workflow.completion} aria-label="Checklist completion" className="h-1.5 bg-[#eeebd8]" />
        <p className="mt-1.5 text-xs text-muted-foreground">{done} of {items.length} complete</p>
      </div>
      <ul className="space-y-0.5 p-3">
        {items.map((i) => (
          <li key={i.key} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[#fcfbf3]">
            {i.manual ? (
              <Checkbox
                checked={i.done}
                disabled={pending}
                onCheckedChange={(v) => run(() => setChecklistFlagAction(data.content.id, i.key as "titleFinalized" | "descriptionFinalized", !!v), { success: false })}
                aria-label={i.label}
              />
            ) : (
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border", i.done ? "border-primary bg-primary text-white" : "border-stone-300")} title="Completed automatically from the content's data">
                {i.done && <Check className="size-3" />}
              </span>
            )}
            <span className={cn("flex-1 text-sm", i.done ? "text-muted-foreground line-through" : "text-foreground")}>{i.label}</span>
            {!i.done && !i.manual && (
              <button type="button" onClick={() => setTab(i.tab)} className="text-xs text-primary opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Go to ${i.tab}`}>
                <ArrowRight className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Planning({ data }: { data: ContentWorkspace }) {
  const c = data.content;
  const { run, pending } = useServerAction();
  const save = (patch: Parameters<typeof updateContentAction>[1]) => run(() => updateContentAction(c.id, patch), { success: "Planning updated" });
  return (
    <Panel title="Planning">
      <div className="space-y-4 p-5">
        <Field label="Priority">
          <div className="flex gap-1 rounded-xl border border-[#ebe7c6] bg-secondary p-1">
            {Priority.options.map((p) => (
              <button key={p.value} type="button" disabled={pending} onClick={() => p.value !== c.priority && save({ priority: p.value })} className={cn("h-8 flex-1 rounded-lg text-[13px] font-medium", c.priority === p.value ? "bg-white shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Target publish date">
          <Input type="date" aria-label="Target publish date" defaultValue={c.targetPublishDate} disabled={pending} onBlur={(e) => e.target.value !== c.targetPublishDate && save({ targetPublishDate: e.target.value || null })} />
        </Field>
        <Field label="Series">
          <Select value={c.seriesId ?? NONE} disabled={pending} onValueChange={(v) => save({ seriesId: v === NONE ? null : v })}>
            <SelectTrigger aria-label="Series" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {data.options.series.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Campaign">
          <Select value={c.campaignId ?? NONE} disabled={pending} onValueChange={(v) => save({ campaignId: v === NONE ? null : v })}>
            <SelectTrigger aria-label="Campaign" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {data.options.campaigns.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </Panel>
  );
}

function Item({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn(wide && "sm:col-span-2")}>
      <dt className="mb-1 text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
