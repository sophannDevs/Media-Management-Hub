"use client";

import { type ReactNode, useId } from "react";
import { Label } from "@/components/ui/label";

/**
 * A label above a control. Pass `htmlFor` (the control's id) for a single input
 * or select; pass `group` when the field is a set of buttons, so the label
 * names the whole set for screen readers instead of pointing at nothing.
 */
export function Field({ label, hint, required, className, htmlFor, group, children }: { label: string; hint?: string; required?: boolean; className?: string; htmlFor?: string; group?: boolean; children: ReactNode }) {
  const labelId = useId();
  return (
    <div className={className}>
      <Label id={group ? labelId : undefined} className="mb-1.5" htmlFor={group ? undefined : htmlFor}>
        {label}
        {required && <span className="text-rose-600">*</span>}
      </Label>
      {group ? (
        <div role="group" aria-labelledby={labelId}>
          {children}
        </div>
      ) : (
        children
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
