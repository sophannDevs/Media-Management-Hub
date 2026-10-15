"use client";

import { useState } from "react";
import { Field, LANGUAGES } from "@/components/app/create-content-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerAction } from "@/hooks/use-server-action";
import { TIMEZONES } from "@/lib/dates";
import { updateSettingsAction } from "@/server/actions/workspace";
import type { SettingsData } from "@/server/queries/settings";
import { SettingsCard, SettingsFooter } from "./settings-card";

type Workspace = SettingsData["workspace"];

export function WorkspaceForm({ initial }: { initial: Workspace }) {
  const [form, setForm] = useState(initial);
  const { run, pending } = useServerAction();
  const set = <K extends keyof Workspace>(key: K, value: Workspace[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Keep values that were set elsewhere selectable
  const timezones = TIMEZONES.some((t) => t.value === initial.timezone) ? TIMEZONES : [{ value: initial.timezone, label: initial.timezone }, ...TIMEZONES];
  const languages = LANGUAGES.includes(initial.defaultLanguage) ? LANGUAGES : [initial.defaultLanguage, ...LANGUAGES];

  const name = form.workspaceName.trim();
  const dirty = name !== initial.workspaceName || form.timezone !== initial.timezone || form.defaultLanguage !== initial.defaultLanguage;

  return (
    <SettingsCard id="workspace" title="Workspace" description="Name and defaults used across the app.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateSettingsAction({ workspaceName: name, timezone: form.timezone, defaultLanguage: form.defaultLanguage }), {
            success: "Workspace settings saved",
          });
        }}
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Workspace name" required className="sm:col-span-2">
            <Input required maxLength={80} value={form.workspaceName} onChange={(e) => set("workspaceName", e.target.value)} aria-label="Workspace name" className="sm:max-w-md" />
          </Field>
          <Field htmlFor="ws-default-timezone" label="Default timezone" hint="Schedules, the calendar and analytics days use this timezone.">
            <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
              <SelectTrigger id="ws-default-timezone" className="w-full">
                <SelectValue>{timezones.find((t) => t.value === form.timezone)?.label ?? form.timezone}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {timezones.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field htmlFor="ws-default-language" label="Default language" hint="Pre-selected when you create new content.">
            <Select value={form.defaultLanguage} onValueChange={(v) => set("defaultLanguage", v)}>
              <SelectTrigger id="ws-default-language" className="w-full">
                <SelectValue>{form.defaultLanguage}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {languages.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <SettingsFooter note={dirty ? "You have unsaved changes." : undefined}>
          <Button type="button" variant="ghost" disabled={!dirty || pending} onClick={() => setForm(initial)}>
            Reset
          </Button>
          <Button type="submit" disabled={!dirty || !name || pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </SettingsFooter>
      </form>
    </SettingsCard>
  );
}
