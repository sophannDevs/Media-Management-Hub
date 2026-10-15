"use client";

import { History, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { ActivityIcon } from "@/components/app/activity-icon";
import { EmptyState } from "@/components/app/content-bits";
import { Button } from "@/components/ui/button";
import type { ActivityPage } from "@/server/queries/content";

type ActivityItem = ActivityPage["items"][number];

/**
 * Change history grouped by day (newest first). The page carries the latest
 * events; older ones are fetched on request (PERF-05).
 */
export function ActivityTab({ contentId, initial }: { contentId: string; initial: ActivityPage }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/content/${contentId}/activity?after=${encodeURIComponent(cursor)}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as ActivityPage;
      setItems((cur) => [...cur, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (!items.length) {
    return (
      <div className="max-w-3xl rounded-2xl border bg-card shadow-card">
        <EmptyState icon={<History />} title="No activity yet" description="Status changes, uploads and schedules will show up here." />
      </div>
    );
  }
  const groups = new Map<string, ActivityItem[]>();
  for (const a of items) groups.set(a.day, [...(groups.get(a.day) ?? []), a]);

  return (
    <div className="max-w-3xl rounded-2xl border bg-card shadow-card">
      <div className="space-y-6 p-5">
        {[...groups.entries()].map(([day, list]) => (
          <div key={day}>
            <p className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{day}</p>
            <ol className="relative ml-4 space-y-4 border-l border-[#ece9d6]">
              {list.map((a) => (
                <li key={a.id} className="relative pl-6">
                  <span className="absolute top-0 -left-4">
                    <ActivityIcon type={a.type} />
                  </span>
                  <p className="pt-1.5 text-sm">{a.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.time} · {a.by}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      {(cursor || failed) && (
        <div className="flex flex-col items-center gap-2 border-t border-[#f1eedf] px-5 py-3">
          {failed && <p role="alert" className="text-xs text-rose-700">Couldn&apos;t load older activity. Try again.</p>}
          <Button variant="outline" size="sm" className="bg-white" disabled={loading} onClick={more}>
            {loading && <LoaderCircle className="animate-spin" />}
            Show older activity
          </Button>
        </div>
      )}
    </div>
  );
}
