"use client";

import { createContext, lazy, type ReactNode, Suspense, useCallback, useContext, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export type OpenOptions = { contentId?: string | null; scheduleId?: string | null; platformId?: string; date?: string; time?: string };

// The form is a separate chunk (PERF-10): it downloads when someone points at a
// Schedule button or opens the dialog, instead of with every page.
const loadForm = () => import("./schedule-form").then((m) => ({ default: m.ScheduleForm }));
const ScheduleForm = lazy(loadForm);

function FormSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <DialogTitle className="sr-only">Schedule post</DialogTitle>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

const Ctx = createContext<{ openSchedule: (o?: OpenOptions) => void } | null>(null);

export function useScheduleDialog() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useScheduleDialog must be used inside <ScheduleDialogProvider>");
  return ctx;
}

/** Mount once in the app layout; open from anywhere with `useScheduleDialog().openSchedule(...)`. */
export function ScheduleDialogProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<OpenOptions | null>(null);
  const [key, setKey] = useState(0);
  // Typed text in the open form (UX-03): closing it asks first instead of silently throwing it away
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const openSchedule = useCallback((o: OpenOptions = {}) => {
    setOpts(o);
    setKey((k) => k + 1);
    setDirty(false);
  }, []);
  const value = useMemo(() => ({ openSchedule }), [openSchedule]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={!!opts} onOpenChange={(o) => !o && (dirty ? setConfirmClose(true) : setOpts(null))}>
        <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {opts && (
            <Suspense fallback={<FormSkeleton />}>
              <ScheduleForm key={key} opts={opts} onDone={() => setOpts(null)} onDirtyChange={setDirty} onSwitchContent={(contentId) => openSchedule({ ...opts, contentId, scheduleId: null })} openSchedule={openSchedule} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard your changes?"
        description="You've changed this post's details. If you close the form now, those changes are lost."
        confirmLabel="Discard changes"
        onConfirm={() => {
          setConfirmClose(false);
          setOpts(null);
        }}
      />
    </Ctx.Provider>
  );
}

/** Button that opens the dialog for a content item. */
export function ScheduleButton({
  contentId,
  scheduleId,
  platformId,
  date,
  time,
  children,
  ...rest
}: OpenOptions & { children: ReactNode } & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const { openSchedule } = useScheduleDialog();
  return (
    <Button
      {...rest}
      onPointerEnter={() => void loadForm()}
      onFocus={() => void loadForm()}
      onClick={(e) => {
        e.stopPropagation();
        openSchedule({ contentId, scheduleId, platformId, date, time });
      }}
    >
      {children}
    </Button>
  );
}
