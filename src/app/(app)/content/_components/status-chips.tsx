"use client";

import { Check } from "lucide-react";
import { PRODUCTION_STEPS, type ProductionStatuses, stepChipClass } from "@/components/app/content-bits";
import { StatusBadge } from "@/components/app/status-badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useServerAction } from "@/hooks/use-server-action";
import { setStatusAction } from "@/server/actions/content";

/**
 * The S / I / V / R chips of a list row, each a menu that changes that status
 * in place (UX-02). The server keeps its guard rails (approving needs the
 * script, images or video) and the toast says why when it refuses.
 */
export function StatusChips({ item }: { item: ProductionStatuses & { id: string } }) {
  const { run, pending } = useServerAction();
  return (
    // Rows open the workspace on click; changing a status mustn't
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {PRODUCTION_STEPS.map((s) => {
        const code = item[s.field];
        const label = s.def.label(code);
        return (
          <DropdownMenu key={s.key}>
            <DropdownMenuTrigger asChild disabled={pending}>
              <button type="button" aria-label={`${s.name}: ${label}. Change`} title={`${s.name}: ${label}`} className={stepChipClass(code, code === s.done)}>
                {s.key}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>{s.name}</DropdownMenuLabel>
              {s.def.options.map((o) => (
                <DropdownMenuItem key={o.value} disabled={o.value === code} onSelect={() => run(() => setStatusAction(item.id, s.field, o.value))}>
                  <StatusBadge def={s.def} value={o.value} size="sm" />
                  {o.value === code && <Check className="ml-auto" aria-label="Current" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </div>
  );
}
