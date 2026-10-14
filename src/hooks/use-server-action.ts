"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionFailure, ActionResult } from "@/server/errors";

/**
 * Runs a Server Action inside a transition and shows a toast with the result.
 * Usage: `const { run, pending } = useServerAction(); run(() => doThing(id))`
 * Return `true` from `onError` to handle the failure yourself (no toast).
 */
export function useServerAction() {
  const [pending, startTransition] = useTransition();

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    opts: { success?: string | false; onSuccess?: (data: T) => void; onError?: (error: string, details?: string[], failure?: ActionFailure) => boolean | void } = {},
  ) {
    startTransition(async () => {
      try {
        const r = await action();
        // Actions that redirect resolve without a result — navigation is already happening
        if (!r) return;
        if (r.ok) {
          const msg = opts.success ?? r.message;
          if (msg) toast.success(msg);
          opts.onSuccess?.(r.data);
        } else {
          if (opts.onError?.(r.error, r.details, r) === true) return;
          toast.error(r.error, { description: r.details?.join(" · ") });
        }
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  return { run, pending };
}
