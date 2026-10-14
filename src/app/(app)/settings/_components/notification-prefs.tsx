"use client";

import { useOptimistic } from "react";
import { Switch } from "@/components/ui/switch";
import { useServerAction } from "@/hooks/use-server-action";
import { NOTIFICATION_LABELS, type NotificationTypeCode } from "@/lib/workflow/statuses";
import { updateSettingsAction } from "@/server/actions/workspace";
import { SettingsCard } from "./settings-card";

type Prefs = Record<NotificationTypeCode, boolean>;

export function NotificationPrefs({ prefs }: { prefs: Prefs }) {
  const [view, apply] = useOptimistic(prefs, (state, patch: Partial<Prefs>) => ({ ...state, ...patch }));
  const { run } = useServerAction();
  const types = Object.keys(NOTIFICATION_LABELS) as NotificationTypeCode[];

  function toggle(type: NotificationTypeCode, value: boolean) {
    const next = { ...view, [type]: value };
    run(
      () => {
        apply({ [type]: value });
        return updateSettingsAction({ notificationPrefs: next });
      },
      { success: value ? "Notification turned on" : "Notification turned off" },
    );
  }

  return (
    <SettingsCard id="notifications" title="Notifications" description="Choose which events show up in the notifications menu.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#eeebd8] bg-[#fcfbf3] text-xs text-muted-foreground">
              <th scope="col" className="px-5 py-2.5 text-left font-medium">
                Event
              </th>
              <th scope="col" className="w-24 px-5 py-2.5 text-center font-medium">
                In-app
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f3f1e4]">
            {types.map((t) => (
              <tr key={t}>
                <td className="px-5 py-3">
                  <label htmlFor={`notify-${t}`} className="cursor-pointer">
                    {NOTIFICATION_LABELS[t]}
                  </label>
                </td>
                <td className="px-5 py-3 text-center">
                  <Switch id={`notify-${t}`} checked={view[t]} onCheckedChange={(v) => toggle(t, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SettingsCard>
  );
}
