"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { shortRequestId } from "@/lib/request-id";
import type { ActionFailure, ActionResult } from "@/server/errors";

/**
 * Runs a Server Action inside a transition and shows a toast with the result.
 * Usage: `const { run, pending } = useServerAction(); run(() => doThing(id))`
 * Return `true` from `onError` to handle the failure yourself (no toast);
 * `success: false` leaves the success toast to `onSuccess`, which gets the action's message.
 */
export function useServerAction() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    opts: {
      success?: string | false;
      onSuccess?: (data: T, message?: string) => void;
      onError?: (error: string, details?: string[], failure?: ActionFailure) => boolean | void;
    } = {},
  ) {
    startTransition(async () => {
      try {
        const r = await action();
        // Actions that redirect resolve without a result — navigation is already happening
        if (!r) return;
        if (r.ok) {
          const msg = opts.success ?? r.message;
          if (msg) toast.success(msg);
          opts.onSuccess?.(r.data, r.message);
        } else if (r.code === "UNAUTHENTICATED") {
          // The session ended (signed out elsewhere or expired): sign in and come back
          router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        } else {
          if (opts.onError?.(r.error, r.details, r) === true) return;
          // An unexpected failure carries a reference to quote: it matches the server's log line
          const reference = r.code === "INTERNAL" && r.requestId ? `Reference ${shortRequestId(r.requestId)}` : null;
          toast.error(r.error, { description: [r.details?.join(" · "), reference].filter(Boolean).join(" — ") || undefined });
        }
      } catch {
        toast.error("Network error — please try again.");
      }
    });
  }

  return { run, pending };
}
