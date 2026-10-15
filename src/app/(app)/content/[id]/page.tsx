import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Skeleton } from "@/components/ui/skeleton";
import { getContentWorkspace } from "@/server/queries/content";
import { ActivityTab } from "./_components/activity-tab";
import { ImagesTab } from "./_components/images-tab";
import { OverviewTab } from "./_components/overview-tab";
import { PublishingTab } from "./_components/publishing-tab";
import { ScriptTab } from "./_components/script-tab";
import { Stepper } from "./_components/stepper";
import { VideoTab } from "./_components/video-tab";
import { ReadinessBanner, WorkspaceHeader, WorkspaceProvider, WorkspaceTabs, type TabKey } from "./_components/workspace";

export const metadata: Metadata = { title: "Content workspace" };

const TABS: TabKey[] = ["overview", "script", "images", "video", "publishing", "activity"];

export default function ContentWorkspacePage({ params, searchParams }: PageProps<"/content/[id]">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <Workspace params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Workspace({ params, searchParams }: Pick<PageProps<"/content/[id]">, "params" | "searchParams">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const data = await getContentWorkspace(id);
  if (!data) notFound();

  const requested = typeof sp.tab === "string" ? (sp.tab as TabKey) : "overview";
  const tab = TABS.includes(requested) ? requested : "overview";
  const { content } = data;

  return (
    <WorkspaceProvider initialTab={tab}>
      {/* Edits in progress survive: a refresh re-renders server data, client state stays */}
      <AutoRefresh active={data.workflow.inFlight} />
      <div>
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/content" className="hover:text-primary">Content</Link>
          <ChevronRight className="size-3.5" />
          <span className="truncate text-stone-700">{content.title}</span>
        </nav>
        <div className="mt-3">
          <WorkspaceHeader data={data} />
        </div>
      </div>

      <Stepper data={data} />
      <ReadinessBanner missing={data.workflow.missing} ready={data.workflow.ready} hasSchedules={data.schedules.some((s) => s.status !== "CANCELLED")} contentId={content.id} />

      <WorkspaceTabs
        counts={{
          images: data.media.images.length,
          video: data.media.videos.length,
          publishing: data.schedules.filter((s) => s.status !== "CANCELLED").length,
          script: data.script.currentVersion,
        }}
        panels={{
          overview: <OverviewTab data={data} />,
          // Remount the editor when a new version is saved so it picks up the latest text
          script: <ScriptTab key={data.script.currentVersion} data={data} />,
          images: <ImagesTab data={data} />,
          video: <VideoTab data={data} />,
          publishing: <PublishingTab data={data} />,
          activity: <ActivityTab key={data.activity.items[0]?.id} contentId={content.id} initial={data.activity} />,
        }}
      />
    </WorkspaceProvider>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-64" />
      <div className="flex gap-4">
        <Skeleton className="aspect-video w-44 rounded-lg" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-8 w-full max-w-xl" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-10 w-full max-w-2xl" />
      <div className="grid gap-6 lg:grid-cols-12">
        <Skeleton className="h-96 rounded-2xl lg:col-span-8" />
        <Skeleton className="h-96 rounded-2xl lg:col-span-4" />
      </div>
    </div>
  );
}
