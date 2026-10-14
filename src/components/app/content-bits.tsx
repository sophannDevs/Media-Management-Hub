import { ChevronDown, ChevronUp, ChevronsUp } from "lucide-react";
import type { ReactNode } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ImageStatus, Priority, ReviewStatus, ScriptStatus, VideoStatus } from "@/lib/workflow/statuses";

export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  const map = {
    HIGH: [ChevronsUp, "text-rose-700"],
    MEDIUM: [ChevronUp, "text-amber-700"],
    LOW: [ChevronDown, "text-stone-500"],
  } as const;
  const [Icon, color] = map[priority as keyof typeof map] ?? map.LOW;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", color, className)}>
      <Icon className="size-3.5" />
      {Priority.label(priority)}
    </span>
  );
}

/** The four production steps behind the S / I / V / R chips, and the status that completes each. */
export const PRODUCTION_STEPS = [
  { field: "scriptStatus", key: "S", name: "Script", def: ScriptStatus, done: "APPROVED" },
  { field: "imageStatus", key: "I", name: "Images", def: ImageStatus, done: "APPROVED" },
  { field: "videoStatus", key: "V", name: "Video", def: VideoStatus, done: "FINAL" },
  { field: "reviewStatus", key: "R", name: "Review", def: ReviewStatus, done: "APPROVED" },
] as const;

export type ProductionStatuses = { scriptStatus: string; imageStatus: string; videoStatus: string; reviewStatus: string };

/** Look of a production chip for a status code. */
export function stepChipClass(code: string, done: boolean) {
  const warn = code === "NEEDS_REVISION" || code === "CHANGES_REQUESTED";
  const busy = ["GENERATING", "EDITING", "IN_REVIEW", "GENERATED"].includes(code);
  return cn(
    "flex size-6 items-center justify-center rounded-md text-xs font-semibold",
    done
      ? "bg-primary text-primary-foreground"
      : warn
        ? "bg-orange-100 text-orange-800 ring-1 ring-orange-200"
        : busy
          ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
          : "bg-stone-100 text-muted-foreground",
  );
}

/** Compact S / I / V / R production indicator. */
export function MiniSteps(statuses: ProductionStatuses) {
  return (
    <div className="flex items-center gap-1">
      {PRODUCTION_STEPS.map((s) => {
        const code = statuses[s.field];
        return (
          <span key={s.key} title={`${s.name}: ${s.def.label(code)}`} className={stepChipClass(code, code === s.done)}>
            {s.key}
          </span>
        );
      })}
    </div>
  );
}

export function CompletionBar({ value, label = "Completion", className }: { value: number; label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Progress value={value} aria-label={label} className="h-1.5 bg-[#eeebd8]" />
      <span className="w-8 shrink-0 text-xs text-muted-foreground tabular-nums">{value}%</span>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-4 py-12 text-center", className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-olive-50 text-primary [&_svg]:size-5">{icon}</div>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Panel({ title, description, action, children, className, bodyClassName }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border bg-card shadow-card", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-[#f1eedf] px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
