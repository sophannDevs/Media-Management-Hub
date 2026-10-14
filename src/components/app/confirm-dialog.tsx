"use client";

import { CircleHelp, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

/**
 * Confirmation for destructive / important actions.
 * Wrap the trigger: `<ConfirmDialog title=… onConfirm={…}><Button/></ConfirmDialog>`
 * or control it with `open` / `onOpenChange`.
 */
export function ConfirmDialog({
  children,
  title,
  description,
  confirmLabel = "Delete",
  destructive = true,
  onConfirm,
  open,
  onOpenChange,
  icon,
}: {
  children?: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Overrides the default trash / question icon */
  icon?: ReactNode;
}) {
  const [inner, setInner] = useState(false);
  const isOpen = open ?? inner;
  const setOpen = onOpenChange ?? setInner;
  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className={cn(destructive ? "bg-rose-50 text-rose-700" : "bg-olive-50 text-primary")}>
            {icon ?? (destructive ? <Trash2 /> : <CircleHelp />)}
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(destructive && "bg-destructive text-white hover:bg-destructive/90")}
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
