import { FolderOpen, SearchX, Upload } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/app/content-bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getMediaContentOptions, getMediaLibrary, type MediaLibraryData, parseMediaFilters } from "@/server/queries/media";
import { MediaFilterBar } from "./_components/media-filter-bar";
import { MediaGrid } from "./_components/media-grid";
import { ClearFiltersButton, MediaNavProvider, MediaPending } from "./_components/media-nav";
import { MediaPagination } from "./_components/media-pagination";
import { mediaTypePlural } from "./_components/media-types";
import { TypeCards } from "./_components/type-cards";
import { UploadMediaDialog } from "./_components/upload-media-dialog";

export const metadata: Metadata = { title: "Media Library" };

type SearchParams = PageProps<"/media">["searchParams"];

export default function MediaPage({ searchParams }: PageProps<"/media">) {
  return (
    <>
      <PageHeader
        title="Media Library"
        description="All images, videos, thumbnails, audio and music — linked to the content they belong to."
        actions={
          <Suspense fallback={<UploadButtonFallback />}>
            <UploadButton searchParams={searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<MediaSkeleton />}>
        <MediaLibrary searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/** Opens the upload dialog preset to the type / content currently filtered. */
async function UploadButton({ searchParams }: { searchParams: SearchParams }) {
  const [sp, contents] = await Promise.all([searchParams, getMediaContentOptions()]);
  const f = parseMediaFilters(sp);
  return <UploadMediaDialog contents={contents} defaultType={f.type ?? "IMAGE"} defaultContentId={f.content === "none" ? null : f.content} />;
}

function UploadButtonFallback() {
  return (
    <Button size="lg" disabled>
      <Upload />
      Upload media
    </Button>
  );
}

async function MediaLibrary({ searchParams }: { searchParams: SearchParams }) {
  const d = await getMediaLibrary(parseMediaFilters(await searchParams));
  return (
    <MediaNavProvider filters={d.filters}>
      <TypeCards counts={d.counts} all={d.all} />
      <MediaFilterBar contents={d.contentOptions} />
      <MediaPending className="space-y-5">
        {d.items.length > 0 ? (
          <>
            <MediaGrid items={d.items} contents={d.pickerOptions} />
            <MediaPagination page={d.page} pageCount={d.pageCount} total={d.total} pageSize={d.pageSize} />
          </>
        ) : (
          <NoMedia d={d} />
        )}
      </MediaPending>
    </MediaNavProvider>
  );
}

function NoMedia({ d }: { d: MediaLibraryData }) {
  const type = d.filters.type;
  return (
    <div className="rounded-2xl border bg-card shadow-card">
      {d.hasFilters ? (
        <EmptyState
          icon={<SearchX />}
          title="No media found"
          description="No files match these filters. Try another filter or upload new files."
          action={<ClearFiltersButton variant="outline" className="bg-white" />}
        />
      ) : (
        <EmptyState
          icon={<FolderOpen />}
          title={!type ? "No media yet" : type === "OTHER" ? "No other files yet" : `No ${mediaTypePlural(type).toLowerCase()} yet`}
          description={
            type
              ? "Upload one, link a file stored elsewhere, or pick another type above."
              : "Upload images, videos, thumbnails and audio — or link files stored elsewhere."
          }
          action={<UploadMediaDialog contents={d.pickerOptions} defaultType={type ?? "IMAGE"} />}
        />
      )}
    </div>
  );
}

function MediaSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className={cn("h-[62px] rounded-2xl", i === 0 && "col-span-2 sm:col-span-1")} />
        ))}
      </div>
      <Skeleton className="h-[62px] rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border bg-card shadow-card">
            <Skeleton className="aspect-video rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
