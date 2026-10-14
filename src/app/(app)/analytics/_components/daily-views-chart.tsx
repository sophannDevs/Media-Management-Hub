"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Panel } from "@/components/app/content-bits";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AnalyticsDailyPoint } from "@/server/queries/analytics";
import { formatCompact, formatInt } from "./format";

const chartConfig = {
  views: { label: "Views", color: "var(--chart-1)" },
  youtube: { label: "YouTube", color: "var(--youtube)" },
  facebook: { label: "Facebook", color: "var(--facebook)" },
} satisfies ChartConfig;

type SeriesKey = keyof typeof chartConfig;
const SPLIT: SeriesKey[] = ["youtube", "facebook"];
const TOTAL: SeriesKey[] = ["views"];

export function DailyViewsChart({
  data,
  description,
  canSplit,
  className,
}: {
  data: AnalyticsDailyPoint[];
  description: string;
  /** Only when all platforms are shown. */
  canSplit: boolean;
  className?: string;
}) {
  const [splitOn, setSplitOn] = useState(false);
  const split = canSplit && splitOn;
  const series = split ? SPLIT : TOTAL;

  return (
    <Panel
      className={className}
      title="Daily views"
      description={description}
      action={
        canSplit ? (
          <Label className="shrink-0 cursor-pointer text-xs font-normal text-muted-foreground">
            <Switch size="sm" checked={splitOn} onCheckedChange={setSplitOn} />
            Split by platform
          </Label>
        ) : undefined
      }
    >
      <div className="px-3 pt-4 pb-3 sm:px-4">
        {split && (
          <ul className="mb-2 flex items-center justify-end gap-4 px-1 text-xs text-muted-foreground" aria-label="Legend">
            {SPLIT.map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <span className="h-0.5 w-3.5 rounded-full" style={{ background: chartConfig[key].color }} aria-hidden />
                {chartConfig[key].label}
              </li>
            ))}
          </ul>
        )}
        <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full [&_.recharts-curve.recharts-tooltip-cursor]:stroke-[#1c1b17]/25">
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#efecd9" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} width={44} tickMargin={4} allowDecimals={false} tickFormatter={(v: number) => (v ? formatCompact(v) : "0")} />
            <ChartTooltip
              cursor={{ strokeWidth: 1 }}
              content={
                <ChartTooltipContent
                  className="min-w-40 bg-white"
                  labelClassName="font-normal text-muted-foreground"
                  labelFormatter={(_, payload) => (payload?.[0]?.payload as AnalyticsDailyPoint | undefined)?.fullLabel}
                  formatter={(value, name, item) => (
                    <div className="flex w-full items-center gap-2">
                      <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden />
                      <span className="font-semibold text-foreground tabular-nums">{formatInt(Number(value ?? 0))}</span>
                      <span className="text-muted-foreground">{chartConfig[name as SeriesKey]?.label ?? name}</span>
                    </div>
                  )}
                />
              }
            />
            {series.map((key) => (
              <Area
                key={key}
                dataKey={key}
                type="monotone"
                stroke={`var(--color-${key})`}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill={`var(--color-${key})`}
                fillOpacity={split ? 0 : 0.1}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff" }}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </div>
    </Panel>
  );
}
