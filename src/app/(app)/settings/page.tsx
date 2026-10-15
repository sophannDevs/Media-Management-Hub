import { FileText, Film, ImageIcon, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { PageHeader } from "@/components/app/content-bits";
import { StatusBadge } from "@/components/app/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tone } from "@/lib/workflow/statuses";
import { getSettingsData, type SettingsData } from "@/server/queries/settings";
import { ArchivedContent } from "./_components/archived-content";
import { NotificationPrefs } from "./_components/notification-prefs";
import { PublishingForm } from "./_components/publishing-form";
import { RecentChanges } from "./_components/recent-changes";
import { SETTINGS_SECTIONS, SettingsCard } from "./_components/settings-card";
import { SettingsNav } from "./_components/settings-nav";
import { TaxonomyManager } from "./_components/taxonomy-manager";
import { WorkflowRulesSection } from "./_components/workflow-rules";
import { WorkspaceForm } from "./_components/workspace-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <PageHeader title="Settings" description="Workspace preferences, workflow rules and integrations." />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-3">
          <SettingsNav />
        </div>
        <div className="min-w-0 space-y-6 lg:col-span-9">
          <Suspense fallback={<SectionsSkeleton />}>
            <Sections />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function Sections() {
  const d = await getSettingsData();
  return (
    <>
      <WorkspaceForm initial={d.workspace} />
      <TaxonomyManager taxonomies={d.taxonomies} />
      <WorkflowRulesSection rules={d.rules} />
      <PublishingForm initial={d.publishing} worker={d.worker} />
      <NotificationPrefs prefs={d.notifications} />
      <AiIntegrations ai={d.ai} />
      <RecentChanges items={d.activity} />
      <ArchivedContent items={d.archived} />
    </>
  );
}

const code = (text: string) => <code className="rounded bg-[#f6f4e6] px-1 font-mono text-xs">{text}</code>;

function AiIntegrations({ ai }: { ai: SettingsData["ai"] }) {
  const manual: ReactNode = <>Manual: copy prompts from the Image tab and upload the results. API integration planned.</>;
  const rows: { name: string; purpose: string; icon: LucideIcon; status: { label: string; tone: Tone }; detail: ReactNode }[] = [
    {
      name: "Claude (Anthropic)",
      purpose: "Script drafts — “Generate with Claude”",
      icon: FileText,
      status: ai.claude.configured ? { label: "Connected", tone: "success" } : { label: "Not configured", tone: "neutral" },
      detail: ai.claude.configured ? (
        <>
          Connected ({code(ai.claude.via ?? "ANTHROPIC_API_KEY")}) · Model {code(ai.claude.model)}
        </>
      ) : (
        <>
          Not configured — Generate with Claude creates mock drafts. Add {code("ANTHROPIC_API_KEY")} to {code(".env")} and restart.
        </>
      ),
    },
    { name: "Google AI Studio", purpose: "Image generation", icon: ImageIcon, status: { label: "Manual", tone: "neutral" }, detail: manual },
    { name: "Google Flow", purpose: "Video & scene generation", icon: Film, status: { label: "Manual", tone: "neutral" }, detail: manual },
  ];

  return (
    <SettingsCard id="integrations" title="AI integrations" description="Credentials are read from the server environment and are never shown here.">
      <ul className="space-y-3 p-5">
        {rows.map((r) => (
          <li key={r.name} className="flex flex-col gap-3 rounded-xl border border-[#ece9d6] p-4 sm:flex-row sm:items-start">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-olive-50 text-primary">
              <r.icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{r.name}</p>
                <StatusBadge size="sm" tone={r.status.tone} label={r.status.label} />
              </div>
              <p className="text-xs text-muted-foreground">{r.purpose}</p>
              <p className="mt-2 text-[13px] text-stone-700">{r.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}

function SectionsSkeleton() {
  const heights = [268, 300, 330, 380, 330, 340, 200];
  return (
    <>
      {SETTINGS_SECTIONS.map((s, i) => (
        <Skeleton key={s.id} className="rounded-2xl" style={{ height: heights[i] ?? 240 }} />
      ))}
    </>
  );
}
