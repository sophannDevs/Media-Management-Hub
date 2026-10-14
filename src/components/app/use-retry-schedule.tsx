"use client";

import { SearchCheck } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useServerAction } from "@/hooks/use-server-action";
import { retryScheduleAction } from "@/server/actions/schedule";

/**
 * Retry for failed posts. When the last attempt may already have gone live,
 * the server refuses until the user confirms they checked the platform; this
 * hook shows that question and retries with the confirmation.
 * Render `dialog` once next to the buttons that call `retry`.
 */
export function useRetrySchedule() {
  const { run, pending } = useServerAction();
  const [ask, setAsk] = useState<{ id: string; message: string } | null>(null);

  function retry(id: string, confirmUnknownOutcome = false) {
    run(() => retryScheduleAction(id, { confirmUnknownOutcome }), {
      onError: (error, _details, failure) => {
        if (failure?.code !== "CONFIRM_UNKNOWN_OUTCOME") return;
        setAsk({ id, message: error });
        return true;
      },
    });
  }

  const dialog = (
    <ConfirmDialog
      open={!!ask}
      onOpenChange={(open) => !open && setAsk(null)}
      title="Did the last attempt go live?"
      description={ask?.message}
      confirmLabel="It isn't there, retry"
      destructive={false}
      icon={<SearchCheck />}
      onConfirm={() => ask && retry(ask.id, true)}
    />
  );

  return { retry, pending, dialog };
}
