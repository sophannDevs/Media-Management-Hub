import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app/content-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { getPromptLibrary, parsePromptCategory } from "@/server/queries/prompts";
import { NewPromptButton } from "./_components/prompt-editor";
import { PromptLibrary } from "./_components/prompt-library";

export const metadata: Metadata = { title: "AI Prompts" };

export default function PromptsPage({ searchParams }: PageProps<"/prompts">) {
  return (
    <>
      <PageHeader
        title="AI Prompt Library"
        description={
          <>
            Reusable prompts for Claude, Google AI Studio and Flow. Use{" "}
            <code className="rounded border border-[#ece9d6] bg-white px-1 font-mono text-xs">{"{variables}"}</code> for the parts that change.
          </>
        }
        actions={<NewPromptButton />}
      />
      <Suspense fallback={<LibrarySkeleton />}>
        <Library searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Library({ searchParams }: { searchParams: PageProps<"/prompts">["searchParams"] }) {
  const [{ category }, { prompts }] = await Promise.all([searchParams, getPromptLibrary()]);
  return <PromptLibrary prompts={prompts} initialCategory={parsePromptCategory(category)} />;
}

function LibrarySkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-[42px] w-full max-w-[850px] rounded-xl" />
        <Skeleton className="ml-auto h-10 w-full rounded-lg sm:w-64" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[252px] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
