import { Archive, Bell, Building, FolderTree, type LucideIcon, Plug, Send, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Sections of the settings page, in order (ids are the anchors used by the sub-navigation). */
export const SETTINGS_SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "workspace", label: "Workspace", icon: Building },
  { id: "labels", label: "Categories & series", icon: FolderTree },
  { id: "workflow", label: "Workflow rules", icon: Workflow },
  { id: "publishing", label: "Publishing", icon: Send },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "integrations", label: "AI integrations", icon: Plug },
  { id: "archive", label: "Archived content", icon: Archive },
];

export function SettingsCard({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("min-w-0 scroll-mt-24 rounded-2xl border bg-card shadow-card", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-[#f1eedf] px-5 py-4">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-[15px] font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Bottom action bar of a settings card (Save / Reset). */
export function SettingsFooter({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-[#f3f1e4] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-h-5 text-xs text-muted-foreground">{note}</div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">{children}</div>
    </div>
  );
}
