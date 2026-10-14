import { ChartColumn, Clock, Eye, Gauge, Heart, type LucideIcon, Minus, Send, TrendingDown, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { EmptyState, PageHeader, Panel } from "@/components/app/content-bits";
import { ContentThumb } from "@/components/app/content-thumb";
import { PLATFORM_NAMES, PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ANALYTICS_PLATFORMS,
  ANALYTICS_RANGES,
  type AnalyticsData,
  DEFAULT_RANGE,
  getAnalyticsData,
  parseAnalyticsParams,
} from "@/server/queries/analytics";
import { AnalyticsFilters, AnalyticsTransition, PendingFrame } from "./_components/analytics-filters";
import { DailyViewsChart } from "./_components/daily-views-chart";
import { formatCount, formatHours, formatInt, formatPercent, formatSigned, percentChange } from "./_components/format";
import { PostingHeatmap } from "./_components/posting-heatmap";
import { PublishedTable } from "./_components/published-table";

export const metadata: Metadata = { title: "Analytics" };

type SearchParams = PageProps<"/analytics">["searchParams"];

export default function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  return (
    <AnalyticsTransition>
      <PageHeader
        title="Analytics"
        description="Views, watch time and engagement across platforms."
        actions={
          <Suspense fallback={<Skeleton className="h-[42px] w-[352px] max-w-full rounded-xl" />}>
            <Filters searchParams={searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsContent searchParams={searchParams} />
      </Suspense>
    </AnalyticsTransition>
  );
}

async function Filters({ searchParams }: { searchParams: SearchParams }) {
  const { range, platform } = parseAnalyticsParams(await searchParams);
  return <AnalyticsFilters range={range} platform={platform} ranges={ANALYTICS_RANGES} platforms={ANALYTICS_PLATFORMS} defaultRange={DEFAULT_RANGE} />;
}

async function AnalyticsContent({ searchParams }: { searchParams: SearchParams }) {
  const d = await getAnalyticsData(parseAnalyticsParams(await searchParams));
  const scope = d.platform ? PLATFORM_NAMES[d.platform] : "all platforms";

  if (!d.posts.length) {
    return (
      <PendingFrame>
        <Panel>
          <EmptyState
            icon={<ChartColumn />}
            title={d.platform && d.hasAnyPublished ? `No published ${PLATFORM_NAMES[d.platform]} posts yet` : "No published posts yet"}
            description="Views, watch time and engagement show up here once a video goes live. Schedule a ready video to get started."
            action={
              d.platform && d.hasAnyPublished ? (
                <Button variant="outline" className="bg-white" asChild>
                  <Link href={d.range === DEFAULT_RANGE ? "/analytics" : `/analytics?range=${d.range}`}>Show all platforms</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/content?stage=READY">Find ready videos</Link>
                </Button>
              )
            }
          />
        </Panel>
      </PendingFrame>
    );
  }

  return (
    <PendingFrame className="space-y-4 md:space-y-6">
      {d.simulated && (
        <p role="note" className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-950">
          <strong className="font-semibold">Simulated metrics.</strong> These numbers were generated for simulated posts so you can try this page. Real views will
          sync from YouTube Analytics and Facebook Insights once accounts are connected for real.
        </p>
      )}
      <KpiTiles d={d} />

      <section className="grid gap-4 md:gap-6 lg:grid-cols-12">
        <DailyViewsChart className="lg:col-span-8" data={d.daily} canSplit={!d.platform} description={`${d.periodLabel} · ${scope}`} />
        <PlatformPerformance d={d} />
      </section>

      <section className="grid gap-4 md:gap-6 lg:grid-cols-12">
        <Panel className="lg:col-span-5" title="Best posting time" description={`Average views per post by publish time · all time · ${scope}`}>
          <div className="p-4 sm:p-5">
            <PostingHeatmap data={d.heatmap} />
          </div>
        </Panel>
        <TopContent d={d} />
      </section>

      <PublishedTable rows={d.posts} fileDate={d.todayKey} />
    </PendingFrame>
  );
}

// ---------- KPI tiles ----------

function Delta({ value, unit = "%", vs }: { value: number | null; unit?: string; vs: string }) {
  if (value === null) return <p className="mt-1 text-xs text-muted-foreground">No data for the previous {vs}</p>;
  const flat = formatSigned(value, unit) === `0${unit}`;
  const Icon = flat ? Minus : value > 0 ? TrendingUp : TrendingDown;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
      <Icon className={cn("size-3.5 shrink-0", flat ? "text-muted-foreground" : value > 0 ? "text-olive-700" : "text-rose-700")} aria-hidden />
      <span className={cn("font-medium", flat ? "text-stone-600" : value > 0 ? "text-olive-700" : "text-rose-700")}>{formatSigned(value, unit)}</span>
      vs previous {vs}
    </p>
  );
}

function KpiTiles({ d }: { d: AnalyticsData }) {
  const k = d.kpis;
  const vs = `${d.range} days`;
  const tiles: { label: string; value: string; title?: string; icon: LucideIcon; sub: ReactNode }[] = [
    {
      label: "Total views",
      value: formatCount(k.views),
      title: `${formatInt(k.views)} views`,
      icon: Eye,
      sub: <Delta value={percentChange(k.views, k.prevViews)} vs={vs} />,
    },
    {
      label: "Watch time",
      value: formatHours(k.watchHours),
      icon: Clock,
      sub: <Delta value={percentChange(k.watchHours, k.prevWatchHours)} vs={vs} />,
    },
    {
      label: "Engagement rate",
      value: formatPercent(k.engagement),
      icon: Heart,
      sub:
        k.engagement !== null && k.prevEngagement !== null ? (
          <Delta value={(k.engagement - k.prevEngagement) * 100} unit=" pts" vs={vs} />
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">Likes, comments and shares per view</p>
        ),
    },
    {
      label: "Posts published",
      value: formatInt(k.posts),
      icon: Send,
      sub: (
        <p className="mt-1 text-xs text-muted-foreground">
          {d.platform
            ? `${formatInt(k.prevPosts)} in the previous ${vs}`
            : k.postsByPlatform.map((p) => `${PLATFORM_NAMES[p.platformId]} ${p.count}`).join(" · ")}
        </p>
      ),
    },
    {
      label: "Avg views per post",
      value: k.avgViewsPerPost === null ? "—" : formatCount(k.avgViewsPerPost),
      title: k.avgViewsPerPost === null ? undefined : `${formatInt(k.avgViewsPerPost)} views`,
      icon: Gauge,
      sub: (
        <p className="mt-1 text-xs text-muted-foreground">
          {k.posts ? `Across the ${k.posts} post${k.posts === 1 ? "" : "s"} published in this period` : "No posts published in this period"}
        </p>
      ),
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-5" aria-label="Key metrics">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border bg-card p-4 shadow-card last:col-span-2 lg:last:col-span-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{t.label}</span>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-olive-50 text-primary">
              <t.icon className="size-4" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl" title={t.title}>
            {t.value}
          </p>
          {t.sub}
        </div>
      ))}
    </section>
  );
}

// ---------- Platform performance ----------

function PlatformPerformance({ d }: { d: AnalyticsData }) {
  const max = Math.max(1, ...d.platforms.map((p) => p.views));
  const total = d.platforms.reduce((sum, p) => sum + p.views, 0);
  return (
    <Panel className="lg:col-span-4" title="Platform performance" description={`Views · ${d.periodLabel}`}>
      <div className="space-y-5 p-5">
        {d.platforms.map((p) => {
          const name = PLATFORM_NAMES[p.platformId];
          const dimmed = d.platform !== null && d.platform !== p.platformId;
          const share = total ? Math.round((p.views / total) * 100) : 0;
          return (
            <div key={p.platformId} className={cn("transition-opacity", dimmed && "opacity-45")}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <PlatformIcon platform={p.platformId} size={16} />
                  {name}
                </span>
                <span className="font-semibold tabular-nums">{formatInt(p.views)}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div role="img" tabIndex={0} aria-label={`${name}: ${formatInt(p.views)} views, ${share}% of all views`} className="mt-2 h-3 rounded-[4px] bg-[#f5f3e3] outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <div
                      className="h-full rounded-r-[4px]"
                      style={{ width: `${p.views ? Math.max(1.5, (p.views / max) * 100) : 0}%`, background: `var(--${p.platformId})` }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <b className="font-semibold">{formatInt(p.views)}</b> views · {share}% of all views
                </TooltipContent>
              </Tooltip>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>
                  <dt>Engagement</dt>
                  <dd className="font-medium text-foreground tabular-nums">{formatPercent(p.engagement)}</dd>
                </div>
                <div>
                  <dt>Posts</dt>
                  <dd className="font-medium text-foreground tabular-nums">{formatInt(p.posts)}</dd>
                </div>
                <div>
                  <dt>Watch time</dt>
                  <dd className="font-medium text-foreground tabular-nums">{formatHours(p.watchHours)}</dd>
                </div>
              </dl>
            </div>
          );
        })}
        <p className="border-t border-[#f3f1e4] pt-3 text-xs text-muted-foreground">{platformInsight(d)}</p>
      </div>
    </Panel>
  );
}

function platformInsight(d: AnalyticsData) {
  if (d.platform) return `Filtered to ${PLATFORM_NAMES[d.platform]} — other platforms are dimmed for comparison.`;
  const withViews = d.platforms.filter((p) => p.views > 0);
  if (!withViews.length) return "No views in this period yet.";
  if (withViews.length === 1) return `Only ${PLATFORM_NAMES[withViews[0].platformId]} has views in this period — publish to both platforms to compare them.`;
  const [a, b] = [...withViews].sort((x, y) => y.views - x.views);
  const ratio = a.views / b.views;
  const reach = ratio >= 1.1 ? `${PLATFORM_NAMES[a.platformId]} brings ${ratio.toFixed(1)}× the views of ${PLATFORM_NAMES[b.platformId]}` : "Both platforms bring similar views";
  if ((b.engagement ?? 0) > (a.engagement ?? 0)) return `${reach}, but ${PLATFORM_NAMES[b.platformId]} has higher engagement (${formatPercent(b.engagement)} vs ${formatPercent(a.engagement)}).`;
  return `${reach} and leads on engagement too (${formatPercent(a.engagement)}).`;
}

// ---------- Best-performing content ----------

function TopContent({ d }: { d: AnalyticsData }) {
  const top = d.top;
  const max = top[0]?.views ?? 1;
  return (
    <Panel className="lg:col-span-7" title="Best-performing content" description={`Top ${top.length || 5} by views · ${d.periodLabel}`}>
      {top.length === 0 ? (
        <EmptyState icon={<Eye />} title="No views in this period" description="Pick a longer range to see your best videos." />
      ) : (
        <ol className="space-y-4 p-5">
          {top.map((c, i) => {
            const pct = Math.round((c.views / max) * 100);
            return (
              <li key={c.id} className="flex items-center gap-3 sm:gap-4">
                <span className="w-4 shrink-0 text-sm font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                <ContentThumb src={c.thumbUrl} seed={c.id} durationSec={c.durationSec} className="h-12 w-20 sm:h-14 sm:w-24" />
                <div className="min-w-0 flex-1">
                  <Link href={`/content/${c.id}`} className="block truncate text-sm font-medium hover:text-primary">
                    {c.title}
                  </Link>
                  <div className="mt-2 flex items-center gap-3">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div role="img" tabIndex={0} aria-label={`${formatInt(c.views)} views, ${pct}% of the top video`} className="h-2 flex-1 rounded-[3px] bg-[#f5f3e3] outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <div className="h-full rounded-r-[4px] bg-primary" style={{ width: `${Math.max(1.5, pct)}%` }} />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <b className="font-semibold">{formatInt(c.views)}</b> views{i > 0 && ` · ${pct}% of #1`}
                      </TooltipContent>
                    </Tooltip>
                    <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">{formatCount(c.views)}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {formatPercent(c.engagement)} engagement · {formatHours(c.watchHours)} watched
                    {c.archived && " · Archived"}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

// ---------- Loading state ----------

function AnalyticsSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className={cn("h-[118px] rounded-2xl", i === 4 && "col-span-2 lg:col-span-1")} />
        ))}
      </div>
      <div className="grid gap-4 md:gap-6 lg:grid-cols-12">
        <Skeleton className="h-[356px] rounded-2xl lg:col-span-8" />
        <Skeleton className="h-[356px] rounded-2xl lg:col-span-4" />
      </div>
      <div className="grid gap-4 md:gap-6 lg:grid-cols-12">
        <Skeleton className="h-[392px] rounded-2xl lg:col-span-5" />
        <Skeleton className="h-[392px] rounded-2xl lg:col-span-7" />
      </div>
      <Skeleton className="h-[420px] rounded-2xl" />
    </div>
  );
}
