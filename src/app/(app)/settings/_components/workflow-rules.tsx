"use client";

import { Info } from "lucide-react";
import { useOptimistic } from "react";
import { Switch } from "@/components/ui/switch";
import { useServerAction } from "@/hooks/use-server-action";
import type { WorkflowRules } from "@/lib/workflow/rules";
import { updateSettingsAction } from "@/server/actions/workspace";
import { SettingsCard } from "./settings-card";

const RULES: { key: keyof WorkflowRules; title: string; description: string }[] = [
  { key: "requireScriptApproved", title: "Require approved script", description: "The script status must be Approved." },
  { key: "requireImagesApproved", title: "Require approved images", description: "Images must be Approved, with at least one final image selected." },
  { key: "requireFinalVideo", title: "Require final video", description: "A video file must be attached and marked Final." },
  { key: "requireReview", title: "Require review approval", description: "A final review must be Approved before the video is ready." },
  { key: "requireThumbnail", title: "Require thumbnail", description: "A thumbnail must be set before the video can be scheduled." },
];

export function WorkflowRulesSection({ rules }: { rules: WorkflowRules }) {
  const [view, apply] = useOptimistic(rules, (state, patch: Partial<WorkflowRules>) => ({ ...state, ...patch }));
  const { run } = useServerAction();

  function toggle(key: keyof WorkflowRules, value: boolean) {
    run(
      () => {
        apply({ [key]: value });
        return updateSettingsAction({ [key]: value });
      },
      { success: "Rule saved — Ready to Post statuses recalculated" },
    );
  }

  return (
    <SettingsCard id="workflow" title="Workflow rules" description="Control when content becomes “Ready to Post”. Changes save immediately.">
      <ul className="divide-y divide-[#f3f1e4]">
        {RULES.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-4 px-5 py-3.5">
            <label htmlFor={`rule-${r.key}`} className="min-w-0 cursor-pointer">
              <span className="block text-sm font-medium">{r.title}</span>
              <span className="block text-xs text-muted-foreground">{r.description}</span>
            </label>
            <Switch id={`rule-${r.key}`} checked={view[r.key]} onCheckedChange={(v) => toggle(r.key, v)} />
          </li>
        ))}
      </ul>
      <p className="flex gap-2 border-t border-[#f3f1e4] bg-[#fcfbf3] px-5 py-3 text-xs text-muted-foreground rounded-b-2xl">
        <Info className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
        Changing a rule recalculates the “Ready to Post” status of every content item. Videos that are already scheduled or published are not affected.
      </p>
    </SettingsCard>
  );
}
