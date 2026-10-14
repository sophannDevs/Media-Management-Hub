import { CalendarClock, CalendarX, CircleCheck, Dot, FileText, Film, ImageIcon, Lightbulb, MessageSquareWarning, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const MAP: Record<string, [typeof Dot, string]> = {
  "content.created": [Lightbulb, "bg-amber-50 text-amber-700"],
  "content.updated": [Pencil, "bg-stone-100 text-stone-600"],
  "status.changed": [MessageSquareWarning, "bg-olive-50 text-olive-700"],
  "script.saved": [FileText, "bg-olive-50 text-olive-700"],
  "script.generated": [FileText, "bg-olive-50 text-olive-700"],
  "image.prompt": [ImageIcon, "bg-olive-50 text-olive-700"],
  "media.uploaded": [ImageIcon, "bg-olive-50 text-olive-700"],
  "media.deleted": [Trash2, "bg-stone-100 text-stone-600"],
  "video.uploaded": [Film, "bg-olive-50 text-olive-700"],
  "schedule.created": [CalendarClock, "bg-violet-50 text-violet-700"],
  "schedule.changed": [CalendarClock, "bg-violet-50 text-violet-700"],
  "schedule.cancelled": [CalendarX, "bg-stone-100 text-stone-600"],
  "publish.succeeded": [CircleCheck, "bg-olive-100 text-olive-800"],
  "publish.failed": [TriangleAlert, "bg-rose-50 text-rose-700"],
};

export function ActivityIcon({ type, className }: { type: string; className?: string }) {
  const [Icon, cls] = MAP[type] ?? [Dot, "bg-stone-100 text-stone-600"];
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", cls, className)}>
      <Icon className="size-4" />
    </span>
  );
}
