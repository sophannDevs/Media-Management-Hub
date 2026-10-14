import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/workflow/statuses";

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-600 border-stone-200/80",
  progress: "bg-amber-50 text-amber-800 border-amber-200/80",
  info: "bg-sky-50 text-sky-800 border-sky-200/80",
  warn: "bg-orange-50 text-orange-800 border-orange-200/80",
  danger: "bg-rose-50 text-rose-700 border-rose-200/80",
  success: "bg-olive-50 text-olive-700 border-olive-200",
  scheduled: "bg-violet-50 text-violet-700 border-violet-200/80",
  solid: "bg-primary text-primary-foreground border-primary",
};

interface StatusDef {
  label: (code: string) => string;
  tone: (code: string) => Tone;
}

/**
 * Status pill. Pass a status definition from `lib/workflow/statuses` and the code:
 * `<StatusBadge def={ScriptStatus} value={content.scriptStatus} />`
 */
export function StatusBadge({
  def,
  value,
  label,
  tone,
  className,
  size = "default",
}: {
  def?: StatusDef;
  value?: string;
  label?: string;
  tone?: Tone;
  className?: string;
  size?: "default" | "sm";
}) {
  const t = tone ?? (def && value ? def.tone(value) : "neutral");
  const text = label ?? (def && value ? def.label(value) : value);
  if (!text) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-[18px] px-1.5 text-[10px]" : "h-[22px] px-2 text-[11.5px]",
        TONE_CLASSES[t],
        className,
      )}
    >
      {t !== "solid" && <span className={cn("size-1.5 rounded-full bg-current", t === "progress" && "animate-pulse")} />}
      {text}
    </span>
  );
}
