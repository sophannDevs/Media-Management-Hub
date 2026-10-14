"use client";

import { CircleAlert, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Field } from "@/components/app/create-content-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerAction } from "@/hooks/use-server-action";
import { AiProvider, type AiProviderCode, PromptCategory, type PromptCategoryCode } from "@/lib/workflow/statuses";
import { savePromptAction } from "@/server/actions/workspace";
import type { PromptItem } from "@/server/queries/prompts";

const VARIABLE = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;

/** Unique `{variables}` in order of appearance. */
export function promptVariables(text: string) {
  return [...new Set(text.match(VARIABLE) ?? [])];
}

/** Splits text into plain parts and `{variable}` parts (odd indexes). */
export function splitVariables(text: string) {
  return text.split(/(\{[A-Za-z_][A-Za-z0-9_]*\})/g);
}

/** Image work happens in Google tools; everything text-based defaults to Claude. */
const defaultProviderFor = (category: string): AiProviderCode => (category === "IMAGE" || category === "THUMBNAIL" ? "GOOGLE_AI_STUDIO" : "CLAUDE");

interface FormValues {
  name: string;
  category: string;
  provider: string;
  content: string;
}

function PromptForm({ prompt, defaultCategory, onDone }: { prompt?: PromptItem; defaultCategory: PromptCategoryCode; onDone: () => void }) {
  const [values, setValues] = useState<FormValues>(() =>
    prompt
      ? { name: prompt.name, category: prompt.category, provider: prompt.provider, content: prompt.content }
      : { name: "", category: defaultCategory, provider: defaultProviderFor(defaultCategory), content: "" },
  );
  const [providerTouched, setProviderTouched] = useState(Boolean(prompt));
  const [errors, setErrors] = useState<string[]>([]);
  const { run, pending } = useServerAction();
  const variables = promptVariables(values.content);
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  function submit() {
    setErrors([]);
    run(() => savePromptAction(prompt?.id ?? null, values), {
      success: prompt ? "Prompt saved" : "Prompt created",
      onSuccess: onDone,
      onError: (error, details) => setErrors(details?.length ? details : [error]),
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader className="border-b border-[#f1eedf] p-6 pb-4">
        <DialogTitle className="text-lg">{prompt ? "Edit prompt" : "New prompt"}</DialogTitle>
        <DialogDescription>Wrap the parts that change in braces, e.g. {"{topic}"} or {"{audience}"}.</DialogDescription>
      </DialogHeader>

      <div className="thin-scroll max-h-[64vh] space-y-4 overflow-y-auto p-6">
        <Field label="Prompt name" required>
          <Input required maxLength={120} value={values.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Long-form script (8–10 min)" aria-label="Prompt name" autoFocus={!prompt} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Select
              value={values.category}
              onValueChange={(v) => setValues((cur) => ({ ...cur, category: v, provider: providerTouched ? cur.provider : defaultProviderFor(v) }))}
            >
              <SelectTrigger className="w-full" aria-label="Category">
                <SelectValue>{PromptCategory.label(values.category)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PromptCategory.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="AI provider">
            <Select
              value={values.provider}
              onValueChange={(v) => {
                setProviderTouched(true);
                set("provider", v);
              }}
            >
              <SelectTrigger className="w-full" aria-label="AI provider">
                <SelectValue>{AiProvider.label(values.provider)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {AiProvider.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Prompt content" required>
          <Textarea
            required
            rows={10}
            maxLength={20000}
            value={values.content}
            onChange={(e) => set("content", e.target.value)}
            aria-label="Prompt content"
            placeholder={'Write a {duration}-minute YouTube script about "{title}" for {audience}…'}
            className="max-h-[50vh] min-h-[220px] resize-y font-mono text-[13px] leading-relaxed field-sizing-fixed md:text-[13px]"
          />
          <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5" aria-live="polite">
            {variables.length ? (
              <>
                <span className="mr-0.5 text-xs text-muted-foreground">Variables:</span>
                {variables.map((v) => (
                  <span key={v} className="inline-flex h-[22px] items-center rounded-full border border-olive-200 bg-olive-50 px-2 font-mono text-xs font-medium text-olive-700">
                    {v}
                  </span>
                ))}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">No variables yet — wrap changing parts in {"{braces}"}, e.g. {"{topic}"}.</span>
            )}
          </div>
        </Field>

        {errors.length > 0 && (
          <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <ul className="space-y-0.5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <DialogFooter className="m-0 flex-col-reverse gap-2 rounded-none border-t border-[#f1eedf] bg-[#fcfbf3] px-6 py-4 sm:flex-row">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !values.name.trim() || !values.content.trim()}>
          {pending ? "Saving…" : "Save prompt"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Create / edit dialog. Uncontrolled with `trigger`, or controlled with `open` / `onOpenChange`. */
export function PromptEditorDialog({
  prompt,
  defaultCategory = "VIDEO_IDEA",
  trigger,
  open: openProp,
  onOpenChange,
}: {
  prompt?: PromptItem;
  defaultCategory?: PromptCategoryCode;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [inner, setInner] = useState(false);
  const open = openProp ?? inner;
  const setOpen = onOpenChange ?? setInner;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* Content unmounts when closed, so the form starts fresh on every open */}
        <PromptForm key={prompt?.id ?? "new"} prompt={prompt} defaultCategory={defaultCategory} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Header button. Pre-selects the category tab that is currently open (kept in `?category=`). */
export function NewPromptButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<PromptCategoryCode>("VIDEO_IDEA");
  return (
    <PromptEditorDialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          const fromUrl = new URLSearchParams(window.location.search).get("category");
          setCategory(PromptCategory.is(fromUrl) ? fromUrl : "VIDEO_IDEA");
        }
        setOpen(next);
      }}
      defaultCategory={category}
      trigger={
        <Button size="lg">
          <Plus />
          New prompt
        </Button>
      }
    />
  );
}
