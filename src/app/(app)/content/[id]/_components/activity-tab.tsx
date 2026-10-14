import { History } from "lucide-react";
import { ActivityIcon } from "@/components/app/activity-icon";
import { EmptyState } from "@/components/app/content-bits";

interface ActivityItem {
  id: string;
  type: string;
  message: string;
  day: string;
  time: string;
}

/** Change history grouped by day (newest first). */
export function ActivityTab({ items }: { items: ActivityItem[] }) {
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
                  <p className="text-xs text-muted-foreground">{a.time}</p>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
