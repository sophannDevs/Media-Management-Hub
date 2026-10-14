import { CalendarClock, Check, CircleCheck, Eye, FileText, Film, ImageIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageStatus, ReviewStatus, ScriptStatus, VideoStatus } from "@/lib/workflow/statuses";
import type { ContentWorkspace } from "@/server/queries/content";

/** Script ✓ → Images ✓ → Video ✓ → Review ✓ → Scheduled ✓ → Published ✓ */
export function Stepper({ data }: { data: ContentWorkspace }) {
  const c = data.content;
  const active = data.schedules.filter((s) => s.status !== "CANCELLED");
  const published = active.filter((s) => s.status === "PUBLISHED").length;
  const failed = active.some((s) => s.status === "FAILED");
  const steps = [
    { label: "Script", done: c.scriptStatus === "APPROVED", status: ScriptStatus.label(c.scriptStatus), icon: FileText },
    { label: "Images", done: c.imageStatus === "APPROVED", status: ImageStatus.label(c.imageStatus), icon: ImageIcon },
    { label: "Video", done: c.videoStatus === "FINAL", status: VideoStatus.label(c.videoStatus), icon: Film },
    { label: "Review", done: c.reviewStatus === "APPROVED", status: ReviewStatus.label(c.reviewStatus), icon: Eye },
    { label: "Scheduled", done: active.length > 0, status: active.length ? `${active.length} post${active.length > 1 ? "s" : ""}` : "Not scheduled", icon: CalendarClock },
    {
      label: "Published",
      done: active.length > 0 && published === active.length,
      status: failed ? "Failed" : published ? `${published} of ${active.length} live` : "Pending",
      icon: CircleCheck,
      failed,
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-card md:p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-medium">Production progress</p>
        <p className="text-sm">
          <span className="font-semibold text-primary">{data.workflow.completion}%</span> <span className="text-muted-foreground">checklist complete</span>
        </p>
      </div>
      {/* Scrolls sideways on phones: focusable so keyboard users can scroll it too */}
      <div className="thin-scroll overflow-x-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label="Production steps">
        <ol className="flex min-w-[560px] items-start">
          {steps.map((s, i) => {
            const isCurrent = i === current;
            const Icon = s.done ? Check : s.failed ? X : s.icon;
            return (
              <li key={s.label} className="relative flex flex-1 flex-col items-center text-center">
                {i > 0 && <span className={cn("absolute top-[13px] right-1/2 h-0.5 w-full", steps[i - 1].done ? "bg-primary" : "bg-stone-200")} />}
                <span
                  className={cn(
                    "relative z-10 flex size-7 items-center justify-center rounded-full",
                    s.done ? "bg-primary text-white" : s.failed ? "bg-rose-100 text-rose-700" : isCurrent ? "bg-white text-primary ring-2 ring-primary" : "bg-stone-100 text-muted-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className={cn("mt-2 text-xs font-medium", s.done || isCurrent ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
                <span className={cn("text-xs", s.failed ? "text-rose-700" : "text-muted-foreground")}>{s.status}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
