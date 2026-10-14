import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AnalyticsHeatmap } from "@/server/queries/analytics";
import { formatCompact, formatInt } from "./format";

// Sequential single-hue ramp (olive 50 → 300 → 800).
const LOW = [0xf4, 0xf6, 0xee];
const MID = [0xaf, 0xc0, 0x8a];
const HIGH = [0x38, 0x46, 0x20];

function mix(a: number[], b: number[], t: number) {
  return a.map((c, i) => Math.round(c + (b[i] - c) * t));
}

function rampColor(t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? mix(LOW, MID, clamped * 2) : mix(MID, HIGH, (clamped - 0.5) * 2);
}

/** WCAG relative luminance of an sRGB triple. */
function luminance([r, g, b]: number[]) {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const rgb = (c: number[]) => `rgb(${c.join(" ")})`;

export function PostingHeatmap({ data }: { data: AnalyticsHeatmap }) {
  const { days, slots, cells, best, max } = data;
  const bestCell = best ? cells[best.day][best.slot] : null;

  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `2.25rem repeat(${slots.length}, minmax(0, 1fr))` }} role="table" aria-label="Average views per post by weekday and publish time">
        <div role="row" className="contents">
          <span role="columnheader" />
          {slots.map((s) => (
            <span key={s.label} role="columnheader" className="pb-1 text-center text-[11px] text-muted-foreground tabular-nums">
              {s.label}
            </span>
          ))}
        </div>
        {days.map((day, d) => (
          <div key={day.short} role="row" className="contents">
            <span role="rowheader" className="flex items-center text-[11px] text-muted-foreground">
              {day.short}
            </span>
            {cells[d].map((cell, s) => {
              const isBest = best?.day === d && best?.slot === s;
              const where = `${day.long} · ${slots[s].range}`;
              const color = cell.avg !== null && max > 0 ? rampColor(cell.avg / max) : null;
              const posts = `${cell.posts} post${cell.posts === 1 ? "" : "s"}`;
              return (
                <Tooltip key={s}>
                  <TooltipTrigger asChild>
                    <span
                      role="cell"
                      tabIndex={0}
                      aria-label={cell.avg === null ? `${where}: no posts` : `${where}: ${formatInt(cell.avg)} average views across ${posts}`}
                      className={cn(
                        "flex h-9 items-center justify-center rounded-md text-[11px] font-medium tabular-nums outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
                        color ? "hover:ring-2 hover:ring-foreground/25" : "border border-[#efecd9] bg-white text-stone-400 hover:border-stone-300",
                        isBest && "ring-2 ring-foreground ring-offset-1 ring-offset-card hover:ring-foreground",
                      )}
                      style={color ? { background: rgb(color), color: luminance(color) < 0.2 ? "#ffffff" : "#2b2a24" } : undefined}
                    >
                      {cell.avg === null ? "—" : formatCompact(cell.avg)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="flex-col items-start gap-0.5">
                    <span className="opacity-75">{where}</span>
                    {cell.avg === null ? (
                      <span>No posts published in this slot yet</span>
                    ) : (
                      <span>
                        <b className="font-semibold">{formatInt(cell.avg)}</b> avg views · {posts}
                      </span>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          Fewer
          <span className="h-2 w-24 rounded-full" style={{ background: `linear-gradient(90deg, ${rgb(LOW)}, ${rgb(MID)}, ${rgb(HIGH)})` }} aria-hidden />
          More views
        </span>
        {best && bestCell?.avg != null && (
          <span>
            Best: <b className="font-semibold text-foreground">{days[best.day].short} {slots[best.slot].label}</b> · {formatCompact(bestCell.avg)} avg
          </span>
        )}
      </div>
      {data.outsideSlots > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {data.outsideSlots} post{data.outsideSlots === 1 ? " was" : "s were"} published between 00:00 and 06:00 and {data.outsideSlots === 1 ? "isn't" : "aren't"} shown.
        </p>
      )}
    </div>
  );
}
