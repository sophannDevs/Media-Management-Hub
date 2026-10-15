import { ActivityIcon } from "@/components/app/activity-icon";
import type { SettingsData } from "@/server/queries/settings";
import { SettingsCard } from "./settings-card";

/** The workspace's own history (DB-05): accounts, settings, prompts, labels and sign-ins. Content changes live on each item's Activity tab. */
export function RecentChanges({ items }: { items: SettingsData["activity"] }) {
  return (
    <SettingsCard id="activity" title="Recent changes" description="Accounts, settings, prompts, labels and sign-ins, newest first, with who made each change. Changes to a content item are on its Activity tab.">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
      ) : (
        <ol className="divide-y divide-[#f1eedf]" aria-label="Recent changes">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <ActivityIcon type={a.type} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{a.message}</p>
                <p className="text-xs text-muted-foreground">
                  {a.when} · {a.by}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SettingsCard>
  );
}
