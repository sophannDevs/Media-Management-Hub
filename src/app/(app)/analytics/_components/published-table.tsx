"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Panel } from "@/components/app/content-bits";
import { ContentThumb } from "@/components/app/content-thumb";
import { PLATFORM_NAMES, PlatformLabel } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AnalyticsPost } from "@/server/queries/analytics";
import { formatHours, formatInt, formatPercent } from "./format";

type SortKey = "title" | "platform" | "published" | "views" | "likes" | "comments" | "shares" | "watch" | "engagement";
type Dir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "title", label: "Video" },
  { key: "platform", label: "Platform" },
  { key: "published", label: "Published" },
  { key: "views", label: "Views", numeric: true },
  { key: "likes", label: "Likes", numeric: true },
  { key: "comments", label: "Comments", numeric: true },
  { key: "shares", label: "Shares", numeric: true },
  { key: "watch", label: "Watch time", numeric: true },
  { key: "engagement", label: "Engagement", numeric: true },
];

function sortValue(p: AnalyticsPost, key: SortKey): number | string {
  switch (key) {
    case "title":
      return p.content.title.toLowerCase();
    case "platform":
      return PLATFORM_NAMES[p.platformId] ?? p.platformId;
    case "published":
      return p.publishedAtMs;
    case "watch":
      return p.watchMinutes;
    case "engagement":
      return p.engagement ?? -1;
    default:
      return p[key];
  }
}

const csvCell = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // keep spreadsheet apps from evaluating titles as formulas
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function PublishedTable({ rows, fileDate }: { rows: AnalyticsPost[]; fileDate: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "published", dir: "desc" });

  const sorted = useMemo(() => {
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      const diff = typeof x === "string" && typeof y === "string" ? x.localeCompare(y, "en") : Number(x) - Number(y);
      return diff * factor || b.publishedAtMs - a.publishedAtMs;
    });
  }, [rows, sort]);

  const totals = useMemo(() => {
    const t = rows.reduce(
      (acc, p) => ({ views: acc.views + p.views, likes: acc.likes + p.likes, comments: acc.comments + p.comments, shares: acc.shares + p.shares, watchMinutes: acc.watchMinutes + p.watchMinutes }),
      { views: 0, likes: 0, comments: 0, shares: 0, watchMinutes: 0 },
    );
    return { ...t, engagement: t.views ? (t.likes + t.comments + t.shares) / t.views : null };
  }, [rows]);

  function toggle(key: SortKey, numeric?: boolean) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric || key === "published" ? "desc" : "asc" }));
  }

  function exportCsv() {
    const header = ["Video", "Platform", "Account", "Published", "Views", "Likes", "Comments", "Shares", "Watch minutes", "Engagement %"];
    const lines = sorted.map((p) => [
      p.content.title,
      PLATFORM_NAMES[p.platformId] ?? p.platformId,
      p.accountName,
      `${p.publishedLabel} ${p.publishedTime}`,
      p.views,
      p.likes,
      p.comments,
      p.shares,
      p.watchMinutes,
      p.engagement === null ? "" : (p.engagement * 100).toFixed(2),
    ]);
    const csv = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `mediaflow-published-videos-${fileDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel
      className="overflow-hidden"
      title="Published videos"
      description={`All-time totals per post · ${rows.length} post${rows.length === 1 ? "" : "s"}`}
      action={
        <Button variant="outline" size="sm" className="bg-white" onClick={exportCsv}>
          <Download />
          Export CSV
        </Button>
      }
    >
      <Table className="min-w-[980px] text-[13px]">
        <TableHeader>
          <TableRow className="bg-[#fcfbf3] hover:bg-[#fcfbf3]">
            {COLUMNS.map((c) => {
              const active = sort.key === c.key;
              const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <TableHead
                  key={c.key}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn("h-10 px-3 text-xs font-medium text-muted-foreground first:pl-5 last:pr-5", c.numeric && "text-right")}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.key, c.numeric)}
                    className={cn("inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", active && "text-foreground", c.numeric && "flex-row-reverse")}
                  >
                    {c.label}
                    <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((p) => (
            <TableRow key={p.id} className="hover:bg-[#fdfcf4]">
              <TableCell className="py-2.5 pr-3 pl-5">
                <Link href={`/content/${p.content.id}`} className="group flex max-w-[340px] items-center gap-3">
                  <ContentThumb src={p.content.thumbUrl} seed={p.content.id} className="h-10 w-16" />
                  <span className="min-w-0">
                    <span className="line-clamp-1 font-medium whitespace-normal group-hover:text-primary">{p.content.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {p.accountName}
                      {p.content.archived && " · Archived"}
                    </span>
                  </span>
                </Link>
              </TableCell>
              <TableCell className="px-3">
                <PlatformLabel platform={p.platformId} />
              </TableCell>
              <TableCell className="px-3 text-muted-foreground">
                {p.publishedLabel}
                <span className="block text-xs text-stone-400">{p.publishedTime}</span>
              </TableCell>
              <TableCell className="px-3 text-right font-medium tabular-nums">{formatInt(p.views)}</TableCell>
              <TableCell className="px-3 text-right tabular-nums">{formatInt(p.likes)}</TableCell>
              <TableCell className="px-3 text-right tabular-nums">{formatInt(p.comments)}</TableCell>
              <TableCell className="px-3 text-right tabular-nums">{formatInt(p.shares)}</TableCell>
              <TableCell className="px-3 text-right tabular-nums">{formatHours(p.watchMinutes / 60)}</TableCell>
              <TableCell className="px-3 pr-5 text-right tabular-nums">{formatPercent(p.engagement)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter className="border-[#eeebd8] bg-[#fcfbf3]">
          <TableRow className="hover:bg-transparent">
            <TableCell className="py-3 pl-5 font-medium" colSpan={3}>
              Total
            </TableCell>
            <TableCell className="px-3 text-right font-semibold tabular-nums">{formatInt(totals.views)}</TableCell>
            <TableCell className="px-3 text-right tabular-nums">{formatInt(totals.likes)}</TableCell>
            <TableCell className="px-3 text-right tabular-nums">{formatInt(totals.comments)}</TableCell>
            <TableCell className="px-3 text-right tabular-nums">{formatInt(totals.shares)}</TableCell>
            <TableCell className="px-3 text-right tabular-nums">{formatHours(totals.watchMinutes / 60)}</TableCell>
            <TableCell className="px-3 pr-5 text-right tabular-nums">{formatPercent(totals.engagement)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </Panel>
  );
}
