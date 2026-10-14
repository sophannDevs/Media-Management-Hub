"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";

/**
 * Runs a Server Action inside a transition and shows a toast with the result.
 * Usage: `const { run, pending } = useServerAction(); run(() => doThing(id))`
 */
export function useServerAction() {
  const [pending, startTransition] = useTransition();

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    opts: { success?: string | false; onSuccess?: (data: T) => void; onError?: (error: string, details?: string[]) => void } = {},
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
          toast.error(r.error, { description: r.details?.join(" · ") });
          opts.onError?.(r.error, r.details);
        }
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  return { run, pending };
}
