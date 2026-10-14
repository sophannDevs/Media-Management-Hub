import { Download, Plus } from "lucide-react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import { PageHeader } from "@/components/app/content-bits";
import { CreateContentButton, CreateContentButtonFallback } from "@/components/app/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type ContentListParams, type ContentView, LIST_PARAMS, VIEW_COOKIE } from "@/lib/content-list";
import { getContentList } from "@/server/queries/content";
import { ContentBrowser } from "./_components/content-browser";
import { ContentFilters } from "./_components/content-filters";

export const metadata: Metadata = { title: "Content" };

export default function ContentPage({ searchParams }: PageProps<"/content">) {
  return (
    <>
      <PageHeader
        title="Content"
        description="Every video from idea to published — see what's missing at a glance."
        actions={
          <>
            <Button variant="outline" size="lg" className="bg-white" asChild>
              <a href="/api/content/export" download>
                <Download />Export CSV
              </a>
            </Button>
            <Suspense fallback={<CreateContentButtonFallback />}>
              <CreateContentButton
                trigger={
                  <Button size="lg">
                    <Plus />Create Content
                  </Button>
                }
              />
            </Suspense>
          </>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <ContentList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/**
 * Table or cards, decided here so only one is rendered (PERF-01): the link's
 * ?view=, else the last choice (cookie), else cards on phones.
 */
async function chooseView(param: string | undefined): Promise<ContentView> {
  if (param === "table" || param === "cards") return param;
  const saved = (await cookies()).get(VIEW_COOKIE)?.value;
  if (saved === "table" || saved === "cards") return saved;
  return /Mobi/i.test((await headers()).get("user-agent") ?? "") ? "cards" : "table";
}

async function ContentList({ searchParams }: { searchParams: PageProps<"/content">["searchParams"] }) {
  const sp = await searchParams;
  const params: ContentListParams = Object.fromEntries(LIST_PARAMS.flatMap((k) => (typeof sp[k] === "string" ? [[k, sp[k]]] : [])));
  const [data, view] = await Promise.all([getContentList(params), chooseView(params.view)]);
  return (
    <>
      <ContentFilters params={params} counts={data.counts} stage={data.stageFilter} sort={data.sort} dir={data.dir} view={view} options={data.options} />
      <ContentBrowser
        items={data.items}
        page={data.page}
        params={params}
        sort={data.sort}
        dir={data.dir}
        view={view}
        categories={data.options.categories}
        hasFilters={Boolean(params.q || params.platform || params.category || params.priority || params.created || params.scheduled || (params.stage && params.stage !== "ALL"))}
      />
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full max-w-2xl rounded-xl" />
      <Skeleton className="h-16 w-full rounded-2xl" />
      <div className="space-y-2 rounded-2xl border bg-card p-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
