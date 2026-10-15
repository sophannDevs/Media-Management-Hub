"use client";

import { Clock, Server, ShieldCheck, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/app/field";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { updateSettingsAction } from "@/server/actions/workspace";
import type { SettingsData } from "@/server/queries/settings";
import { SettingsCard, SettingsFooter } from "./settings-card";

const wholeNumber = (v: string, min: number, max: number) => (/^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max ? Number(v) : null);

export function PublishingForm({ initial, worker }: { initial: SettingsData["publishing"]; worker: SettingsData["worker"] }) {
  const [autoRetry, setAutoRetry] = useState(initial.autoRetry);
  const [maxRetries, setMaxRetries] = useState(String(initial.maxRetries));
  const [delay, setDelay] = useState(String(initial.retryDelayMinutes));
  const { run, pending } = useServerAction();

  const retries = wholeNumber(maxRetries, 0, 10);
  const minutes = wholeNumber(delay, 1, 1440);
  const valid = retries !== null && minutes !== null;
  const dirty = autoRetry !== initial.autoRetry || retries !== initial.maxRetries || minutes !== initial.retryDelayMinutes;

  function reset() {
    setAutoRetry(initial.autoRetry);
    setMaxRetries(String(initial.maxRetries));
    setDelay(String(initial.retryDelayMinutes));
  }

  const summary = !autoRetry
    ? "Failed posts stay Failed until you retry them from the Schedule page."
    : valid
      ? `Temporary errors are retried up to ${retries} time${retries === 1 ? "" : "s"}, ${minutes} minute${minutes === 1 ? "" : "s"} apart. Expired tokens need a reconnect.`
      : "";

  return (
    <SettingsCard id="publishing" title="Publishing" description="What happens when a scheduled post fails, and how the queue is processed.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          run(() => updateSettingsAction({ autoRetry, maxRetries: retries, retryDelayMinutes: minutes }), { success: "Publishing settings saved" });
        }}
      >
        <div className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="auto-retry" className="min-w-0 cursor-pointer">
              <span className="block text-sm font-medium">Auto-retry failed posts</span>
              <span className="block text-xs text-muted-foreground">Retry uploads that failed for a temporary reason (network, quota) before marking them Failed.</span>
            </label>
            <Switch id="auto-retry" checked={autoRetry} onCheckedChange={setAutoRetry} />
          </div>
          <div className={cn("grid gap-4 sm:grid-cols-2", !autoRetry && "opacity-60")}>
            <Field label="Max retries" hint="0–10 attempts">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={10}
                step={1}
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
                aria-label="Max retries"
                aria-invalid={retries === null}
                className="sm:max-w-40"
              />
              {retries === null && <p className="mt-1 text-xs text-rose-700">Enter a whole number from 0 to 10.</p>}
            </Field>
            <Field label="Retry delay (minutes)" hint="1–1440 minutes between attempts">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                step={1}
                value={delay}
                onChange={(e) => setDelay(e.target.value)}
                aria-label="Retry delay in minutes"
                aria-invalid={minutes === null}
                className="sm:max-w-40"
              />
              {minutes === null && <p className="mt-1 text-xs text-rose-700">Enter a whole number from 1 to 1440.</p>}
            </Field>
          </div>
        </div>
        <SettingsFooter note={summary}>
          <Button type="button" variant="ghost" disabled={!dirty || pending} onClick={reset}>
            Reset
          </Button>
          <Button type="submit" disabled={!dirty || !valid || pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </SettingsFooter>
      </form>

      <div className="border-t border-[#f3f1e4] px-5 py-4">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Publishing worker</h3>
        <ul className="mt-3 space-y-3 text-sm">
          <li className="flex gap-3">
            <Server className="mt-0.5 size-4 shrink-0 text-stone-500" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Worker</span>
                <StatusBadge size="sm" tone={worker.running ? "success" : "danger"} label={worker.running ? (worker.live > 1 ? `${worker.live} running` : "Running") : "Not running"} />
              </div>
              <p className="text-xs text-muted-foreground">
                {worker.running ? (
                  <>
                    <Clock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                    {worker.mode === "PROCESS" ? "Its own process" : worker.mode === "INLINE" ? "Inside the web server" : "Run by the cron endpoint"}, last seen {worker.lastSeenSecondsAgo ?? 0}s ago. Checks the queue every{" "}
                    {worker.intervalSeconds} seconds (<code className="font-mono">PUBLISH_WORKER_INTERVAL_SECONDS</code>).
                  </>
                ) : (
                  <>
                    Scheduled posts won&apos;t go out. Start it with <code className="font-mono">npm run worker</code> next to the web server
                    {worker.lastSeenSecondsAgo !== null && ` (last seen ${Math.round(worker.lastSeenSecondsAgo / 60)} min ago)`}.
                  </>
                )}
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            {worker.cronEnabled ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-olive-700" aria-hidden /> : <ShieldAlert className="mt-0.5 size-4 shrink-0 text-stone-500" aria-hidden />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">External cron</span>
                <code className="rounded border border-[#ece9d6] bg-[#fcfbf3] px-1.5 py-0.5 font-mono text-xs">POST /api/cron/publish</code>
              </div>
              <p className="text-xs text-muted-foreground">
                {worker.cronEnabled ? (
                  <>
                    On, protected by <code className="font-mono">CRON_SECRET</code> — send <code className="font-mono">Authorization: Bearer &lt;secret&gt;</code>.
                  </>
                ) : (
                  <>
                    Off. Set <code className="font-mono">CRON_SECRET</code> in <code className="font-mono">.env</code> to let a scheduler trigger the queue.
                  </>
                )}
              </p>
            </div>
          </li>
        </ul>
      </div>
    </SettingsCard>
  );
}
